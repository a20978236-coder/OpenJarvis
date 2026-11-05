import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { AlertTriangle, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { storeMemory } from '../../lib/api';
import {
  deleteMemoryDocument,
  filterByText,
  forgetFact,
  listLearnedFacts,
  listMemoryDocuments,
  type LearnedFact,
  type MemoryDocument,
} from '../../lib/memory-api';
import { DictateButton } from '../DictateButton';
import { useMobile } from '../MobileShell';

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

function LearnedView({ query }: { query: string }) {
  const { online } = useMobile();
  const [facts, setFacts] = useState<LearnedFact[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
  }, [online, load]);

  const forget = async (fact: LearnedFact) => {
    try {
      await forgetFact(fact);
      toast('Forgotten');
    } catch (e) {
      toast.error(errMsg(e, 'Could not forget fact'));
    }
    // Indexes shift after any delete, so always reload from the server.
    await load();
  };

  if (error) return <p style={{ color: 'var(--jm-danger)', fontSize: 14 }}>{error}</p>;
  if (facts === null) return null;
  if (!enabled) {
    return (
      <EmptyState text="Automatic memory is off on your server, so HELL isn't learning facts from your chats. You can still teach it things above." />
    );
  }
  const shown = filterByText(facts, query, (f) => f.text);
  if (facts.length === 0) return <EmptyState text="Nothing learned yet. HELL picks up facts about you as you chat." />;
  if (shown.length === 0) return <EmptyState text="No matching facts." />;

  return (
    <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }} data-selectable>
      {shown.map((f) => (
        <li key={`${f.index}:${f.text}`} className="jm-panel" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 6px 10px 14px', borderRadius: 14 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 15, lineHeight: 1.4, wordBreak: 'break-word' }}>{f.text}</p>
            <p style={{ fontSize: 12, color: 'var(--jm-text-3)', marginTop: 4, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {when(f.created_at)}
              {!f.recallable && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#ffb547' }}>
                  <AlertTriangle size={12} aria-hidden="true" /> Flagged — not used in chats
                </span>
              )}
            </p>
          </div>
          <ConfirmDelete label={`Forget "${f.text}"`} onConfirm={() => forget(f)} />
        </li>
      ))}
    </ul>
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
  if (docs.length === 0) return <EmptyState text="Nothing saved yet. Use “Teach HELL something” above." />;
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

export function MobileMemory() {
  const { online } = useMobile();
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'saved' ? 'saved' : 'learned';
  const [query, setQuery] = useState('');
  const [newFact, setNewFact] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedKey, setSavedKey] = useState(0);

  const remember = async () => {
    const text = newFact.trim();
    if (!text) return;
    setSaving(true);
    try {
      await storeMemory(text, { source: 'jarvis-mobile' });
      setNewFact('');
      toast.success('Saved to memory');
      setSavedKey((k) => k + 1);
      setParams({ view: 'saved' }, { replace: true });
    } catch (e) {
      toast.error(errMsg(e, 'Could not save'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="jm-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <header>
        <h1 style={{ fontSize: 24, fontWeight: 600 }}>Memory</h1>
        <p style={{ fontSize: 14, color: 'var(--jm-text-2)', marginTop: 2 }}>
          What HELL knows about you, stored on your server. Delete anything you don’t want it to use.
        </p>
      </header>

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

      <div role="tablist" aria-label="Memory type" className="jm-panel" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', padding: 4, borderRadius: 14 }}>
        {(
          [
            ['learned', 'Learned'],
            ['saved', 'Saved'],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            onClick={() => setParams(v === 'saved' ? { view: 'saved' } : {}, { replace: true })}
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
            {label}
          </button>
        ))}
      </div>

      <div style={{ position: 'relative' }}>
        <Search size={16} aria-hidden="true" style={{ position: 'absolute', left: 12, top: 14, color: 'var(--jm-text-3)' }} />
        <label className="sr-only" htmlFor="jm-memory-filter">Filter memory</label>
        <input
          id="jm-memory-filter"
          className="jm-field"
          type="search"
          placeholder={view === 'saved' ? 'Filter saved entries' : 'Filter learned facts'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ paddingLeft: 36 }}
        />
      </div>

      {view === 'learned' ? <LearnedView query={query} /> : <SavedView query={query} refreshKey={savedKey} />}
    </div>
  );
}
