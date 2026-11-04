import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Calendar, Check, ChevronDown, Flag, Pin, Plus, Search, StickyNote, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  createNote,
  createTask,
  deleteNote,
  deleteTask,
  formatDue,
  groupTasks,
  listNotes,
  listTasks,
  localISODate,
  TASK_GROUP_LABELS,
  updateNote,
  updateTask,
  type Note,
  type Priority,
  type Task,
} from '../../lib/personal-api';
import { DictateButton } from '../DictateButton';
import { useMobile } from '../MobileShell';

const errMsg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

const PRIORITY_LABEL: Record<Priority, string> = { 0: 'No priority', 1: 'Medium priority', 2: 'High priority' };
const PRIORITY_COLOR: Record<Priority, string> = { 0: 'var(--jm-text-3)', 1: '#ffb547', 2: 'var(--jm-danger)' };

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

function TaskRow({
  task,
  today,
  onToggle,
  onDelete,
}: {
  task: Task;
  today: string;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const overdue = !task.done && task.due !== null && task.due < today;
  return (
    <li className="jm-panel" style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 4px 2px 2px', borderRadius: 14 }}>
      <button
        type="button"
        onClick={onToggle}
        aria-label={task.done ? `Mark "${task.title}" as not done` : `Complete "${task.title}"`}
        aria-pressed={task.done}
        style={{ width: 44, height: 44, display: 'grid', placeItems: 'center', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0 }}
      >
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            border: `2px solid ${task.done ? 'var(--jm-blue)' : PRIORITY_COLOR[task.priority] === 'var(--jm-text-3)' ? 'var(--jm-border-strong)' : PRIORITY_COLOR[task.priority]}`,
            background: task.done ? 'var(--jm-blue)' : 'transparent',
            color: 'var(--color-on-accent)',
            boxShadow: task.done ? '0 0 10px var(--jm-glow)' : 'none',
          }}
        >
          {task.done && <Check size={14} strokeWidth={3} />}
        </span>
      </button>
      <div style={{ flex: 1, minWidth: 0, padding: '8px 0' }}>
        <div
          style={{
            fontSize: 15,
            lineHeight: 1.3,
            wordBreak: 'break-word',
            color: task.done ? 'var(--jm-text-3)' : 'var(--jm-text)',
            textDecoration: task.done ? 'line-through' : 'none',
          }}
        >
          {task.title}
        </div>
        {(task.due || task.priority > 0) && !task.done && (
          <div style={{ display: 'flex', gap: 10, marginTop: 3, fontSize: 12, color: overdue ? 'var(--jm-danger)' : 'var(--jm-text-2)' }}>
            {task.due && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Calendar size={12} aria-hidden="true" /> {formatDue(task.due, today)}
              </span>
            )}
            {task.priority > 0 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: PRIORITY_COLOR[task.priority] }}>
                <Flag size={12} aria-hidden="true" /> {task.priority === 2 ? 'High' : 'Medium'}
              </span>
            )}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onDelete}
        aria-label={`Delete "${task.title}"`}
        style={{ width: 44, height: 44, display: 'grid', placeItems: 'center', background: 'none', border: 'none', color: 'var(--jm-text-3)', cursor: 'pointer', flexShrink: 0 }}
      >
        <Trash2 size={17} />
      </button>
    </li>
  );
}

