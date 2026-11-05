import { beforeEach, describe, expect, it } from 'vitest';
import { CATALOG, HOLO_TYPES, LIMITS, sanitizeColor, sanitizeLayout, sanitizeObject } from './holo-types';
import { __setIdFactory, applyOp, snapValue, starterLayout, STAGE_BOUNDS } from './holo-ops';

let n = 0;
beforeEach(() => {
  n = 0;
  __setIdFactory(() => `id${++n}`);
});

const empty = () => sanitizeLayout({ name: 'Test' });

describe('object catalog', () => {
  it('offers all fifteen buildable object types', () => {
    expect(HOLO_TYPES).toHaveLength(15);
    for (const t of HOLO_TYPES) {
      expect(CATALOG[t].label).toBeTruthy();
      expect(sanitizeObject({ type: t }, 'x')?.type).toBe(t);
    }
  });
});

describe('sanitizing', () => {
  it('clamps every numeric field and fixes vectors', () => {
    const o = sanitizeObject(
      { type: 'screen', position: [99, -99, 'x'], rotation: [370, -190, 45], scale: 50, opacity: -1, glow: 9, density: 0, animSpeed: 7, rotSpeed: 999 },
      'a',
    )!;
    expect(o.position).toEqual([LIMITS.position, -LIMITS.position, 0]);
    expect(o.rotation).toEqual([10, 170, 45]);
    expect(o.scale).toBe(4);
    expect(o.opacity).toBe(0.1);
    expect(o.glow).toBe(2);
    expect(o.density).toBe(0.2);
    expect(o.animSpeed).toBe(3);
    expect(o.rotSpeed).toBe(180);
  });

  it('accepts colour names and hex, rejects anything else', () => {
    expect(sanitizeColor('Red')).toBe('#ff4d6d');
    expect(sanitizeColor('#0AF')).toBe('#00aaff');
    expect(sanitizeColor('#123456')).toBe('#123456');
    expect(sanitizeColor('url(javascript:alert(1))')).toBe('#00b3ff');
    expect(sanitizeColor(42)).toBe('#00b3ff');
  });

  it('strips control characters and caps text', () => {
    const o = sanitizeObject({ type: 'text', text: 'hi\u0000there' + 'x'.repeat(500) }, 'a')!;
    expect(o.text.startsWith('hi there')).toBe(true);
    expect(o.text.length).toBe(LIMITS.maxText);
  });

  it('only allows known variants', () => {
    expect(sanitizeObject({ type: 'rotating', variant: 'torus' }, 'a')!.variant).toBe('torus');
    expect(sanitizeObject({ type: 'rotating', variant: 'dragon' }, 'a')!.variant).toBe('planet');
    expect(sanitizeObject({ type: 'screen', variant: 'torus' }, 'a')!.variant).toBe('');
  });

  it('drops unknown objects, de-duplicates ids and caps object count from untrusted layouts', () => {
    const l = sanitizeLayout({
      name: '',
      objects: [{ type: 'clock', id: 'a' }, { type: 'evil' }, { type: 'clock', id: 'a' }, ...Array(200).fill({ type: 'text' })],
    });
    expect(l.name).toBe('Untitled hologram');
    expect(l.objects.length).toBe(LIMITS.maxObjects - 1); // one of the first 80 was unknown
    expect(new Set(l.objects.map((o) => o.id)).size).toBe(l.objects.length);
    expect(sanitizeLayout('garbage')).toMatchObject({ version: 1, objects: [] });
  });
});

