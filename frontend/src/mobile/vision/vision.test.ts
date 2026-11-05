import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn<typeof fetch>();

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_API_URL', '');
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  (globalThis as unknown as { localStorage?: MemoryStorage }).localStorage = undefined;
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function sse(chunks: string[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}
const delta = (t: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`;

describe('getVisionStatus', () => {
  it('parses the server answer and keeps unknown as null', async () => {
    fetchMock.mockResolvedValue(json({ model: 'm', engine_accepts: true, model_sees: null, vision_models: ['qwen2.5vl:7b', 3], hint: 'h' }));
    const { getVisionStatus } = await import('./vision-api');
    const s = await getVisionStatus('m');
    expect(String(fetchMock.mock.calls[0][0])).toBe('/v1/hell/vision?model=m');
    expect(s).toEqual({ model: 'm', engine_accepts: true, model_sees: null, vision_models: ['qwen2.5vl:7b'], hint: 'h' });
  });

  it('reports a model that cannot see', async () => {
    fetchMock.mockResolvedValue(json({ model_sees: false, vision_models: [] }));
    const { getVisionStatus } = await import('./vision-api');
    const s = await getVisionStatus('qwen3:8b');
    expect(s.model_sees).toBe(false);
    expect(s.hint).toMatch(/ollama pull/);
  });

  it('throws on HTTP errors', async () => {
    fetchMock.mockResolvedValue(json({}, 500));
    const { getVisionStatus } = await import('./vision-api');
    await expect(getVisionStatus('m')).rejects.toThrow(/500/);
  });
});

describe('askVision', () => {
  it('sends text + one image part and streams the answer', async () => {
    fetchMock.mockResolvedValue(sse([delta('<think>hmm</think>A '), delta('red '), 'data: {bad json}\n\n', delta('mug.'), 'data: [DONE]\n\n']));
    const { askVision, VISION_SYSTEM_PROMPT } = await import('./vision-api');
    const seen: string[] = [];
    const answer = await askVision({ model: 'qwen2.5vl:7b', question: 'What is this?', frames: ['QUJD'], onText: (t) => seen.push(t) });
    expect(answer).toBe('A red mug.');
    expect(seen.slice(-1)[0]).toBe('A red mug.');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('/v1/chat/completions');
    const body = JSON.parse(String(init?.body));
    expect(body.stream).toBe(true);
    expect(body.messages[0]).toEqual({ role: 'system', content: VISION_SYSTEM_PROMPT });
    expect(body.messages[1].content).toEqual([
      { type: 'text', text: 'What is this?' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,QUJD' } },
    ]);
  });

  it('sends two frames when comparing', async () => {
    fetchMock.mockResolvedValue(sse([delta('Moved.'), 'data: [DONE]\n\n']));
    const { askVision } = await import('./vision-api');
    await askVision({ model: 'm', question: 'q', frames: ['AAAA', 'BBBB'], onText: () => undefined });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.messages[1].content.filter((p: { type: string }) => p.type === 'image_url')).toHaveLength(2);
  });

  it("surfaces the server's refusal text", async () => {
    fetchMock.mockResolvedValue(json({ detail: "Model 'qwen3:8b' can't see images." }, 400));
    const { askVision } = await import('./vision-api');
    await expect(askVision({ model: 'qwen3:8b', question: 'q', frames: ['AAAA'], onText: () => undefined })).rejects.toThrow("can't see images");
  });

  it('falls back to a generic error for non-JSON bodies', async () => {
    fetchMock.mockResolvedValue(new Response('oops', { status: 502 }));
    const { askVision } = await import('./vision-api');
    await expect(askVision({ model: 'm', question: 'q', frames: ['AAAA'], onText: () => undefined })).rejects.toThrow(/HTTP 502/);
  });
});

describe('vision model preference', () => {
  it('round-trips through localStorage', async () => {
    const { loadVisionModel, saveVisionModel } = await import('./vision-api');
    expect(loadVisionModel()).toBe('');
    saveVisionModel('qwen2.5vl:7b');
    expect(loadVisionModel()).toBe('qwen2.5vl:7b');
  });
});

describe('camera helpers', () => {
  it('explains permission and missing-camera errors', async () => {
    const { describeCameraError } = await import('./camera');
    expect(describeCameraError({ name: 'NotAllowedError' })).toMatch(/permission/i);
    expect(describeCameraError({ name: 'NotFoundError' })).toMatch(/No camera/);
    expect(describeCameraError({ name: 'NotReadableError' })).toMatch(/busy/);
  });

  it('captureFrame scales the long side down and strips the data: prefix', async () => {
    const drawImage = vi.fn();
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage }), toDataURL: () => 'data:image/jpeg;base64,XYZ' };
    vi.stubGlobal('document', { createElement: () => canvas, addEventListener: () => undefined });
    const { captureFrame } = await import('./camera');
    const video = { videoWidth: 1920, videoHeight: 1080 } as HTMLVideoElement;
    const f = captureFrame(video, 1024);
    expect(f).toEqual({ dataUrl: 'data:image/jpeg;base64,XYZ', base64: 'XYZ' });
    expect(canvas.width).toBe(1024);
    expect(canvas.height).toBe(576);
    expect(drawImage).toHaveBeenCalledWith(video, 0, 0, 1024, 576);
  });

  it('captureFrame returns null before the video has a frame', async () => {
    const { captureFrame } = await import('./camera');
    expect(captureFrame({ videoWidth: 0, videoHeight: 0 } as HTMLVideoElement)).toBeNull();
  });

  it('frameObjectUrl turns base64 into a blob: URL (CSP allows blob:, not data:)', async () => {
    const { frameObjectUrl } = await import('./camera');
    const url = frameObjectUrl(btoa('abc'));
    expect(url.startsWith('blob:')).toBe(true);
    URL.revokeObjectURL(url);
  });

  it('stop() ends every track and clears state', async () => {
    const { useCamera } = await import('./camera');
    const t = { stop: vi.fn() };
    useCamera.setState({ stream: { getTracks: () => [t] } as unknown as MediaStream, status: 'on', analyzing: true });
    useCamera.getState().stop();
    expect(t.stop).toHaveBeenCalled();
    expect(useCamera.getState()).toMatchObject({ stream: null, status: 'off', analyzing: false });
  });
});
