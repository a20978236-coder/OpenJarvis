/** Talking to the server about camera frames. */
import { apiFetch, authHeaders, getBase } from '../../lib/api';
import { stripThinkTags } from '../../lib/message-text';

export interface VisionStatus {
  model: string;
  engine_accepts: boolean;
  /** null = the server couldn't tell. */
  model_sees: boolean | null;
  vision_models: string[];
  hint: string;
}

export async function getVisionStatus(model: string): Promise<VisionStatus> {
  const res = await apiFetch(`/v1/hell/vision?model=${encodeURIComponent(model)}`);
  if (!res.ok) throw new Error(`Could not check vision support (HTTP ${res.status})`);
  const b = await res.json();
  return {
    model: String(b?.model ?? model),
    engine_accepts: b?.engine_accepts === true,
    model_sees: b?.model_sees === true ? true : b?.model_sees === false ? false : null,
    vision_models: Array.isArray(b?.vision_models) ? b.vision_models.filter((m: unknown) => typeof m === 'string') : [],
    hint: typeof b?.hint === 'string' ? b.hint : 'ollama pull qwen2.5vl:7b',
  };
}

export const VISION_SYSTEM_PROMPT = [
  'You are HELL, looking through the user\'s iPhone camera. You are given the photo(s) they just took.',
  'Describe only what is actually visible. If something is blurry, cut off or not in the photo, say so plainly instead of guessing.',
  'Be concise and practical. When asked to read text, transcribe it exactly. When asked what to press, point to the specific control by its label, colour or position.',
  'When given two photos, the first is the earlier one: explain what changed.',
].join(' ');

/** Ask about one or more frames; streams the answer through `onText`. */
export async function askVision(opts: {
  model: string;
  question: string;
  frames: string[];
  onText: (soFar: string) => void;
  signal?: AbortSignal;
}): Promise<string> {
  const content = [
    { type: 'text', text: opts.question },
    ...opts.frames.map((b64) => ({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } })),
  ];
  const res = await fetch(`${getBase()}/v1/chat/completions`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    signal: opts.signal,
    body: JSON.stringify({
      model: opts.model,
      stream: true,
      temperature: 0.2,
      max_tokens: 700,
      messages: [
        { role: 'system', content: VISION_SYSTEM_PROMPT },
        { role: 'user', content },
      ],
    }),
  });
  if (!res.ok) {
    let detail = '';
    try {
      const b = await res.json();
      detail = typeof b?.detail === 'string' ? b.detail : Array.isArray(b?.detail) ? String(b.detail[0]?.msg ?? '') : '';
    } catch {
      // Non-JSON error body.
    }
    throw new Error(detail || `Vision request failed (HTTP ${res.status})`);
  }
  if (!res.body) throw new Error('No answer from the server');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') return stripThinkTags(text);
      try {
        const delta = JSON.parse(data)?.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta) {
          text += delta;
          opts.onText(stripThinkTags(text));
        }
      } catch {
        // Ignore non-JSON keep-alives and agent events.
      }
    }
  }
  return stripThinkTags(text);
}

// ---- Which model to use for vision (saved on this device) --------------

const KEY = 'hell-vision-model';
export function loadVisionModel(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}
export function saveVisionModel(m: string) {
  try {
    localStorage.setItem(KEY, m);
  } catch {
    // Not saved; applies for this session.
  }
}

export const VISION_PROMPTS = [
  'What am I looking at?',
  'Read this text.',
  'Read this sign.',
  'What do I need to press?',
  "Describe what's in front of me.",
  'Help me understand this device.',
];
