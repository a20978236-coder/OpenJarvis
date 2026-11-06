/**
 * Every change to a hologram layout is one of these operations. The editor
 * UI dispatches them, undo/redo snapshots around them, and Stage C2's AI
 * builder will emit the same operations — so "build me a planet" performs
 * real edits rather than describing them.
 *
 * `applyOp` is pure: it never mutates its input and always returns a valid
 * layout, rejecting (with a reason) anything it cannot do.
 */
import {
  CATALOG,
  LIMITS,
  sanitizeLayout,
  sanitizeObject,
  sanitizeScene,
  type HoloLayout,
  type HoloObject,
  type HoloScene,
  type HoloType,
  type Vec3,
} from './holo-types';

export type AlignMode = 'center' | 'center-x' | 'center-y' | 'left' | 'right' | 'top' | 'bottom' | 'grid' | 'face';

export type HoloOp =
  | { op: 'add'; type: HoloType; props?: Partial<HoloObject> }
  | { op: 'update'; id: string; props: Partial<HoloObject> }
  | { op: 'move'; id: string; by: Vec3 }
  | { op: 'remove'; id: string }
  | { op: 'duplicate'; id: string }
  | { op: 'align'; id: string; mode: AlignMode }
  | { op: 'scene'; props: Partial<HoloScene> }
  | { op: 'rename'; name: string }
  | { op: 'clear' };

export interface OpResult {
  layout: HoloLayout;
  /** Object created by add/duplicate, for selecting it. */
  createdId?: string;
  /** Set when the op could not be applied (layout returned unchanged). */
  error?: string;
}

export const GRID = 0.25;
/** Edges used by left/right/top/bottom alignment, in world units. Portrait-first (iPhone). */
export const STAGE_BOUNDS = { x: 1.2, y: 2.4 };

export function snapValue(v: number, step = GRID): number {
  return Math.round(v / step) * step;
}

let counter = 0;
/** Short unique ids; injectable for deterministic tests. */
export let newId = (): string => `h${Date.now().toString(36)}${(counter++).toString(36)}`;
export function __setIdFactory(f: () => string) {
  newId = f;
}

/**
 * Where a new object lands: a portrait-friendly column around the centre
 * (the builder is designed for iPhone), stepping back in depth each round
 * so additions never stack exactly.
 */
function placement(layout: HoloLayout): Vec3 {
  const n = layout.objects.length;
  if (n === 0) return [0, 0, 0];
  const slots = [
    [0, 1.45], [0, -1.45], [-0.75, 0.75], [0.75, -0.75], [0.75, 0.75], [-0.75, -0.75], [0, 2.4], [0, -2.4],
  ];
  const [x, y] = slots[(n - 1) % slots.length];
  return [x, y, -0.35 * Math.floor((n - 1) / slots.length)];
}

const find = (layout: HoloLayout, id: string) => layout.objects.find((o) => o.id === id);

export function applyOp(layout: HoloLayout, op: HoloOp): OpResult {
  switch (op.op) {
    case 'add': {
      if (!(op.type in CATALOG)) return { layout, error: `Unknown object type "${op.type}"` };
      if (layout.objects.length >= LIMITS.maxObjects) return { layout, error: `A layout can hold at most ${LIMITS.maxObjects} objects` };
      const id = newId();
      const obj = sanitizeObject({ position: placement(layout), ...op.props, id, type: op.type }, id);
      if (!obj) return { layout, error: 'Could not create that object' };
      return { layout: { ...layout, objects: [...layout.objects, obj] }, createdId: obj.id };
    }
    case 'update': {
      const cur = find(layout, op.id);
      if (!cur) return { layout, error: 'That object no longer exists' };
      // id and type are fixed for the object's life.
      const next = sanitizeObject({ ...cur, ...op.props, id: cur.id, type: cur.type });
      if (!next) return { layout, error: 'Invalid change' };
      return { layout: { ...layout, objects: layout.objects.map((o) => (o.id === op.id ? next : o)) } };
    }
    case 'move': {
      const cur = find(layout, op.id);
      if (!cur) return { layout, error: 'That object no longer exists' };
      const [dx, dy, dz] = op.by.map((v) => (Number.isFinite(v) ? v : 0));
      return applyOp(layout, { op: 'update', id: op.id, props: { position: [cur.position[0] + dx, cur.position[1] + dy, cur.position[2] + dz] } });
    }
    case 'remove': {
      if (!find(layout, op.id)) return { layout, error: 'That object no longer exists' };
      return { layout: { ...layout, objects: layout.objects.filter((o) => o.id !== op.id) } };
    }
    case 'duplicate': {
      const cur = find(layout, op.id);
      if (!cur) return { layout, error: 'That object no longer exists' };
      if (layout.objects.length >= LIMITS.maxObjects) return { layout, error: `A layout can hold at most ${LIMITS.maxObjects} objects` };
      const id = newId();
      const copy = sanitizeObject({ ...cur, id, name: `${cur.name} copy`.slice(0, LIMITS.maxName), position: [cur.position[0] + 0.35, cur.position[1] - 0.35, cur.position[2]] });
      if (!copy) return { layout, error: 'Could not duplicate' };
      return { layout: { ...layout, objects: [...layout.objects, copy] }, createdId: id };
    }
    case 'align': {
      const cur = find(layout, op.id);
      if (!cur) return { layout, error: 'That object no longer exists' };
      const [x, y, z] = cur.position;
      const pos: Record<AlignMode, Vec3 | null> = {
        center: [0, 0, z],
        'center-x': [0, y, z],
        'center-y': [x, 0, z],
        left: [-STAGE_BOUNDS.x, y, z],
        right: [STAGE_BOUNDS.x, y, z],
        top: [x, STAGE_BOUNDS.y, z],
        bottom: [x, -STAGE_BOUNDS.y, z],
        grid: [snapValue(x), snapValue(y), snapValue(z)],
        face: null,
      };
      if (op.mode === 'face') return applyOp(layout, { op: 'update', id: op.id, props: { rotation: [0, 0, 0] } });
      const p = pos[op.mode];
      if (!p) return { layout, error: `Unknown alignment "${op.mode}"` };
      return applyOp(layout, { op: 'update', id: op.id, props: { position: p } });
    }
    case 'scene':
      return { layout: { ...layout, scene: sanitizeScene({ ...layout.scene, ...op.props }) } };
    case 'rename': {
      const name = sanitizeLayout({ ...layout, name: op.name }).name;
      return { layout: { ...layout, name } };
    }
    case 'clear':
      return { layout: { ...layout, objects: [] } };
    default:
      return { layout, error: 'Unknown operation' };
  }
}

/** A fresh layout: the HELL orb at the centre. */
export function starterLayout(): HoloLayout {
  const empty = sanitizeLayout({ name: 'My hologram', objects: [] });
  return applyOp(empty, { op: 'add', type: 'orb', props: { position: [0, 0, 0] } }).layout;
}
