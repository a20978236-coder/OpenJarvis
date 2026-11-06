/**
 * Hologram Builder data model. Layouts are plain JSON so they can be saved
 * on the server, undone/redone as snapshots, and (in Stage C2) produced by
 * the AI as a list of operations. Every value that enters a layout goes
 * through `sanitizeObject`, whatever its source.
 */

export const HOLO_TYPES = [
  'screen',
  'sphere',
  'orb',
  'panel',
  'camera',
  'weather',
  'clock',
  'graph',
  'diagnostics',
  'map',
  'text',
  'waveform',
  'rotating',
  'memory',
  'widget',
] as const;
export type HoloType = (typeof HOLO_TYPES)[number];

export type Vec3 = [number, number, number];
export type PanelShape = 'rect' | 'chamfer' | 'round';

export interface HoloObject {
  id: string;
  type: HoloType;
  name: string;
  position: Vec3;
  /** Degrees. */
  rotation: Vec3;
  /** Uniform size multiplier. */
  scale: number;
  color: string;
  opacity: number;
  glow: number;
  /** Particle density (spheres, orb, memory) or detail (map, waveform). */
  density: number;
  /** Animation speed multiplier (0 = frozen). */
  animSpeed: number;
  /** Continuous spin in degrees per second around Y (negative = reverse). */
  rotSpeed: number;
  shape: PanelShape;
  border: boolean;
  /** Title or body text, where the type shows text. */
  text: string;
  /** Second line of text (widget value, panel subtitle). */
  value: string;
  /** Type-specific look: rotating = planet/cube/torus/crystal/city; graph = line/bars. */
  variant: string;
}

export type Background = 'grid' | 'stars' | 'void';

export interface HoloScene {
  background: Background;
  /** Overall brightness, 0.3–2. */
  lighting: number;
}

export interface HoloLayout {
  version: 1;
  name: string;
  scene: HoloScene;
  objects: HoloObject[];
}

export const LIMITS = {
  maxObjects: 80,
  maxText: 280,
  maxName: 60,
  position: 6,
  scale: [0.2, 4] as const,
  opacity: [0.1, 1] as const,
  glow: [0, 2] as const,
  density: [0.2, 2] as const,
  animSpeed: [0, 3] as const,
  rotSpeed: [-180, 180] as const,
  lighting: [0.3, 2] as const,
};

export const VARIANTS: Partial<Record<HoloType, readonly string[]>> = {
  rotating: ['planet', 'cube', 'torus', 'crystal', 'city'],
  graph: ['line', 'bars'],
};

export interface CatalogEntry {
  type: HoloType;
  label: string;
  hint: string;
  /** Which inspector controls apply. */
  uses: { text?: string; value?: string; density?: boolean; shape?: boolean; variant?: boolean };
  defaults: Partial<HoloObject>;
}

