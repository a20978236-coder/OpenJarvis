import { beforeEach, describe, expect, it } from 'vitest';
import { isBuilderCommand, parseCommand } from './holo-commands';
import { __setIdFactory, applyOp, type HoloOp } from './holo-ops';
import { sanitizeLayout, type HoloLayout } from './holo-types';

let n = 0;
beforeEach(() => {
  n = 0;
  __setIdFactory(() => `id${++n}`);
});

function layoutWith(...types: Array<[string, Record<string, unknown>?]>): HoloLayout {
  return sanitizeLayout({
    name: 'T',
    objects: types.map(([type, props], i) => ({ id: `o${i}`, type, ...props })),
  });
}

/** Apply the parsed ops and return the resulting layout. */
function run(text: string, layout: HoloLayout, selected: string | null = null) {
  const r = parseCommand(text, layout, selected);
  if (!r) return { r, layout };
  let l = layout;
  for (const op of r.ops) l = applyOp(l, op as HoloOp).layout;
  return { r, layout: l };
}

describe('the commands from the HELL spec', () => {
  const base = () => layoutWith(['orb'], ['panel', { position: [0.5, 0, 0] }]);

  it('"HELL, create a floating holographic screen."', () => {
    const { r, layout } = run('HELL, create a floating holographic screen.', base());
    expect(r?.reply).toMatch(/screen/i);
    expect(layout.objects.slice(-1)[0]?.type).toBe('screen');
  });

  it('"Build me a 3D rotating planet."', () => {
    const { layout } = run('Build me a 3D rotating planet.', base());
    expect(layout.objects.slice(-1)[0]).toMatchObject({ type: 'rotating', variant: 'planet' });
    expect(layout.objects.slice(-1)[0]!.rotSpeed).toBeGreaterThan(0);
  });

  it('"Create a dashboard around the particle orb." reuses the existing orb', () => {
    const { layout } = run('Create a dashboard around the particle orb.', base());
    expect(layout.objects.filter((o) => o.type === 'orb')).toHaveLength(1);
    expect(layout.objects.find((o) => o.type === 'orb')!.position).toEqual([0, 0, 0]);
    for (const t of ['clock', 'weather', 'diagnostics', 'graph', 'waveform']) expect(layout.objects.some((o) => o.type === t)).toBe(true);
  });

  it('"Make the interface blue." recolours everything', () => {
    const l = layoutWith(['orb', { color: 'red' }], ['clock', { color: 'green' }]);
    const { layout } = run('Make the interface blue.', l);
    expect(layout.objects.every((o) => o.color === '#00b3ff')).toBe(true);
  });

  it('"Move that panel to the left." moves the selected panel', () => {
    const { layout } = run('Move that panel to the left.', base(), 'o1');
    expect(layout.objects[1].position[0]).toBeCloseTo(0);
    expect(layout.objects[0].position).toEqual([0, 0, 0]); // orb untouched
  });

  it('"Make the orb larger."', () => {
    const { layout } = run('Make the orb larger.', base());
    expect(layout.objects[0].scale).toBeCloseTo(1.3);
  });

  it('"Add a camera display."', () => {
    expect(run('Add a camera display.', base()).layout.objects.slice(-1)[0]?.type).toBe('camera');
  });

  it('"Create a holographic control center."', () => {
    const { layout } = run('Create a holographic control center.', layoutWith());
    expect(layout.objects.length).toBeGreaterThanOrEqual(5);
    expect(layout.objects.some((o) => o.type === 'screen' && o.text === 'COMMAND CENTER')).toBe(true);
  });

  it('"Remove the selected panel."', () => {
    const { layout } = run('Remove the selected panel.', base(), 'o1');
    expect(layout.objects.map((o) => o.type)).toEqual(['orb']);
  });

  it('"Save this hologram layout." asks the editor to save', () => {
    const r = parseCommand('Save this hologram layout.', base(), null)!;
    expect(r.actions).toEqual([{ kind: 'save', name: undefined }]);
    const named = parseCommand('save this layout as Command Deck', base(), null)!;
    expect(named.ops).toEqual([{ op: 'rename', name: 'Command Deck' }]);
    expect(named.actions[0]).toEqual({ kind: 'save', name: 'Command Deck' });
  });
});

describe('creating objects', () => {
  it.each([
    ['add a clock', 'clock'],
    ['create a weather display', 'weather'],
    ['add an animated graph', 'graph'],
    ['show system diagnostics', 'diagnostics'],
    ['create a holographic map', 'map'],
    ['add a voice waveform visualizer', 'waveform'],
    ['create a memory visualization', 'memory'],
    ['add a custom widget', 'widget'],
    ['add a particle sphere', 'sphere'],
    ['add a control panel', 'panel'],
    ['build a crystal', 'rotating'],
    ['add a text panel saying Welcome home', 'text'],
  ])('%s → %s', (text, type) => {
    expect(run(text, layoutWith()).layout.objects.slice(-1)[0]?.type).toBe(type);
  });

  it('applies colour, size, count and text', () => {
    const { layout } = run('create two big red cubes', layoutWith());
    expect(layout.objects).toHaveLength(2);
    expect(layout.objects.every((o) => o.color === '#ff4d6d' && o.variant === 'cube' && o.scale > 1)).toBe(true);
    expect(layout.objects[0].position[0]).not.toBe(layout.objects[1].position[0]); // spread out
    expect(run('add a text panel that says "Hello, sir"', layoutWith()).layout.objects[0].text).toBe('Hello, sir');
    expect(run('add a bar chart', layoutWith()).layout.objects[0].variant).toBe('bars');
  });
});