describe('operations', () => {
  it('starter layout has the HELL orb in the centre', () => {
    const l = starterLayout();
    expect(l.objects).toHaveLength(1);
    expect(l.objects[0]).toMatchObject({ type: 'orb', position: [0, 0, 0] });
  });

  it('add places new objects apart and returns the new id', () => {
    let l = empty();
    const r1 = applyOp(l, { op: 'add', type: 'clock' });
    l = r1.layout;
    const r2 = applyOp(l, { op: 'add', type: 'weather' });
    expect(r1.createdId).toBe('id1');
    expect(r2.layout.objects[1].position).not.toEqual(r2.layout.objects[0].position);
    expect(l).not.toBe(r2.layout); // never mutates
    expect(l.objects).toHaveLength(1);
  });

  it('add honours props but still validates them', () => {
    const { layout } = applyOp(empty(), { op: 'add', type: 'screen', props: { color: 'purple', scale: 99, id: 'hijack' } as never });
    expect(layout.objects[0]).toMatchObject({ id: 'id1', color: '#7a5cff', scale: 4 });
  });

  it('update cannot change id or type', () => {
    let { layout } = applyOp(empty(), { op: 'add', type: 'clock' });
    layout = applyOp(layout, { op: 'update', id: 'id1', props: { id: 'x', type: 'orb', name: 'Main clock' } as never }).layout;
    expect(layout.objects[0]).toMatchObject({ id: 'id1', type: 'clock', name: 'Main clock' });
  });

  it('move, duplicate, remove', () => {
    let { layout } = applyOp(empty(), { op: 'add', type: 'text', props: { position: [0, 0, 0] } });
    layout = applyOp(layout, { op: 'move', id: 'id1', by: [-1, 0.5, 0] }).layout;
    expect(layout.objects[0].position).toEqual([-1, 0.5, 0]);
    const dup = applyOp(layout, { op: 'duplicate', id: 'id1' });
    expect(dup.createdId).toBe('id2');
    expect(dup.layout.objects[1]).toMatchObject({ type: 'text', name: 'Text panel copy', position: [-0.65, 0.15, 0] });
    layout = applyOp(dup.layout, { op: 'remove', id: 'id1' }).layout;
    expect(layout.objects.map((o) => o.id)).toEqual(['id2']);
  });

  it('align modes', () => {
    let { layout } = applyOp(empty(), { op: 'add', type: 'panel', props: { position: [1.13, -0.61, 0.4], rotation: [10, 20, 30] } });
    const at = (mode: Parameters<typeof applyOp>[1] & { op: 'align' }) => applyOp(layout, mode).layout.objects[0];
    expect(at({ op: 'align', id: 'id1', mode: 'center' }).position).toEqual([0, 0, 0.4]);
    expect(at({ op: 'align', id: 'id1', mode: 'left' }).position).toEqual([-STAGE_BOUNDS.x, -0.61, 0.4]);
    expect(at({ op: 'align', id: 'id1', mode: 'top' }).position).toEqual([1.13, STAGE_BOUNDS.y, 0.4]);
    expect(at({ op: 'align', id: 'id1', mode: 'grid' }).position).toEqual([1.25, -0.5, 0.5]);
    expect(at({ op: 'align', id: 'id1', mode: 'face' }).rotation).toEqual([0, 0, 0]);
  });

  it('rejects ops on missing objects and over the object limit, without changing the layout', () => {
    const l = empty();
    for (const op of [
      { op: 'update', id: 'nope', props: {} },
      { op: 'remove', id: 'nope' },
      { op: 'move', id: 'nope', by: [1, 1, 1] },
      { op: 'add', type: 'dragon' },
    ] as const) {
      const r = applyOp(l, op as never);
      expect(r.error).toBeTruthy();
      expect(r.layout).toBe(l);
    }
    let full = l;
    for (let i = 0; i < LIMITS.maxObjects; i++) full = applyOp(full, { op: 'add', type: 'text' }).layout;
    expect(applyOp(full, { op: 'add', type: 'text' }).error).toMatch(/at most/);
  });

  it('scene, rename and clear', () => {
    let l = starterLayout();
    l = applyOp(l, { op: 'scene', props: { background: 'stars', lighting: 9 } }).layout;
    expect(l.scene).toEqual({ background: 'stars', lighting: 2 });
    l = applyOp(l, { op: 'rename', name: '  Command deck  ' }).layout;
    expect(l.name).toBe('Command deck');
    expect(applyOp(l, { op: 'clear' }).layout.objects).toEqual([]);
  });

  it('snaps to the grid', () => {
    expect(snapValue(0.37)).toBe(0.25);
    expect(snapValue(-0.13)).toBe(-0.25);
  });
});
