/**
 * Natural-language hologram commands → real editor operations.
 *
 * `parseCommand` is a deterministic, offline parser for the common phrasing
 * ("create a floating screen", "make the orb larger", "move that panel to
 * the left", "make everything blue", "save this layout"). Anything it does
 * not recognise returns `null`, and the caller may ask the AI model
 * (see holo-ai.ts), whose answer must use the same operation vocabulary.
 *
 * Nothing here mutates state: it returns ops for `useHolo.applyMany`, so a
 * whole sentence is one undo step.
 */
import { CATALOG, sanitizeColor, type HoloLayout, type HoloObject, type HoloType, type Vec3 } from './holo-types';
import type { AlignMode, HoloOp } from './holo-ops';

export type CommandAction = { kind: 'save'; name?: string } | { kind: 'undo' } | { kind: 'redo' } | { kind: 'select'; id: string };

export interface CommandResult {
  ops: HoloOp[];
  actions: CommandAction[];
  /** What HELL says back. */
  reply: string;
}

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** Longest phrases first so "particle sphere" beats "sphere", "control panel" beats "panel". */
const NOUNS: Array<[RegExp, HoloType, Partial<HoloObject>?]> = [
  [/\b(?:floating\s+)?(?:holo(?:graphic)?\s+)?(?:screen|display|monitor)s?\b/, 'screen'],
  [/\bparticle\s+(?:sphere|ball|cloud)s?\b/, 'sphere'],
  [/\b(?:ai\s+|assistant\s+|hell\s+|particle\s+)?orbs?\b/, 'orb'],
  [/\b(?:control\s+panel|controls?|dials?|switch(?:es)?\s+panel)s?\b/, 'panel'],
  [/\bcamera(?:\s+(?:display|feed|view|screen|panel))?s?\b/, 'camera'],
  [/\bweather(?:\s+(?:display|panel|widget))?\b/, 'weather'],
  [/\b(?:digital\s+)?clocks?\b/, 'clock'],
  [/\bbar\s+(?:graph|chart)s?\b/, 'graph', { variant: 'bars' }],
  [/\b(?:animated\s+)?(?:line\s+)?(?:graph|chart)s?\b/, 'graph'],
  [/\b(?:system\s+)?(?:diagnostics?|system\s+status|stats\s+panel)\b/, 'diagnostics'],
  [/\b(?:holo(?:graphic)?\s+)?(?:map|terrain)s?\b/, 'map'],
  [/\b(?:voice\s+)?(?:wave\s?form|visuali[sz]er|audio\s+bars)s?\b/, 'waveform'],
  [/\bmemory\s+(?:map|visuali[sz]ation|graph|cloud|web)s?\b/, 'memory'],
  [/\bplanets?\b|\bglobes?\b/, 'rotating', { variant: 'planet' }],
  [/\bcubes?\b|\bboxe?s?\b/, 'rotating', { variant: 'cube' }],
  [/\b(?:torus|toruses|tori|donuts?|rings?)\b/, 'rotating', { variant: 'torus' }],
  [/\bcrystals?\b|\bdiamonds?\b|\bgems?\b/, 'rotating', { variant: 'crystal' }],
  [/\b(?:city|cities|skyline|buildings?)\b/, 'rotating', { variant: 'city' }],
  [/\b(?:3d\s+)?(?:rotating|spinning)\s+(?:object|shape)s?\b/, 'rotating'],
  [/\b(?:text(?:\s+panel)?|label|caption|sign)s?\b/, 'text'],
  [/\b(?:custom\s+)?widgets?\b|\bgauges?\b|\bstats?\b/, 'widget'],
];

const COLOR_WORDS = [
  'electric blue', 'light blue', 'dark blue', 'blue', 'cyan', 'teal', 'navy', 'indigo', 'purple', 'violet', 'green', 'emerald',
  'yellow', 'gold', 'orange', 'amber', 'red', 'pink', 'magenta', 'white', 'silver', 'grey', 'gray',
];
const COLOR_ALIASES: Record<string, string> = { 'electric blue': 'blue', 'light blue': 'cyan', 'dark blue': 'navy' };
const COLOR_RE = new RegExp(`\\b(${COLOR_WORDS.join('|')})\\b`);

function colorIn(s: string): string | undefined {
  const hex = s.match(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/);
  if (hex) return sanitizeColor(hex[0]);
  const m = s.match(COLOR_RE);
  return m ? sanitizeColor(COLOR_ALIASES[m[1]] ?? m[1]) : undefined;
}