export const CATALOG: Record<HoloType, CatalogEntry> = {
  screen: { type: 'screen', label: 'Floating screen', hint: 'A glowing holographic display.', uses: { text: 'Title', value: 'Body', shape: true }, defaults: { text: 'HOLO SCREEN', value: 'Systems nominal', scale: 1.2 } },
  sphere: { type: 'sphere', label: 'Particle sphere', hint: 'A cloud of particles on a sphere.', uses: { density: true }, defaults: { scale: 0.8, color: '#00b3ff', rotSpeed: 12 } },
  orb: { type: 'orb', label: 'HELL orb', hint: 'The assistant orb. Reacts to HELL listening, thinking and speaking.', uses: { density: true }, defaults: { scale: 1, color: '#00b3ff' } },
  panel: { type: 'panel', label: 'Control panel', hint: 'A panel of glowing switches and dials.', uses: { text: 'Title', shape: true }, defaults: { text: 'CONTROL', scale: 1 } },
  camera: { type: 'camera', label: 'Camera display', hint: 'Shows the Vision camera once Stage D is built; a framed placeholder until then.', uses: { text: 'Label', shape: true }, defaults: { text: 'CAMERA', scale: 1 } },
  weather: { type: 'weather', label: 'Weather', hint: 'Live weather (set it up on the dashboard first).', uses: { shape: true }, defaults: { scale: 0.8 } },
  clock: { type: 'clock', label: 'Digital clock', hint: 'The current time and date.', uses: { shape: true }, defaults: { scale: 0.8 } },
  graph: { type: 'graph', label: 'Animated graph', hint: 'A live-animated line or bar chart (decorative data).', uses: { text: 'Title', shape: true, variant: true }, defaults: { text: 'ENERGY', variant: 'line', scale: 1 } },
  diagnostics: { type: 'diagnostics', label: 'System diagnostics', hint: 'Live frame rate, server latency and connection.', uses: { shape: true }, defaults: { scale: 0.9 } },
  map: { type: 'map', label: 'Map', hint: 'A stylized holographic terrain grid (decorative, not real map data).', uses: { density: true }, defaults: { scale: 1, rotation: [-55, 0, 0] } },
  text: { type: 'text', label: 'Text panel', hint: 'Your own words on a holographic panel.', uses: { text: 'Text', shape: true }, defaults: { text: 'Type something', scale: 1 } },
  waveform: { type: 'waveform', label: 'Voice waveform', hint: 'Bars that move while HELL listens or speaks.', uses: { density: true }, defaults: { scale: 1 } },
  rotating: { type: 'rotating', label: '3D rotating object', hint: 'A planet, cube, torus, crystal or city that spins.', uses: { variant: true }, defaults: { variant: 'planet', rotSpeed: 20, scale: 0.8 } },
  memory: { type: 'memory', label: 'Memory map', hint: 'A node graph sized by what HELL remembers.', uses: { density: true }, defaults: { scale: 0.9, rotSpeed: 8 } },
  widget: { type: 'widget', label: 'Custom widget', hint: 'A label and a value you choose.', uses: { text: 'Label', value: 'Value', shape: true }, defaults: { text: 'FOCUS', value: '98%', scale: 0.8 } },
};

export const DEFAULT_OBJECT: Omit<HoloObject, 'id' | 'type' | 'name'> = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: 1,
  color: '#00b3ff',
  opacity: 0.9,
  glow: 1,
  density: 1,
  animSpeed: 1,
  rotSpeed: 0,
  shape: 'chamfer',
  border: true,
  text: '',
  value: '',
  variant: '',
};

export const DEFAULT_SCENE: HoloScene = { background: 'grid', lighting: 1 };

export const SWATCHES = ['#00b3ff', '#5ce1ff', '#3d7bff', '#7a5cff', '#00d68f', '#ffb547', '#ff4d6d', '#ffffff'];

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const clamp = (v: unknown, lo: number, hi: number, d: number): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

/** Millimetre precision keeps saved layouts tidy and comparisons exact. */
const r3 = (n: number) => Math.round(n * 1000) / 1000;

const vec = (v: unknown, lim: number, d: Vec3): Vec3 =>
  Array.isArray(v) && v.length === 3
    ? [r3(clamp(v[0], -lim, lim, d[0])), r3(clamp(v[1], -lim, lim, d[1])), r3(clamp(v[2], -lim, lim, d[2]))]
    : d;

const wrapDeg = (v: unknown, d: number): number => {
  const n = clamp(v, -1e6, 1e6, d);
  return ((((n + 180) % 360) + 360) % 360) - 180;
};

const NAMED_COLORS: Record<string, string> = {
  blue: '#00b3ff', cyan: '#5ce1ff', teal: '#00d1c1', navy: '#1f4fff', indigo: '#3d7bff', purple: '#7a5cff', violet: '#7a5cff',
  green: '#00d68f', emerald: '#00d68f', yellow: '#ffd36b', gold: '#ffb547', orange: '#ff8c3a', amber: '#ffb547',
  red: '#ff4d6d', pink: '#ff6bd6', magenta: '#ff4dd2', white: '#ffffff', silver: '#c8d6e5', grey: '#8fa9cc', gray: '#8fa9cc',
};

