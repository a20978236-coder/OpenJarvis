import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { AlertTriangle, Check, Clock, Lock, MessageCircle, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { searchMemory } from '../../lib/api';
import { useAppStore } from '../../lib/store';
import {
  approveFact,
  CATEGORY_LABELS,
  categorizeFact,
  clearLearnedFacts,
  clearSavedMemory,
  deleteMemoryDocument,
  filterByText,
  forgetFact,
  getMemorySettings,
  listLearnedFacts,
  listMemoryDocuments,
  rememberFact,
  searchConversations,
  updateMemorySettings,
  type FactCategory,
  type LearnedFact,
  type LearningMode,
  type MemoryDocument,
  type MemorySettings,
} from '../../lib/memory-api';
import { DictateButton } from '../DictateButton';
import { useMobile } from '../MobileShell';
import '../gestures/gestures.css';

const PAGE = 50;
const errMsg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

function when(ts: number | null): string {
  if (!ts) return '';
  return new Date(ts * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Trash button that asks once before acting: tap, then tap "Delete". */
function ConfirmDelete({ label, onConfirm }: { label: string; onConfirm: () => Promise<void> }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  if (armed) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onConfirm();
          } finally {
            setBusy(false);
            setArmed(false);
          }
        }}
        aria-label={`Confirm: ${label}`}
        style={{
          minHeight: 36,
          padding: '0 12px',
          borderRadius: 10,
          border: 'none',
          background: 'var(--jm-danger)',
          color: '#fff',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        {busy ? '…' : 'Delete'}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setArmed(true)}
      aria-label={label}
      style={{ width: 44, height: 44, display: 'grid', placeItems: 'center', background: 'none', border: 'none', color: 'var(--jm-text-3)', cursor: 'pointer', flexShrink: 0 }}
    >
      <Trash2 size={17} />
    </button>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p style={{ color: 'var(--jm-text-3)', fontSize: 14, textAlign: 'center', padding: '24px 12px' }}>{text}</p>;
}

// ---------------------------------------------------------------------------

function FactRow({ f, onForget, onApprove }: { f: LearnedFact; onForget: () => Promise<void>; onApprove?: () => Promise<void> }) {
  const pending = f.trust === 'pending';
  return (
    <li className="jm-panel mem-row" data-pending={pending || undefined}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p className="mem-text">{f.text}</p>
        <p className="mem-meta">
          {when(f.created_at)}
          {f.source === 'user' && <span>Told by you</span>}
          {pending && (
            <span className="mem-flag" style={{ color: 'var(--jm-cyan)' }}>
              <Clock size={12} aria-hidden="true" /> Not used until you approve
            </span>
          )}
          {f.trust === 'untrusted' && (
            <span className="mem-flag">
              <AlertTriangle size={12} aria-hidden="true" /> Flagged — not used in chats
            </span>
          )}
        </p>
      </div>
      {onApprove && (
        <button type="button" className="mem-approve" onClick={() => void onApprove()} aria-label={`Approve "${f.text}"`}>
          <Check size={18} aria-hidden="true" />
        </button>
      )}
      <ConfirmDelete label={`Forget "${f.text}"`} onConfirm={onForget} />
    </li>
  );
}

function LearnedView({ query, refreshKey, onChange }: { query: string; refreshKey: number; onChange: () => void }) {
  const { online } = useMobile();
  const [facts, setFacts] = useState<LearnedFact[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cat, setCat] = useState<FactCategory | 'all'>('all');

  const load = useCallback(async () => {
    try {
      const data = await listLearnedFacts();
      setEnabled(data.enabled);
      // Newest first is more useful on a phone; indexes stay as the server sent them.
      setFacts([...data.facts].reverse());
      setError(null);
    } catch (e) {
      setError(errMsg(e, 'Could not load learned facts'));
    }
  }, []);

  useEffect(() => {
    if (online) void load();
  }, [online, load, refreshKey]);

  // Indexes shift after any change, so always reload from the server.
  const act = async (fn: () => Promise<void>, ok: string, fail: string) => {
    try {
      await fn();
      toast(ok);
    } catch (e) {
      toast.error(errMsg(e, fail));
    }
    await load();
    onChange();
  };

  if (error) return <p style={{ color: 'var(--jm-danger)', fontSize: 14 }}>{error}</p>;
  if (facts === null) return null;
  if (!enabled || facts.length === 0) {
    return <EmptyState text={enabled ? 'Nothing learned yet. Teach HELL something above, or turn learning on.' : 'HELL isn\u2019t learning from your chats. Teach it something above, or turn learning on.'} />;
  }
  const pending = facts.filter((f) => f.trust === 'pending');
  const rest = facts.filter((f) => f.trust !== 'pending');
  const counts = rest.reduce<Record<string, number>>((m, f) => ((m[categorizeFact(f.text)] = (m[categorizeFact(f.text)] ?? 0) + 1), m), {});
  const shownPending = filterByText(pending, query, (f) => f.text);
  const shown = filterByText(rest, query, (f) => f.text).filter((f) => cat === 'all' || categorizeFact(f.text) === cat);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {pending.length > 0 && (
        <section aria-labelledby="mem-pending">
          <h2 id="mem-pending" className="jm-label" style={{ marginBottom: 8 }}>Waiting for your approval ({pending.length})</h2>
          <ul className="mem-list" data-selectable>
            {shownPending.map((f) => (
              <FactRow
                key={`${f.index}:${f.text}`}
                f={f}
                onApprove={() => act(() => approveFact(f), 'Approved — HELL may use it now', 'Could not approve')}
                onForget={() => act(() => forgetFact(f), 'Forgotten', 'Could not forget fact')}
              />
            ))}
          </ul>
        </section>
      )}
      {rest.length > 0 && (
        <>
          <div className="holo-chips" role="group" aria-label="Filter by kind" tabIndex={0}>
            {(['all', 'preference', 'project', 'about', 'other'] as const).map((c) => (
              <button key={c} type="button" className="holo-chip" aria-pressed={cat === c} onClick={() => setCat(c)}>
                {c === 'all' ? `All (${rest.length})` : `${CATEGORY_LABELS[c]} (${counts[c] ?? 0})`}
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <EmptyState text="No matching facts." />
          ) : (
            <ul className="mem-list" data-selectable>
              {shown.map((f) => (
                <FactRow key={`${f.index}:${f.text}`} f={f} onForget={() => act(() => forgetFact(f), 'Forgotten', 'Could not forget fact')} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function SavedView({ query, refreshKey }: { query: string; refreshKey: number }) {
  const { online } = useMobile();
  const [docs, setDocs] = useState<MemoryDocument[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await listMemoryDocuments(PAGE, 0);
      setDocs(data.documents);
      setTotal(data.total);
      setError(null);
    } catch (e) {
      setError(errMsg(e, 'Could not load memory'));
    }
  }, []);

  useEffect(() => {
    if (online) void load();
  }, [online, load, refreshKey]);

  const loadMore = async () => {
    if (!docs) return;
    setLoadingMore(true);
    try {
      const data = await listMemoryDocuments(PAGE, docs.length);
      setDocs([...docs, ...data.documents.filter((d) => !docs.some((x) => x.id === d.id))]);
      setTotal(data.total);
    } catch (e) {
      toast.error(errMsg(e, 'Could not load more'));
    } finally {
      setLoadingMore(false);
    }
  };

  const remove = async (doc: MemoryDocument) => {
    try {
      await deleteMemoryDocument(doc.id);
      setDocs((list) => list?.filter((d) => d.id !== doc.id) ?? null);
      setTotal((n) => Math.max(0, n - 1));
      toast('Deleted from memory');
    } catch (e) {
      toast.error(errMsg(e, 'Could not delete'));
    }
  };

  if (error) return <p style={{ color: 'var(--jm-danger)', fontSize: 14 }}>{error}</p>;
  if (docs === null) return null;
  if (docs.length === 0) return <EmptyState text="Nothing saved yet. Notes you save, files you add and things HELL stores appear here." />;
  const shown = filterByText(docs, query, (d) => d.content);

  return (
    <>
      {shown.length === 0 ? (
        <EmptyState text="No matching entries in the loaded items." />
      ) : (
        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }} data-selectable>
          {shown.map((d) => {
            const origin = typeof d.metadata?.source === 'string' ? d.metadata.source : d.source;
            return (
              <li key={d.id} className="jm-panel" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 6px 10px 14px', borderRadius: 14 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p
                    style={{
                      fontSize: 15,
                      lineHeight: 1.4,
                      wordBreak: 'break-word',
                      whiteSpace: 'pre-wrap',
                      display: '-webkit-box',
                      WebkitLineClamp: 4,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {d.content}
                  </p>
                  <p style={{ fontSize: 12, color: 'var(--jm-text-3)', marginTop: 4 }}>
                    {[when(d.created_at), origin].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <ConfirmDelete label="Delete this memory" onConfirm={() => remove(d)} />
              </li>
            );
          })}
        </ul>
      )}
      {docs.length < total && (
        <button type="button" className="jm-icon-btn" onClick={() => void loadMore()} disabled={loadingMore} style={{ width: '100%' }}>
          {loadingMore ? 'Loading…' : `Show more (${total - docs.length} left)`}
        </button>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function ServerSearch({ query }: { query: string }) {
  const [results, setResults] = useState<{ content: string; score: number }[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setResults(null), [query]);
  if (!query.trim()) return null;
  return (
    <div className="mem-server-search">
      <button
        type="button"
        className="jm-icon-btn"
        style={{ width: '100%' }}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            setResults(await searchMemory(query.trim(), 8));
          } catch (e) {
            toast.error(errMsg(e, 'Search failed'));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Search size={16} aria-hidden="true" /> {busy ? 'Searching…' : 'Search all saved memory by meaning'}
      </button>
      {results && (
        <ul className="mem-list" data-selectable aria-label="Search results" style={{ marginTop: 8 }}>
          {results.length === 0 && <EmptyState text="Nothing relevant found." />}
          {results.map((r, i) => (
            <li key={i} className="jm-panel mem-row">
              <p className="mem-text" style={{ WebkitLineClamp: 4 }}>{r.content}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ChatsView({ query }: { query: string }) {
  const navigate = useNavigate();
  const conversations = useAppStore((s) => s.conversations);
  const selectConversation = useAppStore((s) => s.selectConversation);
  const deleteConversation = useAppStore((s) => s.deleteConversation);
  const hits = searchConversations(conversations, query);
  if (conversations.length === 0) return <EmptyState text="No conversations yet." />;
  return (
    <>
      <p className="mem-note">
        <Lock size={12} aria-hidden="true" /> Chats are kept on this iPhone. HELL sees the current chat when it answers, so follow-ups make sense.
      </p>
      {hits.length === 0 ? (
        <EmptyState text="No chats match." />
      ) : (
        <ul className="mem-list" data-selectable>
          {hits.map((c) => (
            <li key={c.id} className="jm-panel mem-row">
              <button
                type="button"
                className="mem-open"
                onClick={() => {
                  selectConversation(c.id);
                  navigate('/m/chat');
                }}
                aria-label={`Open chat: ${c.title}`}
              >
                <MessageCircle size={18} aria-hidden="true" />
                <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <span className="mem-text" style={{ fontWeight: 600, WebkitLineClamp: 1 }}>{c.title}</span>
                  <span className="mem-meta">
                    {new Date(c.updatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} · {c.messages} messages
                  </span>
                  {c.snippet && <span className="mem-snippet">{c.snippet}</span>}
                </span>
              </button>
              <ConfirmDelete
                label={`Delete chat "${c.title}"`}
                onConfirm={async () => {
                  deleteConversation(c.id);
                  toast('Chat deleted');
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function MemoryControls({ settings, onChange }: { settings: MemorySettings | null; onChange: (s: MemorySettings) => void }) {
  const [busy, setBusy] = useState(false);
  if (!settings) return null;
  const set = async (patch: Partial<Pick<MemorySettings, 'learning' | 'use_in_replies'>>) => {
    setBusy(true);
    try {
      onChange(await updateMemorySettings(patch));
    } catch (e) {
      toast.error(errMsg(e, 'Could not change memory settings'));
    } finally {
      setBusy(false);
    }
  };
  const off = settings.learning === 'off' && !settings.use_in_replies;
  return (
    <section className="jm-panel mem-card" aria-labelledby="mem-settings">
      <h2 id="mem-settings" className="cal-h">{off ? 'Memory is off' : 'How HELL remembers'}</h2>
      <div role="radiogroup" aria-label="Learning from chats" className="cal-choices">
        {(
          [
            ['off', 'Don\u2019t learn'],
            ['ask', 'Ask me first'],
            ['auto', 'Automatic'],
          ] as [LearningMode, string][]
        ).map(([m, label]) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={settings.learning === m}
            disabled={busy || (m !== 'off' && !settings.learning_available)}
            className="jm-icon-btn hell-choice"
            onClick={() => void set({ learning: m })}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="cal-p">
        {settings.learning === 'ask'
          ? 'HELL suggests facts from your chats; none is used until you approve it.'
          : settings.learning === 'auto'
            ? 'HELL uses ordinary facts straight away; personal details still wait for your approval.'
            : settings.learning_available
              ? 'HELL doesn\u2019t learn from your chats. Things you teach it are still remembered.'
              : 'Learning needs an AI model on your server. Things you teach it are still remembered.'}
      </p>
      <label className="holo-toggle">
        <input type="checkbox" className="hell-switch" checked={settings.use_in_replies} disabled={busy} onChange={(e) => void set({ use_in_replies: e.target.checked })} />
        <span>Use memories in replies</span>
      </label>
      <button type="button" className="jm-icon-btn" style={{ width: '100%' }} disabled={busy} onClick={() => void set(off ? { learning: 'ask', use_in_replies: true } : { learning: 'off', use_in_replies: false })}>
        {off ? 'Turn memory back on' : 'Turn memory off'}
      </button>
      {settings.sensitive_policy && (
        <p className="mem-note">
          <Lock size={12} aria-hidden="true" /> {settings.sensitive_policy}
        </p>
      )}
    </section>
  );
}

function ClearZone({ onCleared }: { onCleared: () => void }) {
  const [armed, setArmed] = useState<'facts' | 'saved' | null>(null);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  const run = async (what: 'facts' | 'saved') => {
    if (armed !== what) return setArmed(what);
    setArmed(null);
    try {
      const n = what === 'facts' ? await clearLearnedFacts() : await clearSavedMemory();
      toast(`Cleared ${n} ${what === 'facts' ? 'learned facts' : 'saved entries'}`);
      onCleared();
    } catch (e) {
      toast.error(errMsg(e, 'Could not clear'));
    }
  };
  return (
    <section className="mem-clear" aria-labelledby="mem-clear">
      <h2 id="mem-clear" className="jm-label">Clear memory</h2>
      <div className="cal-row">
        <button type="button" className="jm-icon-btn mem-danger" data-armed={armed === 'facts' || undefined} onClick={() => void run('facts')}>
          <Trash2 size={16} aria-hidden="true" /> {armed === 'facts' ? 'Tap again to clear facts' : 'Clear learned facts'}
        </button>
        <button type="button" className="jm-icon-btn mem-danger" data-armed={armed === 'saved' || undefined} onClick={() => void run('saved')}>
          <Trash2 size={16} aria-hidden="true" /> {armed === 'saved' ? 'Tap again to clear saved' : 'Clear saved entries'}
        </button>
      </div>
    </section>
  );
}

type View = 'learned' | 'saved' | 'chats';

export function MobileMemory() {
  const { online } = useMobile();
  const [params, setParams] = useSearchParams();
  const raw = params.get('view');
  const view: View = raw === 'saved' || raw === 'chats' ? raw : 'learned';
  const [query, setQuery] = useState('');
  const [newFact, setNewFact] = useState('');
  const [saving, setSaving] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [settings, setSettings] = useState<MemorySettings | null>(null);

  const loadSettings = useCallback(() => {
    getMemorySettings()
      .then(setSettings)
      .catch(() => setSettings(null));
  }, []);
  useEffect(() => {
    if (online) loadSettings();
  }, [online, loadSettings, refresh]);

  const remember = async () => {
    const text = newFact.trim();
    if (!text) return;
    setSaving(true);
    try {
      const r = await rememberFact(text);
      setNewFact('');
      toast.success(r === 'stored' ? 'HELL will remember that' : 'HELL already knew that');
      setRefresh((k) => k + 1);
      setParams({}, { replace: true });
    } catch (e) {
      toast.error(errMsg(e, 'Could not save'));
    } finally {
      setSaving(false);
    }
  };

  const pending = settings?.facts.pending ?? 0;
  const tabs: [View, string][] = [
    ['learned', pending ? `Learned · ${pending} new` : 'Learned'],
    ['saved', 'Saved'],
    ['chats', 'Chats'],
  ];

  return (
    <div className="jm-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <header>
        <h1 style={{ fontSize: 24, fontWeight: 600 }}>Memory</h1>
        <p style={{ fontSize: 14, color: 'var(--jm-text-2)', marginTop: 2 }}>
          What HELL knows about you, stored on your server. You decide what it keeps and uses.
        </p>
      </header>

      <MemoryControls settings={settings} onChange={setSettings} />

      <form
        style={{ display: 'flex', gap: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          void remember();
        }}
      >
        <label className="sr-only" htmlFor="jm-remember">Teach HELL something</label>
        <input
          id="jm-remember"
          className="jm-field"
          placeholder="Teach HELL something…"
          value={newFact}
          maxLength={500}
          onChange={(e) => setNewFact(e.target.value)}
          enterKeyHint="done"
        />
        <DictateButton label="Dictate a memory" onText={(t) => setNewFact((cur) => (cur ? `${cur} ${t}` : t))} />
        <button
          type="submit"
          className="jm-primary-btn"
          style={{ width: 44, padding: 0, flexShrink: 0 }}
          disabled={!newFact.trim() || saving || online === false}
          aria-label="Remember this"
        >
          <Plus size={20} aria-hidden="true" />
        </button>
      </form>

      <div role="tablist" aria-label="Memory type" className="jm-panel" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', padding: 4, borderRadius: 14 }}>
        {tabs.map(([v, label]) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => setParams(v === 'learned' ? {} : { view: v }, { replace: true })}
            style={{
              minHeight: 44,
              borderRadius: 10,
              border: 'none',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              color: view === v ? 'var(--color-on-accent)' : 'var(--jm-text-2)',
              background: view === v ? 'linear-gradient(135deg, var(--jm-cyan), var(--jm-blue))' : 'transparent',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={{ position: 'relative' }}>
        <Search size={16} aria-hidden="true" style={{ position: 'absolute', left: 12, top: 14, color: 'var(--jm-text-3)' }} />
        <label className="sr-only" htmlFor="jm-memory-filter">Search memory</label>
        <input
          id="jm-memory-filter"
          className="jm-field"
          type="search"
          placeholder={view === 'saved' ? 'Search saved entries' : view === 'chats' ? 'Search chats' : 'Search learned facts'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ paddingLeft: 36 }}
        />
      </div>

      {view === 'learned' && <LearnedView query={query} refreshKey={refresh} onChange={loadSettings} />}
      {view === 'saved' && (
        <>
          <SavedView query={query} refreshKey={refresh} />
          <ServerSearch query={query} />
        </>
      )}
      {view === 'chats' && <ChatsView query={query} />}

      {view !== 'chats' && <ClearZone onCleared={() => setRefresh((k) => k + 1)} />}
    </div>
  );
}