function nounIn(s: string): { type: HoloType; props: Partial<HoloObject>; match: string } | null {
  let best: { type: HoloType; props: Partial<HoloObject>; match: string; at: number } | null = null;
  for (const [re, type, props] of NOUNS) {
    const m = s.match(re);
    // Earliest mention wins; ties go to the longer (more specific) phrase.
    if (m && m.index !== undefined && (!best || m.index < best.at || (m.index === best.at && m[0].length > best.match.length))) {
      best = { type, props: props ?? {}, match: m[0], at: m.index };
    }
  }
  return best ? { type: best.type, props: best.props, match: best.match } : null;
}

const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, couple: 2, few: 3 };

function countIn(s: string): number {
  const m = s.match(/\b(\d+|one|two|three|four|five|six|a couple of|a few)\b/);
  if (!m) return 1;
  const w = m[1].replace(/^a (couple of|few)$/, '$1').replace(/ of$/, '');
  const n = /^\d+$/.test(w) ? Number(w) : NUMBER_WORDS[w] ?? 1;
  return Math.max(1, Math.min(8, n));
}

function quotedIn(raw: string): string | undefined {
  const m = raw.match(/["“”']([^"“”']{1,200})["“”']/) || raw.match(/\b(?:saying|that says|reading|with (?:the )?text|labell?ed|called|named)\s+(.{1,200})$/i);
  return m ? m[1].trim().replace(/[.!?]+$/, '') : undefined;
}

// ---------------------------------------------------------------------------
// Targets: "that", "it", "the selected panel", "the orb", "the blue screen"
// ---------------------------------------------------------------------------

function resolveTarget(s: string, layout: HoloLayout, selectedId: string | null): HoloObject | 'all' | null {
  if (/\b(everything|all(?: objects| of them| panels)?|the (?:whole )?(?:interface|hologram|layout|scene))\b/.test(s)) return 'all';
  const noun = nounIn(s);
  const pronoun = /\b(that|it|this|selected|the selection)\b/.test(s);
  const selected = layout.objects.find((o) => o.id === selectedId) ?? null;
  // No object named: "make it bigger" / "move left" act on the selection.
  if (!noun) return selected;
  // "that panel" / "the selected panel": prefer the selection if it matches.
  if (selected && selected.type === noun.type && (pronoun || /\bthe\b/.test(s))) return selected;
  const candidates = layout.objects.filter((o) => o.type === noun.type && (!noun.props.variant || o.variant === noun.props.variant));
  if (!candidates.length) return null;
  const color = colorIn(s.replace(noun.match, ''));
  const byColor = color ? candidates.filter((o) => o.color === color) : [];
  // Most recently added wins when ambiguous.
  return (byColor.length ? byColor : candidates)[(byColor.length ? byColor : candidates).length - 1];
}

const describe = (o: HoloObject) => o.name || CATALOG[o.type].label;

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

function dashboardAroundOrb(layout: HoloLayout, color?: string): HoloOp[] {
  const ops: HoloOp[] = [];
  const c = color ? { color } : {};
  const orb = layout.objects.find((o) => o.type === 'orb');
  if (orb) ops.push({ op: 'update', id: orb.id, props: { position: [0, 0, 0], ...c } });
  else ops.push({ op: 'add', type: 'orb', props: { position: [0, 0, 0], ...c } });
  const ring: Array<[HoloType, Vec3, Partial<HoloObject>?]> = [
    ['clock', [0, 1.75, -0.2]],
    ['weather', [-0.85, 1.0, -0.4], { scale: 0.65 }],
    ['diagnostics', [0.85, 1.0, -0.4], { scale: 0.65 }],
    ['graph', [-0.85, -1.05, -0.4], { scale: 0.65 }],
    ['panel', [0.85, -1.05, -0.4], { scale: 0.65 }],
    ['waveform', [0, -1.75, -0.2], { scale: 0.8 }],
  ];
  for (const [type, position, props] of ring) {
    ops.push({ op: 'add', type, props: { position, rotation: [0, position[0] > 0 ? -18 : position[0] < 0 ? 18 : 0, 0], ...props, ...c } });
  }
  return ops;
}

