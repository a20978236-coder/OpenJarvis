import { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useAppStore, generateId } from '../lib/store';
import { streamChat, streamResearch } from '../lib/sse';
import { fetchSavings, getBase } from '../lib/api';
import { serializeToolCallArguments } from '../lib/tool-call';
import { engineFromCompletionChunk, resolveChatEngine } from '../lib/chat-telemetry';
import type {
  ChatMessage,
  MessageTelemetry,
  ResearchSearchTrace,
  ResearchSource,
  TokenUsage,
  ToolCallInfo,
} from '../types';

/**
 * Sending a chat message and streaming the reply into the store.
 *
 * Extracted unchanged from InputArea so the desktop composer and the mobile
 * app share one implementation of the OpenJarvis chat protocol (SSE chat,
 * Deep Research, tool calls, telemetry, savings).
 *
 * The abort controller and elapsed-time timer are module-level rather than
 * per-component: a reply keeps streaming into the store when the view that
 * started it unmounts (e.g. switching tabs on mobile), and whichever view is
 * mounted next must still be able to stop it.
 */
let abortController: AbortController | null = null;
let elapsedTimer: ReturnType<typeof setInterval> | null = null;

function clearElapsedTimer(): void {
  if (elapsedTimer) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
}

/** Abort the in-flight reply, if any, and reset streaming state. */
export function stopChatStream(): void {
  abortController?.abort();
  clearElapsedTimer();
  useAppStore.getState().resetStream();
}

export type SendResult = 'sent' | 'empty' | 'busy' | 'no-model';

/**
 * Send `rawContent` as a user message in the active conversation (creating
 * one if needed) and stream the reply into the store. Reads current state at
 * call time, so it can be used outside React as well as through the hook.
 */
