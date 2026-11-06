import { lazy, Suspense, useEffect, useState } from 'react';
import { Bot, Check, Cpu, Puzzle, Smartphone } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { useAppStore } from '../../lib/store';
import { isEmbedOnlyModel } from '../../lib/model-capabilities';

type Load<T> = { state: 'loading' } | { state: 'ok'; data: T } | { state: 'error'; message: string };

async function getJson<T>(path: string, pick: (body: unknown) => T): Promise<T> {
  const res = await apiFetch(path);
  if (!res.ok) throw new Error(res.status === 403 ? 'Not allowed by server policy' : `HTTP ${res.status}`);
  return pick(await res.json());
}

const asNames = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : (x as { name?: string; id?: string })?.name ?? (x as { id?: string })?.id)).filter((x): x is string => typeof x === 'string') : [];

function useLoad<T>(path: string, pick: (body: unknown) => T): Load<T> {
  const [v, setV] = useState<Load<T>>({ state: 'loading' });
  useEffect(() => {
    let live = true;
    getJson(path, pick)
      .then((data) => live && setV({ state: 'ok', data }))
      .catch((e) => live && setV({ state: 'error', message: e instanceof Error ? e.message : 'Unavailable' }));
    return () => {
      live = false;
    };
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps
  return v;
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section className="jm-panel" style={{ padding: 14, borderRadius: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h2 className="jm-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: 'var(--jm-cyan)', display: 'flex' }} aria-hidden="true">{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function NameList({ load, empty }: { load: Load<string[]>; empty: string }) {
  if (load.state === 'loading') return <p style={{ fontSize: 14, color: 'var(--jm-text-3)' }}>Loading…</p>;
  if (load.state === 'error') return <p style={{ fontSize: 14, color: 'var(--jm-text-3)' }}>Unavailable ({load.message})</p>;
  if (!load.data.length) return <p style={{ fontSize: 14, color: 'var(--jm-text-3)' }}>{empty}</p>;
  return (
    <ul style={{ listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {load.data.map((n) => (
        <li key={n} style={{ fontSize: 13, padding: '5px 10px', borderRadius: 999, border: '1px solid var(--jm-border)', background: 'rgba(0,179,255,0.06)' }}>{n}</li>
      ))}
    </ul>
  );
}

// Loaded only when this screen opens, so the dashboard stays light.
const LocalAiTest = lazy(() => import('./LocalAiTest'));

/** Read-only view of the AI building blocks on the user's server. */
export function AiModules() {
  const models = useAppStore((s) => s.models);
  const selected = useAppStore((s) => s.selectedModel);
  const setSelected = useAppStore((s) => s.setSelectedModel);
  const serverInfo = useAppStore((s) => s.serverInfo);
  const agents = useLoad('/v1/agents', (b) => asNames((b as { registered?: unknown })?.registered));
  const skills = useLoad('/v1/skills', (b) => asNames((b as { skills?: unknown })?.skills));
  const chatModels = models.filter((m) => !isEmbedOnlyModel(m.id));

  return (
    <div className="jm-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <header>
        <h1 style={{ fontSize: 24, fontWeight: 600 }}>AI Modules</h1>
        <p style={{ fontSize: 14, color: 'var(--jm-text-2)', marginTop: 2 }}>
          {serverInfo ? `Engine: ${serverInfo.engine}${serverInfo.agent ? ` · Agent: ${serverInfo.agent}` : ''}` : 'What your server can run.'}
        </p>
      </header>

      <Section icon={<Cpu size={16} />} title={`Models · ${chatModels.length}`}>
        {chatModels.length === 0 ? (
          <p style={{ fontSize: 14, color: 'var(--jm-text-3)' }}>No chat models found on the server.</p>
        ) : (
          <div role="radiogroup" aria-label="Chat model" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {chatModels.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={m.id === selected}
                  onClick={() => setSelected(m.id)}
                  className="jm-icon-btn hell-choice"
                  style={{ width: '100%', justifyContent: 'space-between', padding: '0 12px', fontSize: 14 }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.id}</span>
                  {m.id === selected && <Check size={16} aria-hidden="true" />}
                </button>
            ))}
          </div>
        )}
      </Section>

      <Section icon={<Smartphone size={16} />} title="On-phone AI · test">
        <Suspense fallback={<p style={{ fontSize: 14, color: 'var(--jm-text-3)' }}>Loading…</p>}>
          <LocalAiTest />
        </Suspense>
      </Section>

      <Section icon={<Bot size={16} />} title="Agents">
        <NameList load={agents} empty="No agent types registered." />
      </Section>

      <Section icon={<Puzzle size={16} />} title="Skills">
        <NameList load={skills} empty="No skills installed. Install them with `jarvis skill install` on the server." />
      </Section>
    </div>
  );
}