function controlCenter(color?: string): HoloOp[] {
  const c = color ? { color } : {};
  const items: Array<[HoloType, Vec3, Partial<HoloObject>?]> = [
    ['screen', [0, 1.5, -0.3], { text: 'COMMAND CENTER', value: 'All systems online', scale: 1.1 }],
    ['panel', [-0.8, 0.25, 0], { scale: 0.7, rotation: [0, 20, 0] }],
    ['diagnostics', [0.8, 0.25, 0], { scale: 0.7, rotation: [0, -20, 0] }],
    ['map', [0, -1.1, 0.2], { scale: 0.9 }],
    ['clock', [-0.8, -2.1, -0.2], { scale: 0.55 }],
    ['widget', [0.8, -2.1, -0.2], { text: 'STATUS', value: 'NOMINAL', scale: 0.6 }],
  ];
  return items.map(([type, position, props]) => ({ op: 'add', type, props: { position, ...props, ...c } }) as HoloOp);
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/^\s*(?:hey\s+)?hell[,:!.]?\s+/, '')
    .replace(/\b(?:please|could you|can you|would you|i want you to|i'd like you to|go ahead and|for me|now)\b/g, ' ')
    .replace(/[!?]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.$/, '');
}

const SIZE_UP = /\b(larger|bigger|grow|enlarge|huge|massive|double)\b/;
const SIZE_DOWN = /\b(smaller|shrink|tiny|half|reduce(?: the)? size)\b/;

export function parseCommand(text: string, layout: HoloLayout, selectedId: string | null): CommandResult | null {
  const raw = text.trim();
  const s = normalize(raw);
  if (!s) return null;
  const none = (reply: string): CommandResult => ({ ops: [], actions: [], reply });

  // -- history & save --------------------------------------------------------
  if (/^(undo|undo that|go back|take that back)$/.test(s)) return { ops: [], actions: [{ kind: 'undo' }], reply: 'Undone.' };
  if (/^(redo|redo that)$/.test(s)) return { ops: [], actions: [{ kind: 'redo' }], reply: 'Redone.' };
  const save = s.match(/^save(?: this| the| my)?(?: hologram| holo| layout| design| interface| scene)*(?: layout)?(?: as (.+))?$/);
  if (save) {
    const name = save[1] ? raw.replace(/^.*?\bas\s+/i, '').replace(/[.!?]+$/, '').trim() : undefined;
    return {
      ops: name ? [{ op: 'rename', name }] : [],
      actions: [{ kind: 'save', name }],
      reply: name ? `Saving as “${name}”.` : 'Saving this hologram.',
    };
  }
  if (/^(clear|wipe|reset)(?: the| this| everything| all)*(?: hologram| layout| workspace| scene)?$/.test(s) || /^(delete|remove) everything$/.test(s)) {
    return { ops: [{ op: 'clear' }], actions: [], reply: 'Cleared the workspace.' };
  }

  // -- scene -----------------------------------------------------------------
  if (/\b(background|backdrop|scene)\b|\bstar ?field\b/.test(s) && !/\b(add|create|build)\b/.test(s)) {
    if (/\bstars?|star ?field|space|galaxy\b/.test(s)) return { ops: [{ op: 'scene', props: { background: 'stars' } }], actions: [], reply: 'Switched to a starfield.' };
    if (/\bgrid|floor\b/.test(s)) return { ops: [{ op: 'scene', props: { background: 'grid' } }], actions: [], reply: 'Grid floor on.' };
    if (/\b(none|no|plain|empty|black|void|clear)\b/.test(s)) return { ops: [{ op: 'scene', props: { background: 'void' } }], actions: [], reply: 'Background off.' };
  }
  if (/\b(brighter|dimmer|darker)\b/.test(s) && /\b(scene|everything|all|lighting|lights)\b/.test(s)) {
    const up = /brighter/.test(s);
    return { ops: [{ op: 'scene', props: { lighting: layout.scene.lighting + (up ? 0.3 : -0.3) } }], actions: [], reply: up ? 'Brighter.' : 'Dimmer.' };
  }

  // -- templates -------------------------------------------------------------
  const tplColor = colorIn(s);
  if (/\b(dashboard|hud)\b.*\b(around|round|surrounding)\b.*\borb\b/.test(s) || /\borb\b.*\b(dashboard|hud)\b/.test(s)) {
    return { ops: dashboardAroundOrb(layout, tplColor), actions: [], reply: 'Built a dashboard around the orb: clock, weather, diagnostics, graph, controls and a voice waveform.' };
  }
  if (/\b(control|command|mission) (center|centre|deck|hub)\b/.test(s)) {
    return { ops: controlCenter(tplColor), actions: [], reply: 'Built a holographic control center.' };
  }

  // -- create ----------------------------------------------------------------
  const create = s.match(/^(?:create|add|build|make|put|place|give me|show|spawn|generate|i need|i want|let's have)\b(.*)$/);
  // "make THE screen say…", "put THAT panel…", "show IT bigger" edit an existing object.
  const editsExisting = /^(?:make|put|place|show|set|turn)\s+(?:the|that|this|it|its|my|everything|all)\b/.test(s);
  if (create && !editsExisting && !/^make\b.*\b(larger|bigger|smaller|brighter|dimmer|faster|slower|transparent|spin|rotate|face|red|blue|green|cyan|purple|violet|white|gold|orange|pink|yellow|teal|grey|gray|silver|magenta|amber|navy|indigo|emerald)\s*$/.test(s)) {
    const rest = create[1];
    const noun = nounIn(rest);
    if (noun) {
      const n = countIn(rest.slice(0, rest.indexOf(noun.match) + 1));
      const props: Partial<HoloObject> = { ...noun.props };
      const color = colorIn(rest.replace(noun.match, ' '));
      if (color) props.color = color;
      if (/\b(big|large|huge|giant)\b/.test(rest)) props.scale = (CATALOG[noun.type].defaults.scale ?? 1) * 1.5;
      if (/\b(small|tiny|mini|little)\b/.test(rest)) props.scale = (CATALOG[noun.type].defaults.scale ?? 1) * 0.6;
      if (/\b(rotating|spinning|turning|orbiting)\b/.test(rest)) props.rotSpeed = 25;
      if (/\bbars?\b/.test(rest) && noun.type === 'graph') props.variant = 'bars';
      const words = quotedIn(raw);
      if (words) {
        if (noun.type === 'widget') props.value = words;
        else props.text = words;
      }
      if (/\b(on|to|at) the left\b/.test(rest)) props.position = [-1, 0, 0];
      else if (/\b(on|to|at) the right\b/.test(rest)) props.position = [1, 0, 0];
      else if (/\b(above|on top|at the top)\b/.test(rest)) props.position = [0, 1.8, 0];
      else if (/\b(below|underneath|at the bottom)\b/.test(rest)) props.position = [0, -1.8, 0];
      const ops: HoloOp[] = [];
      for (let i = 0; i < n; i++) {
        const p = { ...props };
        if (n > 1 && !props.position) p.position = [(i - (n - 1) / 2) * 0.9, 0, 0];
        ops.push({ op: 'add', type: noun.type, props: p });
      }
      const label = CATALOG[noun.type].label.toLowerCase();
      const what = noun.type === 'rotating' && props.variant ? `${props.rotSpeed ? 'rotating ' : ''}${props.variant}` : label;
      return { ops, actions: [], reply: n > 1 ? `Created ${n} ${what}s.` : `Created a ${color ? `${Object.keys(COLOR_ALIASES).concat(COLOR_WORDS).find((w) => s.includes(w)) ?? ''} ` : ''}${what}.`.replace(/\s+/g, ' ') };
    }
  }

  // -- everything else needs a target ----------------------------------------
  const target = resolveTarget(s, layout, selectedId);
  const targets: HoloObject[] = target === 'all' ? layout.objects : target ? [target] : [];
  const needTarget = (): CommandResult =>
    none(layout.objects.length ? "I'm not sure which object you mean. Tap one to select it, or name it (\"the clock\")." : 'There is nothing in the workspace yet.');

  // remove / duplicate / select
  if (/^(remove|delete|get rid of|hide|destroy|erase)\b/.test(s)) {
    if (!targets.length) return needTarget();
    return { ops: targets.map((o) => ({ op: 'remove', id: o.id }) as HoloOp), actions: [], reply: targets.length > 1 ? `Removed ${targets.length} objects.` : `Removed the ${describe(targets[0])}.` };
  }
  if (/^(duplicate|copy|clone)\b/.test(s)) {
    if (!targets.length || target === 'all') return needTarget();
    return { ops: [{ op: 'duplicate', id: targets[0].id }], actions: [], reply: `Duplicated the ${describe(targets[0])}.` };
  }
  if (/^(select|pick|choose|highlight)\b/.test(s)) {
    if (!targets.length || target === 'all') return needTarget();
    return { ops: [], actions: [{ kind: 'select', id: targets[0].id }], reply: `Selected the ${describe(targets[0])}.` };
  }

  // move
  const moveRe = /\b(move|shift|slide|push|put|drag|bring|send)\b/;
  if (moveRe.test(s) || /^(left|right|up|down)\b/.test(s)) {
    if (!targets.length) return needTarget();
    const edge: Array<[RegExp, AlignMode]> = [
      [/\b(to the )?(center|centre|middle)\b/, 'center'],
      [/\bleft edge\b|\bfar left\b|\ball the way (to the )?left\b/, 'left'],
      [/\bright edge\b|\bfar right\b|\ball the way (to the )?right\b/, 'right'],
      [/\b(top|top edge)\b/, 'top'],
      [/\b(bottom|bottom edge)\b/, 'bottom'],
    ];
    for (const [re, mode] of edge) {
      if (re.test(s)) return { ops: targets.map((o) => ({ op: 'align', id: o.id, mode }) as HoloOp), actions: [], reply: `Moved the ${targets.length > 1 ? 'objects' : describe(targets[0])} to the ${mode === 'center' ? 'centre' : mode}.` };
    }
    const amt = /\b(a lot|far|way)\b/.test(s) ? 1 : /\b(a (?:little|bit|touch)|slightly|nudge)\b/.test(s) ? 0.2 : 0.5;
    const by: Vec3 = [0, 0, 0];
    if (/\bleft\b/.test(s)) by[0] -= amt;
    if (/\bright\b/.test(s)) by[0] += amt;
    if (/\b(up|higher|raise)\b/.test(s)) by[1] += amt;
    if (/\b(down|lower)\b/.test(s)) by[1] -= amt;
    if (/\b(forward|closer|toward me|towards me|front)\b/.test(s)) by[2] += amt;
    if (/\b(back|backward|backwards|further|farther|away|behind)\b/.test(s)) by[2] -= amt;
    if (by.every((v) => v === 0)) return none('Which way? Try "move it left", "up a little", or "to the centre".');
    return { ops: targets.map((o) => ({ op: 'move', id: o.id, by }) as HoloOp), actions: [], reply: `Moved the ${targets.length > 1 ? 'objects' : describe(targets[0])}.` };
  }

  // size
  if (SIZE_UP.test(s) || SIZE_DOWN.test(s) || /\bresize\b/.test(s)) {
    if (!targets.length) return needTarget();
    const f = /\bdouble\b/.test(s) ? 2 : /\bhalf\b/.test(s) ? 0.5 : /\b(huge|massive|much)\b/.test(s) ? (SIZE_DOWN.test(s) ? 0.6 : 1.6) : SIZE_DOWN.test(s) ? 1 / 1.3 : 1.3;
    return {
      ops: targets.map((o) => ({ op: 'update', id: o.id, props: { scale: o.scale * f } }) as HoloOp),
      actions: [],
      reply: `Made the ${targets.length > 1 ? 'objects' : describe(targets[0])} ${f > 1 ? 'larger' : 'smaller'}.`,
    };
  }

  // spin
  // "turn" means rotate only with a direction or angle ("turn it 45 degrees"), never "turn it red".
  if (/\b(spin|rotate|rotating|spinning)\b/.test(s) || (/\bturn\b/.test(s) && /\b(around|degrees?|°|left|right|clockwise)\b/.test(s) && !colorIn(s))) {
    if (!targets.length) return needTarget();
    const stop = /\b(stop|freeze|don't|no longer|halt)\b/.test(s);
    const faster = /\bfaster\b/.test(s);
    const slower = /\bslower\b/.test(s);
    const reverse = /\b(reverse|other way|backwards?|counter)\b/.test(s);
    const angle = s.match(/\b(-?\d{1,3})\s*(?:degrees?|°)/);
    return {
      ops: targets.map((o) => {
        if (angle) return { op: 'update', id: o.id, props: { rotation: [o.rotation[0], o.rotation[1] + Number(angle[1]), o.rotation[2]] } } as HoloOp;
        const cur = o.rotSpeed || 0;
        const rotSpeed = stop ? 0 : faster ? (cur || 20) * 1.8 : slower ? cur * 0.5 : reverse ? -(cur || 25) : cur || 25;
        return { op: 'update', id: o.id, props: { rotSpeed } } as HoloOp;
      }),
      actions: [],
      reply: stop ? 'Stopped spinning.' : angle ? `Turned it ${angle[1]}°.` : faster ? 'Spinning faster.' : slower ? 'Spinning slower.' : 'Spinning.',
    };
  }
  if (/\bface (?:me|forward|the front)\b|\bstraighten\b/.test(s)) {
    if (!targets.length) return needTarget();
    return { ops: targets.map((o) => ({ op: 'align', id: o.id, mode: 'face' }) as HoloOp), actions: [], reply: 'Facing forward.' };
  }

  // glow / transparency
  if (/\b(brighter|glow more|more glow|dimmer|less glow|glow less|darker)\b/.test(s)) {
    if (!targets.length) return needTarget();
    const up = /\b(brighter|glow more|more glow)\b/.test(s);
    return { ops: targets.map((o) => ({ op: 'update', id: o.id, props: { glow: o.glow + (up ? 0.35 : -0.35) } }) as HoloOp), actions: [], reply: up ? 'Brighter.' : 'Dimmer.' };
  }
  if (/\b(more transparent|see-?through|fainter|ghostly|more solid|less transparent|opaque)\b/.test(s)) {
    if (!targets.length) return needTarget();
    const clearer = /\b(more transparent|see-?through|fainter|ghostly)\b/.test(s);
    return { ops: targets.map((o) => ({ op: 'update', id: o.id, props: { opacity: o.opacity + (clearer ? -0.25 : 0.25) } }) as HoloOp), actions: [], reply: clearer ? 'More transparent.' : 'More solid.' };
  }
  if (/\b(more|denser|fewer|less) particles?\b|\bdenser\b|\bsparser\b/.test(s)) {
    if (!targets.length) return needTarget();
    const up = /\b(more|denser)\b/.test(s);
    return { ops: targets.map((o) => ({ op: 'update', id: o.id, props: { density: o.density * (up ? 1.4 : 0.7) } }) as HoloOp), actions: [], reply: up ? 'More particles.' : 'Fewer particles.' };
  }

  // rename text: "change the text to X" / "make the screen say X"
  const sayM = raw.match(/\b(?:say|says|read|reads|text to|title to|label to|caption to)\s+["“”']?(.{1,200}?)["“”']?\s*[.!?]?$/i);
  if (sayM && /\b(say|says|read|reads|text|title|label|caption)\b/.test(s)) {
    if (!targets.length || target === 'all') return needTarget();
    const o = targets[0];
    const field = o.type === 'widget' && /\bvalue\b/.test(s) ? 'value' : 'text';
    return { ops: [{ op: 'update', id: o.id, props: { [field]: sayM[1].trim() } }], actions: [], reply: `Updated the ${describe(o)}.` };
  }

  // colour: "make the interface blue", "turn it red", "color the orb gold"
  const color = colorIn(s);
  if (color && /\b(make|turn|colou?r|paint|change|set|switch)\b/.test(s)) {
    if (!targets.length) return needTarget();
    return {
      ops: targets.map((o) => ({ op: 'update', id: o.id, props: { color } }) as HoloOp),
      actions: [],
      reply: target === 'all' ? `Everything is ${COLOR_WORDS.find((w) => s.includes(w)) ?? 'recoloured'} now.` : `Recoloured the ${describe(targets[0])}.`,
    };
  }

  return null;
}

/**
 * Strict check used outside the builder (dashboard voice): only clear
 * "build a hologram thing" requests are routed to the builder, so ordinary
 * chat ("create a shopping list") still goes to chat.
 */
export function isBuilderCommand(text: string): boolean {
  const s = normalize(text);
  if (/\bhologram|holographic|holo\b/.test(s) && /\b(create|add|build|make|design|open)\b/.test(s)) return true;
  if (/\b(dashboard|hud)\b.*\baround\b.*\borb\b/.test(s) || /\b(control|command) (center|centre)\b/.test(s)) return true;
  const create = s.match(/^(?:create|build|add|make|spawn|generate)\b(?: me)?(?: an?| some| \d+)?\s+(.*)$/);
  if (!create) return false;
  // Only nouns that are unambiguously holograms (not "text", "map", "clock", "chart"...).
  return /\b(floating (?:holo(?:graphic)? )?screen|particle sphere|(?:3d )?rotating (?:planet|cube|object|crystal|city|torus)|3d (?:planet|cube|object)|spinning (?:planet|cube|crystal)|holo(?:graphic)? \w+)\b/.test(create[1]);
}