export async function sendChatMessage(rawContent: string): Promise<SendResult> {
  const state = useAppStore.getState();
  const {
    activeId,
    selectedModel,
    deepResearch,
    createConversation,
    addMessage,
    updateLastAssistant,
    setStreamState,
    resetStream,
  } = state;
  const { temperature, maxTokens } = state.settings;

  const content = rawContent.trim();
  if (!content) return 'empty';
  if (useAppStore.getState().streamState.isStreaming) return 'busy';
  if (!selectedModel) {
    toast.error('Pick a model first (⌘K)');
    return 'no-model';
  }

  let convId = activeId;
  if (!convId) {
    convId = createConversation(selectedModel);
  }

  const userMsg: ChatMessage = {
    id: generateId(),
    role: 'user',
    content,
    timestamp: Date.now(),
  };
  addMessage(convId, userMsg);

  // Build API messages before adding assistant placeholder
  const currentMessages = useAppStore.getState().messages;
  const apiMessages = currentMessages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const assistantMsg: ChatMessage = {
    id: generateId(),
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    isResearch: deepResearch || undefined,
  };
  addMessage(convId, assistantMsg);

  // Start streaming
  const startTime = Date.now();
  clearElapsedTimer();
  elapsedTimer = setInterval(() => {
    setStreamState({ elapsedMs: Date.now() - startTime });
  }, 100);

  const controller = new AbortController();
  abortController = controller;

  let accumulatedContent = '';
  let usage: TokenUsage | undefined;
  let complexity: { score: number; tier: string; suggested_max_tokens: number } | undefined;
  let routedEngine: string | undefined;
  const toolCalls: ToolCallInfo[] = [];
  const researchTraces: ResearchSearchTrace[] = [];
  const researchSourcesByRef = new Map<number, ResearchSource>();
  const flushSources = () =>
    Array.from(researchSourcesByRef.values()).sort((a, b) => a.ref - b.ref);
  let lastFlush = 0;
  let ttftMs: number | undefined;

  setStreamState({
    conversationId: convId,
    isStreaming: true,
    phase: deepResearch ? 'Researching...' : 'Generating...',
    elapsedMs: 0,
    activeToolCalls: [],
    content: '',
  });
  useAppStore.getState().addLogEntry({
    timestamp: Date.now(),
    level: 'info',
    category: 'chat',
    message: deepResearch
      ? `Research: "${content.slice(0, 80)}${content.length > 80 ? '...' : ''}"`
      : `Request: "${content.slice(0, 80)}${content.length > 80 ? '...' : ''}" → ${selectedModel}`,
  });

  try {
    if (deepResearch) {
      for await (const ev of streamResearch(
        content,
        selectedModel,
        controller.signal,
      )) {
        if (ev.type === 'search_call') {
          const trace: ResearchSearchTrace = {
            id: generateId(),
            query: ev.arguments?.query ?? '',
            person: ev.arguments?.person,
            timeRange: ev.arguments?.time_range,
            status: 'pending',
          };
          researchTraces.push(trace);
          setStreamState({ phase: `Searching: ${trace.query}` });
          updateLastAssistant(
            convId,
            accumulatedContent,
            undefined,
            undefined,
            undefined,
            undefined,
            [...researchTraces],
            flushSources(),
          );
          useAppStore.getState().addLogEntry({
            timestamp: Date.now(),
            level: 'info',
            category: 'tool',
            message: `Search: "${trace.query}"${trace.person ? ` (person: ${trace.person})` : ''}`,
          });
        } else if (ev.type === 'search_result') {
          const pending = [...researchTraces].reverse().find((t) => t.status === 'pending');
          if (pending) {
            pending.status = 'complete';
            pending.numHits = ev.num_hits;
            pending.topTitles = ev.top_titles;
          }
          if (ev.sources) {
            for (const src of ev.sources) {
              if (src && typeof src.ref === 'number' && !researchSourcesByRef.has(src.ref)) {
                researchSourcesByRef.set(src.ref, src);
              }
            }
          }
          updateLastAssistant(
            convId,
            accumulatedContent,
            undefined,
            undefined,
            undefined,
            undefined,
            [...researchTraces],
            flushSources(),
          );
        } else if (ev.type === 'synthesis') {
          if (!ttftMs) ttftMs = Date.now() - startTime;
          accumulatedContent += ev.text;
          setStreamState({ content: accumulatedContent, phase: '' });
          const now = Date.now();
          if (now - lastFlush >= 80) {
            updateLastAssistant(
              convId,
              accumulatedContent,
              undefined,
              undefined,
              undefined,
              undefined,
              [...researchTraces],
              flushSources(),
            );
            lastFlush = now;
          }
        } else if (ev.type === 'system_metrics') {
          // Live GPU sample — feed straight to the System panel so Power
          // (W) and Energy (kJ) tick up in real time as the agent runs.
          useAppStore.getState().setLiveEnergy({
            power_w: ev.power_w,
            energy_j: ev.energy_j,
            duration_s: ev.duration_s,
          });
        } else if (ev.type === 'error') {
          // Backend setup/worker failure (Ollama down, planner model
          // missing, KnowledgeStore locked, etc.). Without surfacing the
          // message, the user sees only the generic "No response was
          // generated" fallback and has no way to self-diagnose.
          const msg = ev.message || 'Research failed (no detail provided)';
          accumulatedContent = accumulatedContent
            ? `${accumulatedContent}\n\n**Research stopped:** ${msg}`
            : `**Research failed:** ${msg}`;
          setStreamState({ content: accumulatedContent, phase: '' });
          useAppStore.getState().addLogEntry({
            timestamp: Date.now(),
            level: 'error',
            category: 'chat',
            message: `Deep Research error: ${msg}`,
          });
          toast.error(msg, { duration: 8000 });
        } else if (ev.type === 'done') {
          if (ev.usage) {
            usage = {
              prompt_tokens: ev.usage.prompt_tokens ?? 0,
              completion_tokens: ev.usage.completion_tokens ?? 0,
              total_tokens:
                ev.usage.total_tokens ??
                (ev.usage.prompt_tokens ?? 0) +
                  (ev.usage.completion_tokens ?? 0),
            };
            // Optimistically roll this research turn into the session
            // counters so the Session panel updates the moment the
            // stream finishes, regardless of how /v1/savings aggregates
            // research telemetry server-side.
            useAppStore.getState().incrementSavings(usage);
          }
          // Hold the final live numbers visible for a beat so the panel
          // doesn't flash to 0 between the SSE close and the next
          // /v1/telemetry/energy poll picking up the persisted record.
          window.setTimeout(() => {
            useAppStore.getState().setLiveEnergy(null);
          }, 1500);
          break;
        }
      }
    } else {
    for await (const sseEvent of streamChat(
      { model: selectedModel, messages: apiMessages, stream: true, temperature, max_tokens: maxTokens },
      controller.signal,
    )) {
      const eventName = sseEvent.event;

      if (eventName === 'agent_turn_start') {
        setStreamState({ phase: 'Agent thinking...' });
      } else if (eventName === 'inference_start') {
        setStreamState({ phase: 'Generating...' });
        useAppStore.getState().addLogEntry({
          timestamp: Date.now(), level: 'info', category: 'chat',
          message: `Generating with ${selectedModel}...`,
        });
      } else if (eventName === 'tool_call_start') {
        try {
          const data = JSON.parse(sseEvent.data);
          const tc: ToolCallInfo = {
            id: generateId(),
            tool: data.tool,
            arguments: serializeToolCallArguments(data.arguments),
            status: 'running',
          };
          toolCalls.push(tc);
          setStreamState({
            phase: `Calling ${data.tool}...`,
            activeToolCalls: [...toolCalls],
          });
          updateLastAssistant(convId, accumulatedContent, [...toolCalls]);
          useAppStore.getState().addLogEntry({
            timestamp: Date.now(), level: 'info', category: 'tool',
            message: `Calling ${data.tool}(${serializeToolCallArguments(data.arguments)})`,
          });
        } catch {}
      } else if (eventName === 'tool_call_end') {
        try {
          const data = JSON.parse(sseEvent.data);
          const tc = toolCalls.find(
            (t) => t.tool === data.tool && t.status === 'running',
          );
          if (tc) {
            tc.status = data.success ? 'success' : 'error';
            tc.latency = data.latency;
            tc.result = data.result;
          }
          setStreamState({
            phase: 'Generating...',
            activeToolCalls: [...toolCalls],
          });
          updateLastAssistant(convId, accumulatedContent, [...toolCalls]);
        } catch {}
      } else {
        try {
          const data = JSON.parse(sseEvent.data);
          const delta = data.choices?.[0]?.delta;
          if (data.usage) usage = data.usage;
          if (data.complexity) complexity = data.complexity;
          routedEngine = engineFromCompletionChunk(data) ?? routedEngine;
          if (delta?.content) {
            if (!ttftMs) ttftMs = Date.now() - startTime;
            accumulatedContent += delta.content;
            setStreamState({ content: accumulatedContent, phase: '' });

            const now = Date.now();
            if (now - lastFlush >= 80) {
              updateLastAssistant(
                convId,
                accumulatedContent,
                toolCalls.length > 0 ? [...toolCalls] : undefined,
              );
              lastFlush = now;
            }
          }
          if (data.choices?.[0]?.finish_reason === 'stop') break;
        } catch {}
      }
    }
    }
  } catch (err: any) {
    if (err.name === 'AbortError') {
      // User cancelled or model switch — keep whatever was accumulated
      if (!accumulatedContent) accumulatedContent = '(Generation stopped)';
    } else {
      const errMsg = err?.message || String(err);
      accumulatedContent =
        accumulatedContent || `Error: ${errMsg}`;
      useAppStore.getState().addLogEntry({
        timestamp: Date.now(), level: 'error', category: 'chat',
        message: `Stream error: ${errMsg}`,
      });
    }
    // If we tore out mid-research, make sure the live System panel
    // numbers don't get stuck on the last sample.
    useAppStore.getState().setLiveEnergy(null);
  } finally {
    if (!accumulatedContent) {
      accumulatedContent = 'No response was generated. Please try again.';
    }
    const totalMs = Date.now() - startTime;
    const appState = useAppStore.getState();
    const selectedOwner = appState.models.find((m) => m.id === selectedModel)?.owned_by;
    const engineLabel = resolveChatEngine({
      routedEngine,
      serverEngine: appState.serverInfo?.engine,
      selectedModel,
      selectedOwner,
    });
    const telemetry: MessageTelemetry = {
      engine: engineLabel,
      model_id: selectedModel,
      total_ms: totalMs,
      ttft_ms: ttftMs,
      tokens_per_sec: usage?.completion_tokens
        ? usage.completion_tokens / (totalMs / 1000)
        : undefined,
      complexity_score: complexity?.score,
      complexity_tier: complexity?.tier,
      suggested_max_tokens: complexity?.suggested_max_tokens,
    };
    // Check if the response has digest audio available
    let audioMeta: { url: string } | undefined;
    try {
      const digestRes = await fetch(`${getBase()}/api/digest`);
      if (digestRes.ok) {
        const digest = await digestRes.json();
        if (digest.audio_available) {
          audioMeta = { url: `${getBase()}/api/digest/audio` };
        }
      }
    } catch {
      // Not a digest response or server unavailable — skip
    }

    updateLastAssistant(
      convId,
      accumulatedContent,
      toolCalls.length > 0 ? toolCalls : undefined,
      usage,
      telemetry,
      audioMeta,
      researchTraces.length > 0 ? researchTraces : undefined,
      researchSourcesByRef.size > 0 ? flushSources() : undefined,
    );
    clearElapsedTimer();
    resetStream();
    useAppStore.getState().addLogEntry({
      timestamp: Date.now(), level: 'info', category: 'chat',
      message: `Response: ${accumulatedContent.length} chars`,
    });
    // Only release the handle if a newer send has not replaced it.
    if (abortController === controller) abortController = null;

    // Research path updates session counters optimistically from the
    // `done` event's usage payload — re-fetching here would overwrite
    // it with a potentially stale snapshot if the server's research
    // telemetry hasn't been merged into /v1/savings yet.
    if (!deepResearch) {
      fetchSavings()
        .then((data) => useAppStore.getState().setSavings(data))
        .catch(() => {});
    }
  }
  return 'sent';
}

export function useChatSender() {
  const selectedModel = useAppStore((s) => s.selectedModel);
  const isStreaming = useAppStore((s) => s.streamState.isStreaming);
  const resetStream = useAppStore((s) => s.resetStream);

  // Abort in-flight stream when the user switches models mid-generation.
  // This prevents errors from trying to continue a stream with a stale model.
  const prevModelRef = useRef(selectedModel);
  useEffect(() => {
    if (prevModelRef.current !== selectedModel && isStreaming) {
      abortController?.abort();
      clearElapsedTimer();
      resetStream();
      abortController = null;
    }
    prevModelRef.current = selectedModel;
  }, [selectedModel, isStreaming, resetStream]);

  const send = useCallback((content: string) => sendChatMessage(content), []);
  const stop = useCallback(() => stopChatStream(), []);

  return { send, stop, isStreaming };
}
