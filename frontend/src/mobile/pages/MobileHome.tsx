import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Brain, CheckSquare, ChevronRight, Cpu, MessageCircle, Sparkles } from 'lucide-react';
import { useAppStore } from '../../lib/store';
import { getMemoryStats } from '../../lib/api';
import { getPersonalSummary, type PersonalSummary } from '../../lib/personal-api';
import { useChatSender } from '../../hooks/useChatSender';
import { HellOrb } from '../HellOrb';
import { useMobile } from '../MobileShell';

function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return 'Working late';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

const QUICK_PROMPTS = [
  'Plan my day',
  'Summarize what you remember about me',
  'Give me a quick briefing',
  'Help me think through a decision',
];

export function MobileHome() {
  const navigate = useNavigate();
  const { orbState, toggleTalk, speechAvailable, online, authVia, signOut, activate, openOrbSettings } = useMobile();
  const { send } = useChatSender();
  const selectedModel = useAppStore((s) => s.selectedModel);
  const modelsLoading = useAppStore((s) => s.modelsLoading);
  const conversations = useAppStore((s) => s.conversations);
  const [memoryCount, setMemoryCount] = useState<number | null>(null);
  const [summary, setSummary] = useState<PersonalSummary | null>(null);

  useEffect(() => {
    if (!online) return;
    getMemoryStats()
      // Server data is untrusted: a malformed reply must not crash Home.
      .then((s) => setMemoryCount(Number.isFinite(s?.entries) ? s.entries : null))
      .catch(() => setMemoryCount(null));
    getPersonalSummary()
      .then((s) =>
        setSummary(Number.isFinite(s?.open_tasks) && Number.isFinite(s?.due_today) ? s : null),
      )
      .catch(() => setSummary(null));
  }, [online]);

  const ask = async (prompt: string) => {
    navigate('/m/chat');
    await send(prompt);
  };

  const canTalk = speechAvailable && online !== false;

  return (
    <div className="jm-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <section style={{ textAlign: 'center', paddingTop: 4 }}>
        <div className="jm-label">{greeting()}</div>
        <h1 style={{ fontSize: 26, fontWeight: 600, marginTop: 6, letterSpacing: '-0.01em' }}>
          How can I help?
        </h1>
      </section>

      <section style={{ display: 'flex', justifyContent: 'center' }}>
        <HellOrb
          state={orbState}
          size={240}
          showBase
          // Tap: activation burst (or send, while listening). Double-tap: talk.
          onTap={() => (orbState === 'listening' ? void toggleTalk() : activate())}
          onDoubleTap={canTalk ? () => void toggleTalk() : () => navigate('/m/chat')}
          onLongPress={openOrbSettings}
          caption={!canTalk && orbState === 'idle' ? 'Double-tap to chat' : undefined}
        />
      </section>
      {!speechAvailable && online && (
        <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--jm-text-3)', marginTop: -10 }}>
          Voice needs a speech backend on the server — tap the orb to type instead.
        </p>
      )}

      <button
        type="button"
        className="jm-panel"
        onClick={() => navigate('/m/tasks')}
        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}
      >
        <CheckSquare size={22} style={{ color: 'var(--jm-cyan)', flexShrink: 0 }} aria-hidden="true" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="jm-label">Today</div>
          <div style={{ marginTop: 4, fontSize: 14, fontWeight: 500 }}>
            {summary === null
              ? 'Tasks & notes'
              : summary.open_tasks === 0
                ? 'No open tasks'
                : `${summary.due_today} due · ${summary.open_tasks} open`}
          </div>
        </div>
        <ChevronRight size={18} style={{ color: 'var(--jm-text-3)' }} aria-hidden="true" />
      </button>

      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div className="jm-panel" style={{ padding: '12px 14px', minWidth: 0 }}>
          <div className="jm-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Cpu size={13} aria-hidden="true" /> Model
          </div>
          <div
            style={{ marginTop: 6, fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            title={selectedModel}
          >
            {modelsLoading ? 'Loading…' : selectedModel || 'None available'}
          </div>
        </div>
        <button
          type="button"
          className="jm-panel"
          onClick={() => navigate('/m/memory')}
          style={{ padding: '12px 14px', textAlign: 'left', color: 'inherit', cursor: 'pointer' }}
        >
          <div className="jm-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Brain size={13} aria-hidden="true" /> Memory
          </div>
          <div style={{ marginTop: 6, fontSize: 14, fontWeight: 500 }}>
            {memoryCount === null ? '—' : `${memoryCount.toLocaleString()} items`}
          </div>
        </button>
      </section>


      <section>
        <div className="jm-label" style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Sparkles size={13} aria-hidden="true" /> Quick actions
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {QUICK_PROMPTS.map((p) => (
            <button
              key={p}
              type="button"
              className="jm-panel"
              onClick={() => ask(p)}
              disabled={!selectedModel || online === false}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                minHeight: 48,
                padding: '0 14px',
                color: 'var(--jm-text)',
                fontSize: 15,
                textAlign: 'left',
                cursor: 'pointer',
                opacity: !selectedModel || online === false ? 0.5 : 1,
              }}
            >
              <MessageCircle size={16} style={{ color: 'var(--jm-blue)', flexShrink: 0 }} aria-hidden="true" />
              {p}
            </button>
          ))}
        </div>
      </section>

      {conversations.length > 0 && (
        <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--jm-text-3)' }}>
          {conversations.length} conversation{conversations.length === 1 ? '' : 's'} on this device
        </p>
      )}
      {authVia === 'cookie' && (
        <button
          type="button"
          onClick={() => void signOut()}
          style={{ alignSelf: 'center', minHeight: 44, padding: '0 16px', background: 'none', border: 'none', color: 'var(--jm-text-3)', fontSize: 13, textDecoration: 'underline', cursor: 'pointer' }}
        >
          Sign out of this device
        </button>
      )}
    </div>
  );
}
