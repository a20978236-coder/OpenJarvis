import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Mic, Plus, Square } from 'lucide-react';
import { useAppStore } from '../../lib/store';
import { isEmbedOnlyModel } from '../../lib/model-capabilities';
import { useChatSender } from '../../hooks/useChatSender';
import { MessageBubble } from '../../components/Chat/MessageBubble';
import { StreamingDots } from '../../components/Chat/StreamingDots';
import { HellOrb } from '../HellOrb';
import { useMobile } from '../MobileShell';

export function MobileChat() {
  const { orbState, speechState, speechAvailable, toggleTalk, online } = useMobile();
  const { send, stop } = useChatSender();
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const activeId = useAppStore((s) => s.activeId);
  const messages = useAppStore((s) => s.messages);
  const streamState = useAppStore((s) => s.streamState);
  const models = useAppStore((s) => s.models);
  const selectedModel = useAppStore((s) => s.selectedModel);
  const setSelectedModel = useAppStore((s) => s.setSelectedModel);
  const createConversation = useAppStore((s) => s.createConversation);
  const isLive = streamState.isStreaming && streamState.conversationId === activeId;
  const chatModels = models.filter((m) => !isEmbedOnlyModel(m.id));

  // Follow new content unless the user has scrolled up to read.
  useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, streamState.content]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [draft]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  const submit = async () => {
    const text = draft;
    if (!text.trim() || streamState.isStreaming) return;
    stick.current = true;
    setDraft('');
    const result = await send(text);
    if (result !== 'sent') setDraft(text); // keep the words if nothing went out
  };

  const recording = speechState === 'recording';
  const transcribing = speechState === 'transcribing';
  const empty = messages.length === 0 && !isLive;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px 8px' }}>
        <label className="sr-only" htmlFor="jm-model">Model</label>
        <select
          id="jm-model"
          className="jm-field"
          style={{ flex: 1, minHeight: 44, padding: '6px 12px', fontSize: 14 }}
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          disabled={chatModels.length === 0}
        >
          {chatModels.length === 0 && <option value="">No models available</option>}
          {chatModels.map((m) => (
            <option key={m.id} value={m.id}>{m.id}</option>
          ))}
        </select>
        <button
          type="button"
          className="jm-icon-btn"
          style={{ width: 44, height: 44 }}
          onClick={() => {
            if (streamState.isStreaming) stop();
            createConversation(selectedModel);
          }}
          aria-label="New conversation"
          title="New conversation"
        >
          <Plus size={20} />
        </button>
      </div>

      <div ref={listRef} onScroll={onScroll} className="jm-scroll" style={{ padding: 0 }} data-selectable>
        {empty ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 32, gap: 6 }}>
            <HellOrb state={orbState} size={150} />
            <p style={{ color: 'var(--jm-text-2)', fontSize: 15, textAlign: 'center', padding: '0 24px' }}>
              {speechAvailable ? 'Ask anything — type below or tap the mic.' : 'Ask anything.'}
            </p>
          </div>
        ) : (
          <div className="jm-chat-list">
            {messages.map((msg, i) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                isLive={isLive && i === messages.length - 1 && msg.role === 'assistant'}
              />
            ))}
            {isLive && streamState.content === '' && !messages[messages.length - 1]?.isResearch && (
              <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 12 }}>
                <StreamingDots phase={streamState.phase} />
              </div>
            )}
          </div>
        )}
      </div>

      <form
        className="jm-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {speechAvailable && !isLive && (
          <button
            type="button"
            className="jm-icon-btn"
            onClick={() => void toggleTalk()}
            disabled={transcribing || online === false}
            aria-pressed={recording}
            aria-label={recording ? 'Stop and send voice message' : transcribing ? 'Transcribing' : 'Talk to HELL'}
            style={recording ? { color: '#fff', background: 'var(--jm-danger)', borderColor: 'transparent' } : undefined}
          >
            {recording ? <Square size={18} fill="currentColor" /> : <Mic size={20} className={transcribing ? 'jm-pulse' : undefined} />}
          </button>
        )}
        <label className="sr-only" htmlFor="jm-draft">Message</label>
        <textarea
          id="jm-draft"
          ref={inputRef}
          className="jm-field"
          rows={1}
          value={draft}
          placeholder={recording ? 'Listening…' : selectedModel ? 'Message HELL' : 'No model available'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Hardware keyboards: Enter sends, Shift+Enter adds a line.
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
          enterKeyHint="send"
          disabled={recording}
        />
        {isLive ? (
          <button type="button" className="jm-icon-btn" onClick={stop} aria-label="Stop generating" style={{ color: 'var(--jm-danger)' }}>
            <Square size={18} fill="currentColor" />
          </button>
        ) : (
          <button
            type="submit"
            className="jm-primary-btn"
            style={{ width: 44, padding: 0 }}
            disabled={!draft.trim() || streamState.isStreaming || !selectedModel}
            aria-label="Send"
          >
            <ArrowUp size={20} />
          </button>
        )}
      </form>
    </div>
  );
}
