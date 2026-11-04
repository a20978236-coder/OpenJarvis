/**
 * Client for the server's /v1/personal notes & tasks API.
 *
 * Every call goes through apiFetch, so it uses the same base URL and auth as
 * the rest of the app; nothing here holds a secret.
 */
import { apiFetch } from './api';

export type Priority = 0 | 1 | 2;

export interface Task {
  id: string;
  title: string;
  notes: string;
  /** ISO date (YYYY-MM-DD) or null. */
  due: string | null;
  priority: Priority;
  done: boolean;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

export interface Note {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  created_at: number;
  updated_at: number;
}

export interface PersonalSummary {
  open_tasks: number;
  due_today: number;
  notes: number;
}

async function errorFrom(res: Response, fallback: string): Promise<Error> {
  let detail = '';
  try {
    const body = await res.json();
    if (typeof body?.detail === 'string') detail = body.detail;
    // FastAPI validation errors: [{ msg: "..." }, ...]
    else if (Array.isArray(body?.detail) && typeof body.detail[0]?.msg === 'string') {
      detail = body.detail[0].msg.replace(/^Value error, /, '');
    }
  } catch {
    // Non-JSON body: fall back to the status message.
  }
  return new Error(detail || `${fallback} (HTTP ${res.status})`);
}

async function call<T>(path: string, init: RequestInit, fallback: string): Promise<T> {
  const res = await apiFetch(`/v1/personal${path}`, init);
  if (!res.ok) throw await errorFrom(res, fallback);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// ---- Tasks -------------------------------------------------------------

export async function listTasks(status: 'open' | 'done' | 'all' = 'open'): Promise<Task[]> {
  const data = await call<{ tasks: Task[] }>(`/tasks?status=${status}`, {}, 'Could not load tasks');
  return data.tasks;
}

export function createTask(input: { title: string; notes?: string; due?: string | null; priority?: Priority }): Promise<Task> {
  return call<Task>('/tasks', json('POST', input), 'Could not add task');
}

export function updateTask(
  id: string,
  changes: Partial<Pick<Task, 'title' | 'notes' | 'due' | 'priority' | 'done'>>,
): Promise<Task> {
  return call<Task>(`/tasks/${encodeURIComponent(id)}`, json('PATCH', changes), 'Could not update task');
}

export function deleteTask(id: string): Promise<void> {
  return call<void>(`/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' }, 'Could not delete task');
}

// ---- Notes -------------------------------------------------------------

export async function listNotes(query = ''): Promise<Note[]> {
  const qs = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : '';
  const data = await call<{ notes: Note[] }>(`/notes${qs}`, {}, 'Could not load notes');
  return data.notes;
}

export function createNote(input: { title?: string; body?: string; pinned?: boolean }): Promise<Note> {
  return call<Note>('/notes', json('POST', input), 'Could not save note');
}

export function updateNote(id: string, changes: Partial<Pick<Note, 'title' | 'body' | 'pinned'>>): Promise<Note> {
  return call<Note>(`/notes/${encodeURIComponent(id)}`, json('PATCH', changes), 'Could not save note');
}

export function deleteNote(id: string): Promise<void> {
  return call<void>(`/notes/${encodeURIComponent(id)}`, { method: 'DELETE' }, 'Could not delete note');
}

export function getPersonalSummary(): Promise<PersonalSummary> {
  return call<PersonalSummary>('/summary', {}, 'Could not load summary');
}

// ---- Helpers -------------------------------------------------------------

/** Local calendar date as YYYY-MM-DD (not UTC, which can be "tomorrow"). */
export function localISODate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export type TaskGroupKey = 'overdue' | 'today' | 'upcoming' | 'someday';

export const TASK_GROUP_LABELS: Record<TaskGroupKey, string> = {
  overdue: 'Overdue',
  today: 'Today',
  upcoming: 'Upcoming',
  someday: 'Someday',
};

/** Bucket open tasks by due date relative to `today`, keeping server order. */
export function groupTasks(tasks: Task[], today: string): { key: TaskGroupKey; tasks: Task[] }[] {
  const groups: Record<TaskGroupKey, Task[]> = { overdue: [], today: [], upcoming: [], someday: [] };
  for (const t of tasks) {
    if (!t.due) groups.someday.push(t);
    else if (t.due < today) groups.overdue.push(t);
    else if (t.due === today) groups.today.push(t);
    else groups.upcoming.push(t);
  }
  return (Object.keys(groups) as TaskGroupKey[])
    .filter((k) => groups[k].length > 0)
    .map((k) => ({ key: k, tasks: groups[k] }));
}

/** Short, friendly due label: "Today", "Tomorrow", "Mon 9 Nov", "3 days ago". */
export function formatDue(due: string, today: string): string {
  const toDay = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const diff = Math.round((toDay(due).getTime() - toDay(today).getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff < 0 && diff > -7) return `${-diff} days ago`;
  const date = toDay(due);
  return date.toLocaleDateString(undefined, {
    weekday: diff > 0 && diff < 7 ? 'short' : undefined,
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() !== toDay(today).getFullYear() ? 'numeric' : undefined,
  });
}