describe('editing objects', () => {
  const l = () => layoutWith(['orb'], ['clock', { position: [0, 1, 0], color: 'cyan' }], ['clock', { position: [0, -1, 0], color: 'gold' }]);

  it('acts on the selection for "it" / no noun', () => {
    expect(run('make it smaller', l(), 'o1').layout.objects[1].scale).toBeLessThan(0.8);
    expect(run('move up a little', l(), 'o1').layout.objects[1].position[1]).toBeCloseTo(1.2);
  });

  it('picks objects by type and colour; most recent when ambiguous', () => {
    expect(run('make the gold clock bigger', l()).layout.objects[2].scale).toBeGreaterThan(0.8);
    expect(run('make the clock bigger', l()).layout.objects[2].scale).toBeGreaterThan(0.8);
  });

  it('moves in every direction and to edges', () => {
    const p = (t: string) => run(t, l(), 'o0').layout.objects[0].position;
    expect(p('move it right')).toEqual([0.5, 0, 0]);
    expect(p('move it closer')).toEqual([0, 0, 0.5]);
    expect(p('push it back a lot')).toEqual([0, 0, -1]);
    expect(p('move it to the top')[1]).toBeGreaterThan(2);
    expect(p('move the orb to the centre')).toEqual([0, 0, 0]);
  });

  it('spin, stop, faster, degrees', () => {
    expect(run('spin the orb', l()).layout.objects[0].rotSpeed).toBe(25);
    const spinning = run('spin the orb', l()).layout;
    expect(run('spin it faster', spinning, 'o0').layout.objects[0].rotSpeed).toBeCloseTo(45);
    expect(run('stop spinning', spinning, 'o0').layout.objects[0].rotSpeed).toBe(0);
    expect(run('rotate it 45 degrees', l(), 'o0').layout.objects[0].rotation[1]).toBe(45);
  });

  it('glow, transparency, density, colour of one object', () => {
    expect(run('make it brighter', l(), 'o0').layout.objects[0].glow).toBeCloseTo(1.35);
    expect(run('make it more transparent', l(), 'o0').layout.objects[0].opacity).toBeCloseTo(0.65);
    expect(run('more particles', l(), 'o0').layout.objects[0].density).toBeCloseTo(1.4);
    expect(run('turn the orb purple', l()).layout.objects[0].color).toBe('#7a5cff');
  });

  it('duplicate, select, remove everything, clear', () => {
    expect(run('duplicate the orb', l()).layout.objects).toHaveLength(4);
    expect(parseCommand('select the gold clock', l(), null)!.actions).toEqual([{ kind: 'select', id: 'o2' }]);
    expect(run('delete everything', l()).layout.objects).toHaveLength(0);
    expect(run('clear the workspace', l()).layout.objects).toHaveLength(0);
  });

  it('changes panel text', () => {
    const lt = layoutWith(['screen']);
    expect(run('make the screen say "Welcome back"', lt).layout.objects[0].text).toBe('Welcome back');
  });

  it('scene: background and lighting', () => {
    expect(run('use a starfield background', l()).layout.scene.background).toBe('stars');
    expect(run('no background', l()).layout.scene.background).toBe('void');
    expect(run('make the scene brighter', l()).layout.scene.lighting).toBeCloseTo(1.3);
  });

  it('undo / redo are editor actions', () => {
    expect(parseCommand('undo', l(), null)!.actions).toEqual([{ kind: 'undo' }]);
    expect(parseCommand('HELL, redo that', l(), null)!.actions).toEqual([{ kind: 'redo' }]);
  });
});

describe('honesty', () => {
  it('asks which object instead of guessing when nothing matches', () => {
    const r = parseCommand('make the planet bigger', layoutWith(['clock']), null)!;
    expect(r.ops).toEqual([]);
    expect(r.reply).toMatch(/not sure which/i);
    expect(parseCommand('remove it', layoutWith(), null)!.reply).toMatch(/nothing in the workspace/i);
  });

  it('returns null for things it cannot parse (AI fallback)', () => {
    expect(parseCommand('arrange these like a solar system with moons', layoutWith(['orb']), null)).toBeNull();
    expect(parseCommand('', layoutWith(), null)).toBeNull();
  });
});

describe('dashboard voice routing', () => {
  it.each([
    ['HELL, build me a 3D rotating planet', true],
    ['create a floating holographic screen', true],
    ['create a dashboard around the orb', true],
    ['build a holographic control center', true],
    ['make a hologram of a cube', true],
    ['create a shopping list', false],
    ['add milk to my tasks', false],
    ['make a text for my mum', false],
    ['what is a planet', false],
  ])('%s → %s', (text, expected) => {
    expect(isBuilderCommand(text)).toBe(expected);
  });
});
