import { useHolo } from './holo-store';
import { parseCommand, type CommandResult } from './holo-commands';
import { askHologramAI } from './holo-ai';
import { saveHologram } from './holo-api';

export type CommandSource = 'built-in' | 'ai' | 'none';

export interface CommandOutcome {
  reply: string;
  source: CommandSource;
  /** Number of edit operations actually applied. */
  applied: number;
  ok: boolean;
}

/** Save the open layout to the server (used by the Save button and "save this layout"). */
export async function saveCurrentHologram(): Promise<string> {
  const { layout, savedId, markSaved } = useHolo.getState();
  const { id } = await saveHologram(savedId, layout);
  markSaved(id);
  return layout.name;
}

/**
 * Run one natural-language command against the open hologram: the offline
 * parser first, the AI model only if the parser doesn't understand. All
 * resulting edits are applied as ONE undo step.
 */
export async function runHoloCommand(text: string, model: string, signal?: AbortSignal): Promise<CommandOutcome> {
  const { layout, selectedId } = useHolo.getState();
  let source: CommandSource = 'built-in';
  let result: CommandResult | null = parseCommand(text, layout, selectedId);
  if (!result) {
    source = 'ai';
    try {
      result = await askHologramAI(text, layout, selectedId, model, signal);
    } catch (e) {
      return { reply: e instanceof Error ? `${e.message}. Nothing was changed.` : 'The AI model is unavailable. Nothing was changed.', source: 'none', applied: 0, ok: false };
    }
  }

  const store = useHolo.getState();
  let applied = 0;
  let reply = result.reply;
  if (result.ops.length) {
    const r = store.applyMany(result.ops);
    applied = r.applied;
    if (!r.applied) reply = `${r.errors[0] ?? 'That could not be applied'}. Nothing was changed.`;
    else if (r.errors.length) reply = `${reply} (${r.errors.length} step${r.errors.length === 1 ? '' : 's'} could not be applied.)`;
  }

  for (const a of result.actions) {
    if (a.kind === 'undo') useHolo.getState().undo();
    else if (a.kind === 'redo') useHolo.getState().redo();
    else if (a.kind === 'select') useHolo.getState().select(a.id);
    else if (a.kind === 'save') {
      try {
        const name = await saveCurrentHologram();
        reply = `Saved “${name}”.`;
      } catch (e) {
        return { reply: e instanceof Error ? `Couldn't save: ${e.message}` : "Couldn't save.", source, applied, ok: false };
      }
    }
  }

  const ok = applied > 0 || result.actions.length > 0;
  return { reply, source: ok ? source : source === 'ai' ? 'ai' : 'none', applied, ok };
}
