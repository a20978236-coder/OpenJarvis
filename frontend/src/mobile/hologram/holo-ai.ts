/**
 * AI fallback for hologram commands the offline parser doesn't recognise.
 *
 * The model (on the user's own server, through /v1/chat/completions) must
 * answer with JSON in the same operation vocabulary the editor uses. Its
 * answer is untrusted: it is parsed leniently, every op is checked against
 * an allow-list, targets are resolved to real object ids, and the editor's
 * own validation clamps every value. If nothing valid comes back, nothing
 * changes and HELL says so.
 */
import { apiFetch } from '../../lib/api';
import { stripThinkTags } from '../../lib/message-text';
import { HOLO_TYPES, isHoloType, type HoloLayout, type HoloObject } from './holo-types';
import type { AlignMode, HoloOp } from './holo-ops';
import type { CommandAction, CommandResult } from './holo-commands';

const MAX_OPS = 30;
const ALIGN_MODES: AlignMode[] = ['center', 'center-x', 'center-y', 'left', 'right', 'top', 'bottom', 'grid', 'face'];
const PROP_KEYS = ['name', 'position', 'rotation', 'scale', 'color', 'opacity', 'glow', 'density', 'animSpeed', 'rotSpeed', 'shape', 'border', 'text', 'value', 'variant'] as const;

export function buildSystemPrompt(): string {
  return [
    'You control a 3D hologram editor. Reply with ONLY one JSON object, no prose, no markdown:',
    '{"ops":[...],"reply":"one short sentence for the user"}',
    'Operations:',
    '{"op":"add","type":TYPE,"props":{...}}',
    '{"op":"update","target":TARGET,"props":{...}}',
    '{"op":"move","target":TARGET,"by":[dx,dy,dz]}',
    '{"op":"remove","target":TARGET}',
    '{"op":"duplicate","target":TARGET}',
    `{"op":"align","target":TARGET,"mode":${ALIGN_MODES.map((m) => `"${m}"`).join('|')}}`,
    '{"op":"scene","props":{"background":"grid"|"stars"|"void","lighting":0.3-2}}',
    '{"op":"rename","name":"..."}',
    '{"op":"save"}',
    `TYPE: ${HOLO_TYPES.join(', ')}. rotating has variant planet|cube|torus|crystal|city; graph has variant line|bars.`,
    'TARGET: an object id from the layout, "selected", or a TYPE (means the most recent object of that type).',
    'props: position [x,y,z] (x -1.2..1.2, y -2.4..2.4, z -3..3, centre is 0,0,0), rotation [x,y,z] degrees,',
    'scale 0.2-4, color "#rrggbb" or a colour name, opacity 0.1-1, glow 0-2, density 0.2-2, animSpeed 0-3,',
    'rotSpeed -180..180 (degrees per second), shape "chamfer"|"rect"|"round", border true|false, text, value, name.',
    'Use only the operations above. If the request cannot be done with them, return {"ops":[],"reply":"<why>"}.',
  ].join('\n');
}

function summarize(layout: HoloLayout, selectedId: string | null): string {
  const objs = layout.objects.slice(-40).map((o) => ({
    id: o.id,
    type: o.type,
    ...(o.variant ? { variant: o.variant } : {}),
    name: o.name,
    color: o.color,
    position: o.position,
    scale: Number(o.scale.toFixed(2)),
    ...(o.text ? { text: o.text.slice(0, 40) } : {}),
  }));
  return JSON.stringify({ selected: selectedId, background: layout.scene.background, objects: objs });
}

