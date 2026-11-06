import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractJson, toCommandResult } from './holo-ai';
import { sanitizeLayout } from './holo-types';

const layout = sanitizeLayout({
  name: 'T',
  objects: [
    { id: 'orb1', type: 'orb' },
    { id: 'c1', type: 'clock' },
    { id: 'c2', type: 'clock' },
  ],
});

describe('extractJson', () => {
  it('finds JSON inside think tags, fences and chatter', () => {
    expect(extractJson('<think>planning {not json}</think>Sure! ```json\n{"ops":[],"reply":"ok"}\n``` hope that helps')).toEqual({ ops: [], reply: 'ok' });
    expect(extractJson('{"reply":"has } brace in string","ops":[]}')).toEqual({ reply: 'has } brace in string', ops: [] });
    expect(extractJson('no json here')).toBeNull();
    expect(extractJson('{"broken": ')).toBeNull();
  });
});

describe('toCommandResult', () => {
  it('maps valid ops and resolves targets', () => {
    const r = toCommandResult(
      {
        ops: [
          { op: 'add', type: 'rotating', props: { variant: 'planet', color: 'gold', evil: 'x' } },
          { op: 'update', target: 'clock', props: { scale: 2 } },
          { op: 'move', target: 'selected', by: [1, 0, 99] },
          { op: 'align', target: 'orb1', mode: 'center' },
          { op: 'scene', props: { background: 'stars' } },
          { op: 'save' },
        ],
        reply: 'Built your planet.',
      },
      layout,
      'c1',
    );
    expect(r.ops).toEqual([
      { op: 'add', type: 'rotating', props: { variant: 'planet', color: 'gold' } }, // unknown prop dropped
      { op: 'update', id: 'c2', props: { scale: 2 } }, // type -> most recent clock
      { op: 'move', id: 'c1', by: [1, 0, 3] }, // selected; move clamped
      { op: 'align', id: 'orb1', mode: 'center' },
      { op: 'scene', props: { background: 'stars' } },
    ]);
    expect(r.actions).toEqual([{ kind: 'save' }]);
    expect(r.reply).toBe('Built your planet.');
  });

  it('drops invalid or unresolvable ops and says so', () => {
    const r = toCommandResult(
      {
        ops: [
          { op: 'add', type: 'dragon' },
          { op: 'remove', target: 'planet' },
          { op: 'align', target: 'orb1', mode: 'sideways' },
          { op: 'eval', code: 'alert(1)' },
          { op: 'remove', target: 'orb1' },
        ],
        reply: 'Done',
      },
      layout,
      null,
    );
    expect(r.ops).toEqual([{ op: 'remove', id: 'orb1' }]);
    expect(r.reply).toMatch(/Skipped 4 steps/);
  });

  it('nothing valid -> no changes and an honest reply', () => {
    for (const parsed of [null, {}, { ops: 'nope' }, { ops: [{ op: 'eval' }] }]) {
      const r = toCommandResult(parsed, layout, null);
      expect(r.ops).toEqual([]);
      expect(r.actions).toEqual([]);
      expect(r.reply).toMatch(/couldn't/i);
    }
  });

  it('caps the number of ops', () => {
    const r = toCommandResult({ ops: Array(100).fill({ op: 'add', type: 'clock' }) }, layout, null);
    expect(r.ops).toHaveLength(30);
  });
});

describe('askHologramAI', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_API_URL', '');
    fetchMock.mockReset();
    globalThis.fetch = fetchMock;
    (globalThis as unknown as { localStorage: { getItem: () => null } }).localStorage = { getItem: () => null };
  });
  afterEach(() => vi.unstubAllEnvs());

  it('sends a non-streaming request with the schema and layout, and parses the reply', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"ops":[{"op":"add","type":"clock"}],"reply":"Added a clock."}' } }] }), { status: 200 }));
    const { askHologramAI } = await import('./holo-ai');
    const r = await askHologramAI('put a timepiece up top', layout, null, 'qwen3:8b');
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).toMatchObject({ model: 'qwen3:8b', stream: false });
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toMatch(/Reply with ONLY one JSON object/);
    expect(body.messages[1].content).toMatch(/"id":"orb1"/);
    expect(body.messages[1].content).toMatch(/put a timepiece up top/);
    expect(r.ops).toEqual([{ op: 'add', type: 'clock', props: {} }]);
  });

  it('reports server errors and missing models', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 500 }));
    const { askHologramAI } = await import('./holo-ai');
    await expect(askHologramAI('x', layout, null, 'm')).rejects.toThrow(/HTTP 500/);
    expect((await askHologramAI('x', layout, null, '')).reply).toMatch(/No AI model/);
  });
});