/** Accept #rgb/#rrggbb or a colour name; anything else falls back. */
export function sanitizeColor(v: unknown, d = DEFAULT_OBJECT.color): string {
  if (typeof v !== 'string') return d;
  const s = v.trim().toLowerCase();
  if (NAMED_COLORS[s]) return NAMED_COLORS[s];
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  return d;
}

const str = (v: unknown, max: number, d = ''): string =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max) : d;

export function isHoloType(v: unknown): v is HoloType {
  return typeof v === 'string' && (HOLO_TYPES as readonly string[]).includes(v);
}

/** Make any input a valid object of `type` (or null if the type is unknown). */
export function sanitizeObject(raw: unknown, fallbackId?: string): HoloObject | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (!isHoloType(r.type)) return null;
  const type = r.type;
  const base = { ...DEFAULT_OBJECT, ...CATALOG[type].defaults };
  const variants = VARIANTS[type];
  const id = typeof r.id === 'string' && /^[\w-]{1,40}$/.test(r.id) ? r.id : fallbackId;
  if (!id) return null;
  const rot = Array.isArray(r.rotation) && r.rotation.length === 3 ? r.rotation : base.rotation;
  return {
    id,
    type,
    name: str(r.name, LIMITS.maxName, CATALOG[type].label) || CATALOG[type].label,
    position: vec(r.position, LIMITS.position, base.position),
    rotation: [wrapDeg(rot[0], 0), wrapDeg(rot[1], 0), wrapDeg(rot[2], 0)],
    scale: clamp(r.scale, ...LIMITS.scale, base.scale),
    color: sanitizeColor(r.color, base.color),
    opacity: clamp(r.opacity, ...LIMITS.opacity, base.opacity),
    glow: clamp(r.glow, ...LIMITS.glow, base.glow),
    density: clamp(r.density, ...LIMITS.density, base.density),
    animSpeed: clamp(r.animSpeed, ...LIMITS.animSpeed, base.animSpeed),
    rotSpeed: clamp(r.rotSpeed, ...LIMITS.rotSpeed, base.rotSpeed),
    shape: r.shape === 'rect' || r.shape === 'round' || r.shape === 'chamfer' ? r.shape : base.shape,
    border: typeof r.border === 'boolean' ? r.border : base.border,
    text: str(r.text, LIMITS.maxText, base.text),
    value: str(r.value, LIMITS.maxText, base.value),
    variant: variants ? (typeof r.variant === 'string' && variants.includes(r.variant) ? r.variant : base.variant || variants[0]) : '',
  };
}

export function sanitizeScene(raw: unknown): HoloScene {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    background: r.background === 'stars' || r.background === 'void' || r.background === 'grid' ? r.background : DEFAULT_SCENE.background,
    lighting: clamp(r.lighting, ...LIMITS.lighting, DEFAULT_SCENE.lighting),
  };
}

/** Validate a whole layout (e.g. loaded from the server). Unknown objects are dropped. */
export function sanitizeLayout(raw: unknown): HoloLayout {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const seen = new Set<string>();
  const objects: HoloObject[] = [];
  const list = Array.isArray(r.objects) ? r.objects.slice(0, LIMITS.maxObjects) : [];
  list.forEach((o, i) => {
    const obj = sanitizeObject(o, `o${i}`);
    if (!obj) return;
    if (seen.has(obj.id)) obj.id = `${obj.id}-${i}`;
    seen.add(obj.id);
    objects.push(obj);
  });
  return {
    version: 1,
    name: str(r.name, LIMITS.maxName, 'Untitled hologram').trim() || 'Untitled hologram',
    scene: sanitizeScene(r.scene),
    objects,
  };
}
