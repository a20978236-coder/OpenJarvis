import { beforeEach, describe, expect, it, vi } from 'vitest';

class MemoryStorage {
  store = new Map<string, string>();
  getItem(k: string) {
    return this.store.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.store.set(k, v);
  }
}

let storage: MemoryStorage;
beforeEach(() => {
  vi.resetModules();
  vi.useRealTimers();
  storage = new MemoryStorage();
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = storage;
});

async function load() {
  const ops = await import('./holo-ops');
  let n = 0;
  ops.__setIdFactory(() => `id${++n}`);
  const { useHolo } = await import('./holo-store');
  return useHolo;
}

describe('hologram editor history', () => {
  it('starts from the starter layout and records undoable steps', async () => {
    const useHolo = await load();
    expect(useHolo.getState().layout.objects.map((o) => o.type)).toEqual(['orb']);
    useHolo.getState().apply({ op: 'add', type: 'clock' });
    const clockId = useHolo.getState().selectedId!; // new objects are selected
    expect(useHolo.getState().layout.objects[1].id).toBe(clockId);
    useHolo.getState().apply({ op: 'update', id: clockId, props: { color: 'red' } });
    expect(useHolo.getState().layout.objects[1].color).toBe('#ff4d6d');

    useHolo.getState().undo();
    expect(useHolo.getState().layout.objects[1].color).not.toBe('#ff4d6d');
    useHolo.getState().undo();
    expect(useHolo.getState().layout.objects).toHaveLength(1);
    expect(useHolo.getState().selectedId).toBeNull(); // selection cleared when the object is undone away
    useHolo.getState().redo();
    useHolo.getState().redo();
    expect(useHolo.getState().layout.objects[1].color).toBe('#ff4d6d');
  });

  it('a drag of many transient updates is ONE undo step', async () => {
    const useHolo = await load();
    useHolo.getState().apply({ op: 'add', type: 'text', props: { position: [0, 0, 0] } });
    const id = useHolo.getState().selectedId!;
    const before = useHolo.getState().past.length;
    for (let i = 1; i <= 20; i++) useHolo.getState().applyTransient({ op: 'update', id, props: { position: [i / 10, 0, 0] } });
    useHolo.getState().commitGesture();
    expect(useHolo.getState().past.length).toBe(before + 1);
    expect(useHolo.getState().layout.objects[1].position).toEqual([2, 0, 0]);
    useHolo.getState().undo();
    expect(useHolo.getState().layout.objects[1].position).toEqual([0, 0, 0]);
  });

  it('a new edit clears redo', async () => {
    const useHolo = await load();
    useHolo.getState().apply({ op: 'add', type: 'clock' });
    useHolo.getState().undo();
    expect(useHolo.getState().future).toHaveLength(1);
    useHolo.getState().apply({ op: 'add', type: 'widget' });
    expect(useHolo.getState().future).toHaveLength(0);
  });

  it('applyMany is one undo step and reports failures', async () => {
    const useHolo = await load();
    const r = useHolo.getState().applyMany([
      { op: 'add', type: 'screen' },
      { op: 'add', type: 'dragon' as never },
      { op: 'scene', props: { background: 'stars' } },
    ]);
    expect(r.applied).toBe(2);
    expect(r.errors).toHaveLength(1);
    expect(useHolo.getState().layout.objects).toHaveLength(2);
    useHolo.getState().undo();
    expect(useHolo.getState().layout.objects).toHaveLength(1);
    expect(useHolo.getState().layout.scene.background).toBe('grid');
  });

  it('errors leave the layout and history untouched', async () => {
    const useHolo = await load();
    const before = useHolo.getState().layout;
    expect(useHolo.getState().apply({ op: 'remove', id: 'ghost' })).toMatch(/no longer exists/);
    expect(useHolo.getState().layout).toBe(before);
    expect(useHolo.getState().past).toHaveLength(0);
  });

  it('keeps a draft on the device and restores it (validated)', async () => {
    vi.useFakeTimers();
    let useHolo = await load();
    useHolo.getState().apply({ op: 'rename', name: 'Deck' });
    vi.advanceTimersByTime(500);
    const saved = JSON.parse(storage.getItem('hell-holo-draft-v1')!);
    expect(saved.layout.name).toBe('Deck');

    // Tampered draft: unknown objects are dropped, values clamped.
    saved.layout.objects.push({ type: 'evil' }, { id: 'z', type: 'clock', scale: 1e9 });
    storage.setItem('hell-holo-draft-v1', JSON.stringify(saved));
    vi.resetModules();
    useHolo = await load();
    const objs = useHolo.getState().layout.objects;
    expect(objs.map((o) => o.type)).toEqual(['orb', 'clock']);
    expect(objs[1].scale).toBe(4);
  });

  it('replace (open/new) clears history and marks clean', async () => {
    const useHolo = await load();
    useHolo.getState().apply({ op: 'add', type: 'clock' });
    useHolo.getState().replace({ version: 1, name: 'Loaded', scene: { background: 'void', lighting: 1 }, objects: [] }, 'srv1');
    const s = useHolo.getState();
    expect(s).toMatchObject({ savedId: 'srv1', dirty: false, selectedId: null });
    expect(s.past).toHaveLength(0);
    expect(s.layout.name).toBe('Loaded');
  });
});
