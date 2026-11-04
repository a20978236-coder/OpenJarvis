import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('../lib/sse', () => ({ streamChat: vi.fn(), streamResearch: vi.fn() }));
vi.mock('../lib/api', async (orig) => ({
  ...(await orig<typeof import('../lib/api')>()),
  fetchSavings: vi.fn(() => Promise.reject(new Error('offline'))),
}));

type Sse = { event?: string; data: string };

function chunk(content: string, finish?: string): Sse {
  return { data: JSON.stringify({ choices: [{ delta: { content }, finish_reason: finish ?? null }] }) };
}

beforeEach(() => {
  vi.resetModules();
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
  // Digest probe after each reply: report "no digest".
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  (globalThis as unknown as { localStorage?: MemoryStorage }).localStorage = undefined;
});

async function load() {
  const sse = await import('../lib/sse');
  const { useAppStore } = await import('../lib/store');
  const sender = await import('./useChatSender');
  const { toast } = await import('sonner');
  return { streamChat: vi.mocked(sse.streamChat), useAppStore, ...sender, toast: vi.mocked(toast) };
}

describe('sendChatMessage', () => {
  it('streams a reply into a new conversation', async () => {
    const { streamChat, useAppStore, sendChatMessage } = await load();
    useAppStore.setState({ selectedModel: 'test-model' });
    streamChat.mockImplementation(async function* () {
      yield chunk('Hello');
      yield chunk(', sir.', 'stop');
    });

    const result = await sendChatMessage('  Hi Jarvis  ');

    expect(result).toBe('sent');
    const { messages, streamState, activeId } = useAppStore.getState();
    expect(activeId).not.toBeNull();
    expect(messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'Hi Jarvis'],
      ['assistant', 'Hello, sir.'],
    ]);
    expect(messages[1].telemetry?.model_id).toBe('test-model');
    expect(streamState.isStreaming).toBe(false);

    const request = streamChat.mock.calls[0][0];
    expect(request.model).toBe('test-model');
    expect(request.messages).toEqual([{ role: 'user', content: 'Hi Jarvis' }]);
  });

  it('refuses empty input without touching the store', async () => {
    const { useAppStore, sendChatMessage, streamChat } = await load();
    useAppStore.setState({ selectedModel: 'test-model' });
    expect(await sendChatMessage('   ')).toBe('empty');
    expect(streamChat).not.toHaveBeenCalled();
    expect(useAppStore.getState().messages).toEqual([]);
  });

  it('asks for a model instead of sending when none is selected', async () => {
    const { useAppStore, sendChatMessage, streamChat, toast } = await load();
    useAppStore.setState({ selectedModel: '' });
    expect(await sendChatMessage('hello')).toBe('no-model');
    expect(toast.error).toHaveBeenCalled();
    expect(streamChat).not.toHaveBeenCalled();
  });

  it('rejects a second send while a reply is streaming', async () => {
    const { useAppStore, sendChatMessage } = await load();
    useAppStore.setState({ selectedModel: 'test-model' });
    useAppStore.getState().setStreamState({ isStreaming: true });
    expect(await sendChatMessage('hello')).toBe('busy');
  });

  it('stopChatStream aborts the reply and keeps the partial text', async () => {
    const { streamChat, useAppStore, sendChatMessage, stopChatStream } = await load();
    useAppStore.setState({ selectedModel: 'test-model' });
    streamChat.mockImplementation(async function* (_req, signal) {
      yield chunk('Partial');
      await new Promise<void>((_, reject) => {
        signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        );
      });
    });

    const pending = sendChatMessage('Tell me a long story');
    await vi.waitFor(() => expect(useAppStore.getState().streamState.content).toBe('Partial'));
    stopChatStream();
    await pending;

    const last = useAppStore.getState().messages.slice(-1)[0];
    expect(last?.content).toBe('Partial');
    expect(useAppStore.getState().streamState.isStreaming).toBe(false);
  });

  it('reports a stream error in the reply', async () => {
    const { streamChat, useAppStore, sendChatMessage } = await load();
    useAppStore.setState({ selectedModel: 'test-model' });
    streamChat.mockImplementation(async function* () {
      throw new Error('HTTP 500');
    });

    await sendChatMessage('hello');
    expect(useAppStore.getState().messages.slice(-1)[0]?.content).toBe('Error: HTTP 500');
  });
});