function TasksView() {
  const { online } = useMobile();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [done, setDone] = useState<Task[] | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState<Priority>(0);
  const [adding, setAdding] = useState(false);
  const today = localISODate();

  const load = useCallback(async () => {
    try {
      setTasks(await listTasks('open'));
      setError(null);
    } catch (e) {
      setError(errMsg(e, 'Could not load tasks'));
    }
  }, []);

  const loadDone = useCallback(async () => {
    try {
      setDone(await listTasks('done'));
    } catch (e) {
      toast.error(errMsg(e, 'Could not load completed tasks'));
    }
  }, []);

  useEffect(() => {
    if (online) void load();
  }, [online, load]);

  useEffect(() => {
    if (showDone) void loadDone();
  }, [showDone, loadDone]);

  const add = async () => {
    const t = title.trim();
    if (!t) return;
    setAdding(true);
    try {
      await createTask({ title: t, due: due || null, priority });
      setTitle('');
      setDue('');
      setPriority(0);
      await load();
    } catch (e) {
      toast.error(errMsg(e, 'Could not add task'));
    } finally {
      setAdding(false);
    }
  };

  // Optimistic: move the task immediately, roll back if the server refuses.
  const toggle = async (task: Task) => {
    const next = { ...task, done: !task.done };
    const prevOpen = tasks;
    const prevDone = done;
    setTasks((list) => (next.done ? list?.filter((t) => t.id !== task.id) ?? null : [...(list ?? []), next]));
    setDone((list) => (next.done ? [next, ...(list ?? [])] : list?.filter((t) => t.id !== task.id) ?? null));
    try {
      await updateTask(task.id, { done: next.done });
      if (!next.done) await load(); // restore proper sort position
    } catch (e) {
      setTasks(prevOpen);
      setDone(prevDone);
      toast.error(errMsg(e, 'Could not update task'));
    }
  };

  const remove = async (task: Task) => {
    const prevOpen = tasks;
    const prevDone = done;
    setTasks((l) => l?.filter((t) => t.id !== task.id) ?? null);
    setDone((l) => l?.filter((t) => t.id !== task.id) ?? null);
    try {
      await deleteTask(task.id);
      toast('Task deleted');
    } catch (e) {
      setTasks(prevOpen);
      setDone(prevDone);
      toast.error(errMsg(e, 'Could not delete task'));
    }
  };

  const groups = tasks ? groupTasks(tasks, today) : [];

  return (
    <>
      <form
        className="jm-panel"
        style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <div style={{ display: 'flex', gap: 8 }}>
          <label className="sr-only" htmlFor="jm-new-task">New task</label>
          <input
            id="jm-new-task"
            className="jm-field"
            placeholder="Add a task"
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            enterKeyHint="done"
          />
          <DictateButton label="Dictate a task" onText={(t) => setTitle((cur) => (cur ? `${cur} ${t}` : t))} />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label
            className="jm-icon-btn"
            style={{ width: 'auto', padding: '0 12px', gap: 6, fontSize: 14, position: 'relative', flex: 1, justifyContent: 'flex-start' }}
          >
            <Calendar size={16} aria-hidden="true" />
            <span style={{ color: due ? 'var(--jm-text)' : 'var(--jm-text-3)' }}>{due ? formatDue(due, today) : 'Due date'}</span>
            <input
              type="date"
              aria-label="Due date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', cursor: 'pointer' }}
            />
          </label>
          {due && (
            <button type="button" className="jm-icon-btn" onClick={() => setDue('')} aria-label="Clear due date">
              <X size={16} />
            </button>
          )}
          <button
            type="button"
            className="jm-icon-btn"
            onClick={() => setPriority(((priority + 1) % 3) as Priority)}
            aria-label={`${PRIORITY_LABEL[priority]} — tap to change`}
            style={{ color: PRIORITY_COLOR[priority] }}
          >
            <Flag size={18} fill={priority > 0 ? 'currentColor' : 'none'} />
          </button>
          <button type="submit" className="jm-primary-btn" disabled={!title.trim() || adding || online === false} aria-label="Add task">
            <Plus size={18} aria-hidden="true" /> Add
          </button>
        </div>
      </form>

      {error && <p style={{ color: 'var(--jm-danger)', fontSize: 14 }}>{error}</p>}

      {tasks !== null && tasks.length === 0 && !error && (
        <div style={{ textAlign: 'center', padding: '28px 12px', color: 'var(--jm-text-2)' }}>
          <Check size={30} style={{ margin: '0 auto 8px', color: 'var(--jm-blue)' }} aria-hidden="true" />
          <p style={{ fontSize: 15 }}>All clear.</p>
        </div>
      )}

      {groups.map((g) => (
        <section key={g.key} aria-labelledby={`jm-group-${g.key}`}>
          <h2
            id={`jm-group-${g.key}`}
            className="jm-label"
            style={{ marginBottom: 8, color: g.key === 'overdue' ? 'var(--jm-danger)' : undefined }}
          >
            {TASK_GROUP_LABELS[g.key]} · {g.tasks.length}
          </h2>
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {g.tasks.map((t) => (
              <TaskRow key={t.id} task={t} today={today} onToggle={() => void toggle(t)} onDelete={() => void remove(t)} />
            ))}
          </ul>
        </section>
      ))}

      <section>
        <button
          type="button"
          onClick={() => setShowDone((v) => !v)}
          aria-expanded={showDone}
          className="jm-label"
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', minHeight: 44, cursor: 'pointer' }}
        >
          <ChevronDown size={14} style={{ transform: showDone ? 'none' : 'rotate(-90deg)', transition: 'transform .2s' }} aria-hidden="true" />
          Completed{done ? ` · ${done.length}` : ''}
        </button>
        {showDone && done && (
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {done.length === 0 && <li style={{ color: 'var(--jm-text-3)', fontSize: 14 }}>Nothing completed yet.</li>}
            {done.map((t) => (
              <TaskRow key={t.id} task={t} today={today} onToggle={() => void toggle(t)} onDelete={() => void remove(t)} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

function relativeTime(ts: number): string {
  const s = Math.round(Date.now() / 1000 - ts);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ts * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function NoteEditor({ note, onClose, onSaved }: { note: Note | null; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(note?.title ?? '');
  const [body, setBody] = useState(note?.body ?? '');
  const [pinned, setPinned] = useState(note?.pinned ?? false);
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!note) titleRef.current?.focus();
  }, [note]);

  const save = async () => {
    if (!title.trim() && !body.trim()) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      if (note) await updateNote(note.id, { title, body, pinned });
      else await createNote({ title, body, pinned });
      onSaved();
    } catch (e) {
      toast.error(errMsg(e, 'Could not save note'));
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!note) return onClose();
    try {
      await deleteNote(note.id);
      toast('Note deleted');
      onSaved();
    } catch (e) {
      toast.error(errMsg(e, 'Could not delete note'));
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={note ? 'Edit note' : 'New note'}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 5,
        display: 'flex',
        flexDirection: 'column',
        background: 'rgba(5, 11, 26, 0.97)',
        padding: '4px 16px 16px',
        gap: 10,
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button type="button" className="jm-icon-btn" onClick={onClose} aria-label="Close without saving">
          <X size={20} />
        </button>
        <span style={{ flex: 1 }} />
        <button type="button" className="jm-icon-btn" onClick={() => setPinned((p) => !p)} aria-pressed={pinned} aria-label={pinned ? 'Unpin note' : 'Pin note'}>
          <Pin size={18} fill={pinned ? 'currentColor' : 'none'} />
        </button>
        {note && (
          <button type="button" className="jm-icon-btn" onClick={() => void remove()} aria-label="Delete note" style={{ color: 'var(--jm-danger)' }}>
            <Trash2 size={18} />
          </button>
        )}
        <button type="button" className="jm-primary-btn" onClick={() => void save()} disabled={saving}>
          {saving ? 'Saving…' : 'Done'}
        </button>
      </div>
      <label className="sr-only" htmlFor="jm-note-title">Title</label>
      <input
        id="jm-note-title"
        ref={titleRef}
        className="jm-field"
        placeholder="Title"
        value={title}
        maxLength={200}
        onChange={(e) => setTitle(e.target.value)}
        style={{ fontSize: 20, fontWeight: 600, background: 'transparent', border: 'none', boxShadow: 'none', paddingLeft: 2 }}
      />
      <label className="sr-only" htmlFor="jm-note-body">Note</label>
      <textarea
        id="jm-note-body"
        className="jm-field"
        placeholder="Write something…"
        value={body}
        maxLength={20000}
        onChange={(e) => setBody(e.target.value)}
        style={{ flex: 1, resize: 'none', lineHeight: 1.5 }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <DictateButton label="Dictate into note" onText={(t) => setBody((cur) => (cur ? `${cur.replace(/\s+$/, '')} ${t}` : t))} />
      </div>
    </div>
  );
}

function NotesView() {
  const { online } = useMobile();
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Note | 'new' | null>(null);

  const load = useCallback(async (q: string) => {
    try {
      setNotes(await listNotes(q));
      setError(null);
    } catch (e) {
      setError(errMsg(e, 'Could not load notes'));
    }
  }, []);

  // Debounced live search.
  useEffect(() => {
    if (!online) return;
    const t = setTimeout(() => void load(query), query ? 250 : 0);
    return () => clearTimeout(t);
  }, [online, query, load]);

  return (
    <>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Search size={16} aria-hidden="true" style={{ position: 'absolute', left: 12, top: 14, color: 'var(--jm-text-3)' }} />
          <label className="sr-only" htmlFor="jm-note-search">Search notes</label>
          <input
            id="jm-note-search"
            className="jm-field"
            type="search"
            placeholder="Search notes"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ paddingLeft: 36 }}
          />
        </div>
        <button type="button" className="jm-primary-btn" onClick={() => setEditing('new')} disabled={online === false} aria-label="New note">
          <Plus size={18} aria-hidden="true" /> New
        </button>
      </div>

      {error && <p style={{ color: 'var(--jm-danger)', fontSize: 14 }}>{error}</p>}

      {notes !== null && notes.length === 0 && !error && (
        <div style={{ textAlign: 'center', padding: '28px 12px', color: 'var(--jm-text-2)' }}>
          <StickyNote size={30} style={{ margin: '0 auto 8px', color: 'var(--jm-blue)' }} aria-hidden="true" />
          <p style={{ fontSize: 15 }}>{query ? 'No matching notes.' : 'No notes yet.'}</p>
        </div>
      )}

      <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {notes?.map((n) => (
          <li key={n.id}>
            <button
              type="button"
              className="jm-panel"
              onClick={() => setEditing(n)}
              style={{ width: '100%', textAlign: 'left', padding: '12px 14px', color: 'inherit', cursor: 'pointer', borderRadius: 14 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {n.pinned && <Pin size={13} fill="currentColor" style={{ color: 'var(--jm-cyan)', flexShrink: 0 }} aria-label="Pinned" />}
                <span style={{ fontSize: 15, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {n.title || n.body.split('\n')[0] || 'Untitled'}
                </span>
                <span style={{ fontSize: 12, color: 'var(--jm-text-3)', flexShrink: 0 }}>{relativeTime(n.updated_at)}</span>
              </div>
              {n.title && n.body && (
                <p
                  style={{
                    fontSize: 14,
                    color: 'var(--jm-text-2)',
                    marginTop: 4,
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    wordBreak: 'break-word',
                  }}
                >
                  {n.body}
                </p>
              )}
            </button>
          </li>
        ))}
      </ul>

      {editing && (
        <NoteEditor
          note={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load(query);
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function MobileTasks() {
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'notes' ? 'notes' : 'tasks';

  return (
    <div className="jm-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div
        role="tablist"
        aria-label="Tasks or notes"
        className="jm-panel"
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', padding: 4, borderRadius: 14 }}
      >
        {(['tasks', 'notes'] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => setParams(v === 'notes' ? { view: 'notes' } : {}, { replace: true })}
            style={{
              minHeight: 40,
              borderRadius: 10,
              border: 'none',
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer',
              color: view === v ? 'var(--color-on-accent)' : 'var(--jm-text-2)',
              background: view === v ? 'linear-gradient(135deg, var(--jm-cyan), var(--jm-blue))' : 'transparent',
            }}
          >
            {v === 'tasks' ? 'Tasks' : 'Notes'}
          </button>
        ))}
      </div>
      {view === 'tasks' ? <TasksView /> : <NotesView />}
    </div>
  );
}