/** Find the first balanced {...} in model output (ignoring fences and chatter). */
export function extractJson(text: string): unknown {
  const t = stripThinkTags(text).replace(/```(?:json)?/gi, '');
  const start = t.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      try {
        return JSON.parse(t.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function pickProps(raw: unknown): Partial<HoloObject> {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of PROP_KEYS) if (k in r) out[k] = r[k];
  return out as Partial<HoloObject>;
}

function resolve(target: unknown, layout: HoloLayout, selectedId: string | null): string | null {
  if (typeof target !== 'string') return null;
  const t = target.trim();
  if (t === 'selected' || t === 'it' || t === 'that') return selectedId && layout.objects.some((o) => o.id === selectedId) ? selectedId : null;
  if (layout.objects.some((o) => o.id === t)) return t;
  if (isHoloType(t)) {
    const of = layout.objects.filter((o) => o.type === t);
    return of.length ? of[of.length - 1].id : null;
  }
  return null;
}

/** Turn the model's JSON into safe editor ops. Unknown or unresolvable ops are dropped. */
export function toCommandResult(parsed: unknown, layout: HoloLayout, selectedId: string | null): CommandResult {
  const obj = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;
  const list = Array.isArray(obj.ops) ? obj.ops.slice(0, MAX_OPS) : [];
  const ops: HoloOp[] = [];
  const actions: CommandAction[] = [];
  let dropped = 0;
  for (const raw of list) {
    const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const id = resolve(o.target ?? o.id, layout, selectedId);
    switch (o.op) {
      case 'add':
        if (isHoloType(o.type)) ops.push({ op: 'add', type: o.type, props: pickProps(o.props) });
        else dropped++;
        break;
      case 'update':
        if (id) ops.push({ op: 'update', id, props: pickProps(o.props) });
        else dropped++;
        break;
      case 'move': {
        const by = Array.isArray(o.by) && o.by.length === 3 ? (o.by.map((v) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-3, Math.min(3, v)) : 0)) as [number, number, number]) : null;
        if (id && by) ops.push({ op: 'move', id, by });
        else dropped++;
        break;
      }
      case 'remove':
      case 'duplicate':
        if (id) ops.push({ op: o.op, id });
        else dropped++;
        break;
      case 'align':
        if (id && ALIGN_MODES.includes(o.mode as AlignMode)) ops.push({ op: 'align', id, mode: o.mode as AlignMode });
        else dropped++;
        break;
      case 'scene': {
        const sp = (o.props && typeof o.props === 'object' ? o.props : {}) as Record<string, unknown>;
        const props: Record<string, unknown> = {};
        if ('background' in sp) props.background = sp.background;
        if ('lighting' in sp) props.lighting = sp.lighting;
        if (Object.keys(props).length) ops.push({ op: 'scene', props: props as never });
        else dropped++;
        break;
      }
      case 'rename':
        if (typeof o.name === 'string') ops.push({ op: 'rename', name: o.name });
        else dropped++;
        break;
      case 'save':
        actions.push({ kind: 'save' });
        break;
      default:
        dropped++;
    }
  }
  let reply = typeof obj.reply === 'string' ? obj.reply.slice(0, 240) : '';
  if (!ops.length && !actions.length) reply = reply || "I couldn't turn that into hologram changes. Try naming an object, like “add a clock”.";
  else if (dropped) reply = `${reply ? `${reply} ` : ''}(Skipped ${dropped} step${dropped === 1 ? '' : 's'} I couldn't apply.)`.trim();
  return { ops, actions, reply: reply || 'Done.' };
}

export async function askHologramAI(
  text: string,
  layout: HoloLayout,
  selectedId: string | null,
  model: string,
  signal?: AbortSignal,
): Promise<CommandResult> {
  if (!model) return { ops: [], actions: [], reply: 'No AI model is available on the server, so I can only follow the built-in commands.' };
  const res = await apiFetch('/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      model,
      stream: false,
      temperature: 0.1,
      max_tokens: 900,
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        { role: 'user', content: `Layout: ${summarize(layout, selectedId)}\nRequest: ${text}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`The AI model didn't answer (HTTP ${res.status})`);
  const body = await res.json();
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('The AI model sent an empty answer');
  return toCommandResult(extractJson(content), layout, selectedId);
}

/** Labels for the suggestion chips. */
export const SUGGESTIONS = [
  'Create a dashboard around the orb',
  'Build me a 3D rotating planet',
  'Add a floating screen',
  'Make everything blue',
  'Make it larger',
  'Save this layout',
];

