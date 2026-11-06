/** Files kept on the HELL server (/v1/hell/files). */
import { apiFetch } from './api';

export interface HellFile {
  id: string;
  name: string;
  size: number;
  type: string;
  created_at: number;
  in_memory: boolean;
  memory_chunks: number;
  can_add_to_memory: boolean;
}

async function fail(res: Response, fallback: string): Promise<never> {
  let detail = '';
  try {
    const b = await res.json();
    if (typeof b?.detail === 'string') detail = b.detail;
  } catch {
    // non-JSON
  }
  throw new Error(detail || `${fallback} (HTTP ${res.status})`);
}

export async function listFiles(): Promise<{ files: HellFile[]; total_bytes: number; max_file_bytes: number }> {
  const res = await apiFetch('/v1/hell/files');
  if (!res.ok) return fail(res, 'Could not load files');
  const b = await res.json();
  return {
    files: Array.isArray(b?.files) ? b.files : [],
    total_bytes: Number(b?.total_bytes) || 0,
    max_file_bytes: Number(b?.max_file_bytes) || 25 * 1024 * 1024,
  };
}

export async function uploadFile(file: File): Promise<HellFile> {
  const body = new FormData();
  body.append('file', file, file.name);
  const res = await apiFetch('/v1/hell/files', { method: 'POST', body });
  if (!res.ok) return fail(res, `Could not upload ${file.name}`);
  return res.json();
}

export async function deleteFile(id: string): Promise<void> {
  const res = await apiFetch(`/v1/hell/files/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) return fail(res, 'Could not delete');
}

export async function addFileToMemory(id: string): Promise<HellFile & { secrets_removed: number }> {
  const res = await apiFetch(`/v1/hell/files/${encodeURIComponent(id)}/memory`, { method: 'POST' });
  if (!res.ok) return fail(res, 'Could not add to memory');
  return res.json();
}

export async function removeFileFromMemory(id: string): Promise<HellFile> {
  const res = await apiFetch(`/v1/hell/files/${encodeURIComponent(id)}/memory`, { method: 'DELETE' });
  if (!res.ok) return fail(res, 'Could not remove from memory');
  return res.json();
}

/** Fetch with auth and return a blob: URL (works with cookie or API-key sign-in). */
export async function fileObjectUrl(id: string): Promise<string> {
  const res = await apiFetch(`/v1/hell/files/${encodeURIComponent(id)}`);
  if (!res.ok) return fail(res, 'Could not open the file');
  return URL.createObjectURL(await res.blob());
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
