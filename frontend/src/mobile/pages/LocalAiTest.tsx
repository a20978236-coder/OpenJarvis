import { useEffect, useRef, useState } from 'react';
import { Copy, Play, Square, Trash2 } from 'lucide-react';
import {
  LOCAL_MODEL_PRESETS,
  TEST_PROMPT,
  clearUnfinishedTest,
  deleteDownloaded,
  formatResult,
  isDownloaded,
  requestPersistence,
  runBenchmark,
  storageInfo,
  unfinishedTest,
  type BenchResult,
  type Phase,
  type StorageInfo,
} from '../../lib/local-ai';

const muted = { fontSize: 14, color: 'var(--jm-text-3)' } as const;
const PHASE_LABEL: Record<Phase, string> = {
  download: 'Downloading to your phone',
  load: 'Loading into memory',
  generate: 'Writing a reply',
};

/**
 * Phase 3b: does a small AI model run on this iPhone, offline? Downloads the
 * chosen model once, then measures load time and speed. Nothing is sent
 * anywhere; the copied results are for you to share if you want.
 */
export function LocalAiTest() {
  const [presetId, setPresetId] = useState(LOCAL_MODEL_PRESETS[1].id);
  const [useGpu, setUseGpu] = useState(true);
  const [phase, setPhase] = useState<{ phase: Phase; progress?: number } | null>(null);
  const [reply, setReply] = useState('');
  const [result, setResult] = useState<BenchResult | null>(null);
  const [downloaded, setDownloaded] = useState<Record<string, boolean>>({});
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [crashed, setCrashed] = useState<string | null>(() => unfinishedTest());
  const [copied, setCopied] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const preset = LOCAL_MODEL_PRESETS.find((p) => p.id === presetId)!;
  const running = phase !== null;

  const refresh = async () => {
    const entries = await Promise.all(LOCAL_MODEL_PRESETS.map(async (p) => [p.id, await isDownloaded(p)] as const));
    setDownloaded(Object.fromEntries(entries));
    setStorage(await storageInfo().catch(() => null));
  };
  useEffect(() => {
    void refresh();
  }, []);

  const start = async () => {
    setResult(null);
    setReply('');
    setCopied(false);
    setCrashed(null);
    abort.current = new AbortController();
    await requestPersistence();
    const r = await runBenchmark(preset, {
      useGpu,
      signal: abort.current.signal,
      onPhase: (p, progress) => setPhase({ phase: p, progress }),
      onToken: setReply,
    });
    setPhase(null);
    setResult(r);
    void refresh();
  };

  const remove = async () => {
    await deleteDownloaded(preset).catch(() => undefined);
    void refresh();
  };

  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(formatResult(result));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p style={{ fontSize: 14, color: 'var(--jm-text-2)' }}>
        Test whether a small AI model runs on this phone with no internet. The model downloads once from Hugging Face
        straight to your phone; after that it works offline. Nothing you type is sent anywhere.
      </p>

      {crashed && (
        <p role="alert" style={{ fontSize: 14, color: 'var(--jm-danger)' }}>
          The last test ({crashed}) didn’t finish — Safari probably closed the page because the phone ran out of memory.
          Try a smaller model.{' '}
          <button type="button" style={{ color: 'var(--jm-cyan)', textDecoration: 'underline' }} onClick={() => { clearUnfinishedTest(); setCrashed(null); }}>
            Dismiss
          </button>
        </p>
      )}

      <div role="radiogroup" aria-label="Model to test" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {LOCAL_MODEL_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={p.id === presetId}
            disabled={running}
            onClick={() => setPresetId(p.id)}
            className="jm-icon-btn hell-choice"
            style={{ width: '100%', flexDirection: 'column', alignItems: 'flex-start', padding: '8px 12px', height: 'auto', gap: 2, textAlign: 'left' }}
          >
            <span style={{ fontSize: 14 }}>
              {p.name} · {p.sizeMb} MB{downloaded[p.id] ? ' · on phone' : ''}
            </span>
            <span style={{ fontSize: 12, color: 'var(--jm-text-3)' }}>{p.note}</span>
          </button>
        ))}
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
        <input type="checkbox" checked={useGpu} disabled={running} onChange={(e) => setUseGpu(e.target.checked)} />
        Use the phone’s graphics chip if Safari allows it (WebGPU)
      </label>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {!running ? (
          <button type="button" className="jm-primary-btn" onClick={() => void start()} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Play size={16} aria-hidden="true" />
            {downloaded[preset.id] ? 'Run test' : `Download ${preset.sizeMb} MB and test`}
          </button>
        ) : (
          <button type="button" className="jm-icon-btn" onClick={() => abort.current?.abort()} style={{ width: 'auto', padding: '0 12px', gap: 6, whiteSpace: 'nowrap', fontSize: 14 }}>
            <Square size={16} aria-hidden="true" /> Stop
          </button>
        )}
        {downloaded[preset.id] && !running && (
          <button type="button" className="jm-icon-btn" onClick={() => void remove()} style={{ width: 'auto', padding: '0 12px', gap: 6, whiteSpace: 'nowrap', fontSize: 14 }}>
            <Trash2 size={16} aria-hidden="true" /> Remove from phone
          </button>
        )}
      </div>

      {storage && (
        <p style={{ fontSize: 12, color: 'var(--jm-text-3)' }}>
          Storage used by HELL: {storage.usedMb} MB of {storage.quotaMb} MB allowed
          {storage.persisted === false ? ' · Add HELL to your Home Screen so Safari keeps downloaded models.' : ''}
        </p>
      )}

      {running && (
        <div role="status" aria-live="polite" style={{ fontSize: 14 }}>
          {PHASE_LABEL[phase.phase]}
          {phase.phase === 'download' && phase.progress !== undefined ? ` · ${Math.round(phase.progress * 100)}%` : '…'}
          {phase.phase === 'download' && (
            <progress value={phase.progress ?? 0} max={1} aria-label="Download progress" style={{ display: 'block', width: '100%', marginTop: 6 }} />
          )}
        </div>
      )}

      {(running || result) && (
        <div style={{ fontSize: 14, padding: 10, borderRadius: 12, border: '1px solid var(--jm-border)', background: 'rgba(0,179,255,0.04)' }}>
          <p style={{ ...muted, fontSize: 12 }}>Question: {TEST_PROMPT}</p>
          <p data-testid="local-ai-reply" style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{reply || (running ? '…' : '')}</p>
        </div>
      )}

      {result && (
        <div data-testid="local-ai-result" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {result.ok ? (
            <ul style={{ listStyle: 'none', fontSize: 14, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <li>Worked on this phone ✓</li>
              <li>Download: {result.downloadSeconds ? `${result.downloadSeconds} s` : 'already on phone'}</li>
              <li>Load: {result.loadSeconds} s</li>
              <li>Speed: {result.tokensPerSecond} tokens per second (a token is about ¾ of a word)</li>
              <li>
                Engine: {result.threads} processor thread{result.threads === 1 ? '' : 's'}
                {result.gpu === 'on' ? (result.webgpuInBrowser ? ' · graphics chip offered by Safari' : ' · graphics chip not offered by Safari') : ' · graphics chip off'}
              </li>
            </ul>
          ) : (
            <p role="alert" style={{ fontSize: 14 }}>Didn’t work: {result.error}</p>
          )}
          <button type="button" className="jm-icon-btn" onClick={() => void copy()} style={{ width: 'auto', padding: '0 12px', gap: 6, whiteSpace: 'nowrap', fontSize: 14, alignSelf: 'flex-start' }}>
            <Copy size={16} aria-hidden="true" /> {copied ? 'Copied' : 'Copy results'}
          </button>
        </div>
      )}
    </div>
  );
}

export default LocalAiTest;
