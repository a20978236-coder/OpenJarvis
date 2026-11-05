/** Saved hologram layouts on the server (/v1/personal/holograms). */
import { apiFetch } from '../../lib/api';
import { sanitizeLayout, type HoloLayout } from './holo-types';

export interface HologramSummary {
  id: string;
  name: string;
  objects: number;
  updated_at: number;
}

async function fail(res: Response, fallback: string): Promise<never> {
  let detail = '';
  try {
    const body = await res.json();
    if (typeof body?.detail === 'string') detail = body.detail;
    else if (Array.isArray(body?.detail) && typeof body.detail[0]?.msg === 'string') detail = body.detail[0].msg.replace(/^Value error, /, '');
  } catch {
    // Non-JSON body.
  }
  throw new Error(detail || `${fallback} (HTTP ${res.status})`);
}

export async function listHolograms(): Promise<HologramSummary[]> {
  const res = await apiFetch('/v1/personal/holograms');
  if (!res.ok) return fail(res, 'Could not load saved holograms');
  const body = await res.json();
  if (!Array.isArray(body?.holograms)) throw new Error('Unexpected reply from the server while loading holograms');
  return body.holograms;
}

/** Loads and validates a layout: whatever the server returns, the editor gets a safe layout. */
export async function loadHologram(id: string): Promise<{ id: string; layout: HoloLayout }> {
  const res = await apiFetch(`/v1/personal/holograms/${encodeURIComponent(id)}`);
  if (!res.ok) return fail(res, 'Could not open that hologram');
  const body = await res.json();
  return { id: String(body?.id ?? id), layout: sanitizeLayout({ ...(body?.data ?? {}), name: body?.name }) };
}

export async function saveHologram(id: string | null, layout: HoloLayout): Promise<{ id: string }> {
  const res = await apiFetch(id ? `/v1/personal/holograms/${encodeURIComponent(id)}` : '/v1/personal/holograms', {
    method: id ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: layout.name, data: layout }),
  });
  if (!res.ok) return fail(res, 'Could not save');
  const body = await res.json();
  return { id: String(body.id) };
}

export async function deleteHologram(id: string): Promise<void> {
  const res = await apiFetch(`/v1/personal/holograms/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) return fail(res, 'Could not delete');
}
