import { useEffect, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { getMemoryStats, searchMemory, storeMemory, type MemorySearchResult } from '../../lib/api';
import { useMobile } from '../MobileShell';

export function MobileMemory() {
  const { online } = useMobile();
  const [count, setCount] = useState<number | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MemorySearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [newFact, setNewFact] = useState('');
  const [saving, setSaving] = useState(false);

  const refreshStats = () =>
    getMemoryStats()
      .then((s) => {
        setCount(s.entries);
        setStatsError(null);
      })
      .catch((e: unknown) => setStatsError(e instanceof Error ? e.message : 'Memory unavailable'));

  useEffect(() => {
    if (online) void refreshStats();
  }, [online]);

  const runSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      setResults(await searchMemory(query.trim(), 10));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setSearching(false);
    }
  };

  const remember = async () => {
    const text = newFact.trim();
    if (!text) return;
    setSaving(true);
    try {
      await storeMemory(text, { source: 'jarvis-mobile' });
      setNewFact('');
      toast.success('Saved to memory');
      void refreshStats();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="jm-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <header>
        <h1 style={{ fontSize: 24, fontWeight: 600 }}>Memory</h1>
        <p style={{ fontSize: 14, color: 'var(--jm-text-2)', marginTop: 2 }}>
          {statsError
            ? statsError
            : count === null
              ? 'What Jarvis knows about you.'
              : `${count.toLocaleString()} item${count === 1 ? '' : 's'} stored on your server.`}
        </p>
      </header>

      <form
        className="jm-panel"
        style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}
        onSubmit={(e) => {
          e.preventDefault();
          void remember();
        }}
      >
        <label className="jm-label" htmlFor="jm-remember">Teach Jarvis something</label>
        <textarea
          id="jm-remember"
          className="jm-field"
          rows={2}
          placeholder="e.g. My partner's birthday is 12 March"
          value={newFact}
          onChange={(e) => setNewFact(e.target.value)}
          style={{ resize: 'none' }}
        />
        <button type="submit" className="jm-primary-btn" disabled={!newFact.trim() || saving || online === false}>
          <Plus size={18} aria-hidden="true" /> {saving ? 'Saving…' : 'Remember this'}
        </button>
      </form>

      <form
        role="search"
        style={{ display: 'flex', gap: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          void runSearch();
        }}
      >
        <label className="sr-only" htmlFor="jm-memory-search">Search memory</label>
        <input
          id="jm-memory-search"
          className="jm-field"
          type="search"
          placeholder="Search memory"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          enterKeyHint="search"
        />
        <button type="submit" className="jm-icon-btn" disabled={!query.trim() || searching || online === false} aria-label="Search">
          <Search size={20} className={searching ? 'jm-pulse' : undefined} />
        </button>
      </form>

      {results !== null && (
        <section aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: 8 }} data-selectable>
          {results.length === 0 ? (
            <p style={{ color: 'var(--jm-text-3)', fontSize: 14, textAlign: 'center', padding: 16 }}>Nothing found.</p>
          ) : (
            results.map((r, i) => (
              <article key={i} className="jm-panel" style={{ padding: '12px 14px' }}>
                <p style={{ fontSize: 15, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{r.content}</p>
                <p style={{ fontSize: 12, color: 'var(--jm-text-3)', marginTop: 6 }}>
                  Match {Math.round(Math.max(0, Math.min(1, r.score)) * 100)}%
                  {typeof r.metadata?.source === 'string' ? ` · ${r.metadata.source}` : ''}
                </p>
              </article>
            ))
          )}
        </section>
      )}
    </div>
  );
}
