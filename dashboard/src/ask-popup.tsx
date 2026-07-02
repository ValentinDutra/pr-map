import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { classifyAskError, thinkingPhase, COLD_COPY, COLD_SLOW_COPY } from './ask-status';
import { aiApi } from './chat-api';
import { buildOutgoingMessages, type ChatMessage } from './chat-messages';
import { MODEL_STORAGE_KEY, resolveInitialModel } from './model-select';
import { computeAnchorPosition } from './popup-position';
import type { ModelInfo } from './types';

interface AiChatPopupProps {
  anchorRect: { top: number; bottom: number; left: number };
  scrollContainer: HTMLElement | null;
  contextCode: string;
  contextLabel: string;
  onClose: () => void;
}

interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

export function AiChatPopup({
  anchorRect,
  scrollContainer: _scrollContainer,
  contextCode,
  contextLabel,
  onClose,
}: AiChatPopupProps) {
  void _scrollContainer;
  const popupRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const openerRef = useRef<Element | null>(null);
  const conversationRef = useRef<HTMLDivElement | null>(null);

  const [size, setSize] = useState({ width: 360, height: 200 });
  const [position, setPosition] = useState<{
    top: number;
    left: number;
    origin: 'top left' | 'bottom left';
  } | null>(null);

  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState(false);
  const initialAnchorRef = useRef(anchorRect);
  const [error, setError] = useState<'unavailable' | 'failed' | null>(null);
  const [lastQuestion, setLastQuestion] = useState('');
  const [modelId, setModelId] = useState<string | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [conversationHistory, setConversationHistory] = useState<ChatMessage[]>([]);

  const [mounted, setMounted] = useState(false);
  const healthCheckedRef = useRef(false);
  const scrollDeltaRef = useRef(0);
  const lastScrollTopsRef = useRef(new Map<EventTarget, number>());
  const [elapsedMs, setElapsedMs] = useState(0);
  const [warming, setWarming] = useState(false);

  useEffect(() => {
    openerRef.current = document.activeElement;
    requestAnimationFrame(() => setMounted(true));
    return () => {
      if (openerRef.current instanceof HTMLElement) {
        openerRef.current.focus();
      }
    };
  }, []);

  useEffect(() => {
    aiApi
      .listModels()
      .then(({ models }) => {
        setModels(models);
        setModelId((cur) =>
          cur ?? (resolveInitialModel(models, localStorage.getItem(MODEL_STORAGE_KEY)) || null)
        );
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!modelId || healthCheckedRef.current) return;
    healthCheckedRef.current = true;
    aiApi
      .health(modelId)
      .then(({ ready }) => setWarming(!ready))
      .catch(() => {});
  }, [modelId]);

  useEffect(() => {
    if (mounted && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [mounted]);

  useLayoutEffect(() => {
    if (!popupRef.current) return;
    const rect = popupRef.current.getBoundingClientRect();
    setSize({ width: rect.width, height: rect.height });
  }, [turns, pending, error]);

  const computePositionWithDelta = () => {
    const adjustedAnchor = {
      top: initialAnchorRef.current.top - scrollDeltaRef.current,
      bottom: initialAnchorRef.current.bottom - scrollDeltaRef.current,
      left: initialAnchorRef.current.left,
    };
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    return computeAnchorPosition(adjustedAnchor, viewport, size);
  };

  useLayoutEffect(() => {
    setPosition(computePositionWithDelta());
  }, [anchorRect, size]);

  useEffect(() => {
    const handleScroll = (event: Event) => {
      const target = event.target;
      if (!target) return;
      if (target instanceof Element && popupRef.current?.contains(target)) return;
      const scrollTop =
        target === document || target === document.documentElement
          ? window.scrollY
          : target instanceof HTMLElement
            ? target.scrollTop
            : 0;
      const lastTop = lastScrollTopsRef.current.get(target) ?? scrollTop;
      const delta = scrollTop - lastTop;
      lastScrollTopsRef.current.set(target, scrollTop);
      if (delta !== 0) {
        scrollDeltaRef.current += delta;
        setPosition(computePositionWithDelta());
      }
    };
    const handleResize = () => setPosition(computePositionWithDelta());
    document.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);
    return () => {
      document.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
    };
  }, [size]);

  useEffect(() => {
    if (conversationRef.current) {
      conversationRef.current.scrollTop = conversationRef.current.scrollHeight;
    }
  }, [turns, pending]);

  useEffect(() => {
    if (!pending) {
      setElapsedMs(0);
      return;
    }
    const start = Date.now();
    const interval = setInterval(() => {
      setElapsedMs(Date.now() - start);
    }, 300);
    return () => {
      clearInterval(interval);
      setElapsedMs(0);
    };
  }, [pending]);

  useEffect(() => {
    const handleClickOutside = (event: PointerEvent) => {
      if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('pointerdown', handleClickOutside);
    return () => document.removeEventListener('pointerdown', handleClickOutside);
  }, [onClose]);

  useEffect(() => {
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const resolveModel = async (): Promise<string> => {
    if (modelId) return modelId;
    const { models } = await aiApi.listModels();
    const id = resolveInitialModel(models, localStorage.getItem(MODEL_STORAGE_KEY));
    if (!id) throw new Error('No AI models available');
    setModelId(id);
    return id;
  };

  const runAsk = async (question: string) => {
    setError(null);
    setPending(true);
    try {
      const model = modelId || (await resolveModel());
      const messages = buildOutgoingMessages(conversationHistory, contextCode, question);
      const { reply } = await aiApi.ask({ model, messages });
      setConversationHistory([...messages, { role: 'assistant', content: reply }]);
      setTurns((prev) => [...prev, { role: 'assistant', content: reply }]);
      setWarming(false);
    } catch (e) {
      setError(classifyAskError(e));
    } finally {
      setPending(false);
    }
  };

  const sendMessage = () => {
    if (!input.trim() || pending) return;
    const question = input.trim();
    setInput('');
    setTurns((prev) => [...prev, { role: 'user', content: question }]);
    setLastQuestion(question);
    void runAsk(question);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  };

  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const animationStyle = mounted
    ? { opacity: 1, transform: 'scale(1)' }
    : { opacity: 0, transform: prefersReducedMotion ? 'scale(1)' : 'scale(0.96)' };

  const transitionStyle = prefersReducedMotion
    ? { transition: 'opacity 170ms var(--ease-out)' }
    : { transition: 'opacity 170ms var(--ease-out), transform 170ms var(--ease-out)' };

  if (!position) return null;

  return createPortal(
    <div
      ref={popupRef}
      className="fixed z-40 flex w-[360px] max-h-[min(60vh,420px)] flex-col rounded-md border border-slate-200 bg-white text-slate-900 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      style={{
        top: position.top,
        left: position.left,
        transformOrigin: position.origin,
        ...animationStyle,
        ...transitionStyle,
      }}
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 dark:border-slate-800">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
            {contextLabel}
          </span>
          {warming && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              warming up
            </span>
          )}
          {models.length > 0 && (
            <select
              value={modelId ?? ''}
              onChange={(e) => {
                const id = e.target.value;
                setModelId(id);
                localStorage.setItem(MODEL_STORAGE_KEY, id);
                setWarming(true);
                aiApi.warm({ model: id }).then(() => setWarming(false), () => setWarming(false));
              }}
              className="max-w-[150px] truncate rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          aria-label="Close"
        >
          &#10005;
        </button>
      </div>

      <div
        ref={conversationRef}
        className="flex flex-1 flex-col gap-2 overflow-y-auto p-3"
      >
        {turns.map((turn, index) =>
          turn.role === 'user' ? (
            <div
              key={index}
              className="self-end rounded bg-slate-100 px-2 py-1 text-sm dark:bg-slate-800"
            >
              {turn.content}
            </div>
          ) : (
            <div
              key={index}
              className="whitespace-pre-wrap border-l-2 border-purple-300 bg-purple-50/50 px-2 py-1.5 text-sm dark:border-purple-700 dark:bg-purple-950/20"
            >
              {turn.content}
            </div>
          ),
        )}
        {pending && (() => {
          const phase = thinkingPhase(elapsedMs);
          if (phase === 'warm') {
            return prefersReducedMotion ? (
              <div className="text-sm text-slate-500 dark:text-slate-400">Thinking...</div>
            ) : (
              <div className="flex gap-1 text-slate-400 dark:text-slate-500">
                <span className="thinking-dot" />
                <span className="thinking-dot" />
                <span className="thinking-dot" />
              </div>
            );
          }
          const copy = phase === 'cold' ? COLD_COPY : COLD_SLOW_COPY;
          return (
            <div className="flex flex-col gap-1.5">
              <div
                className={`h-1.5 w-24 rounded-full ${
                  prefersReducedMotion ? 'thinking-shimmer-reduced' : 'thinking-shimmer'
                }`}
              />
              <span className="text-xs text-slate-500 dark:text-slate-400">{copy}</span>
            </div>
          );
        })()}
        {error === 'unavailable' && (
          <div className="border-l-2 border-amber-400 bg-amber-50 px-2 py-1.5 text-sm dark:bg-amber-950/30">
            <p className="text-amber-800 dark:text-amber-200">
              llama.cpp is not installed. Run:
            </p>
            <div className="mt-1 flex items-center gap-2">
              <code className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900 dark:bg-amber-900/50 dark:text-amber-100">
                brew install llama.cpp
              </code>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText('brew install llama.cpp').catch(() => {});
                }}
                className="rounded px-1.5 py-0.5 text-xs text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/50"
              >
                Copy
              </button>
            </div>
          </div>
        )}
        {error === 'failed' && (
          <div className="border-l-2 border-red-400 bg-red-50 px-2 py-1.5 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">
            <p>Request failed.</p>
            <button
              type="button"
              onClick={() => {
                if (!pending) void runAsk(lastQuestion);
              }}
              disabled={pending}
              className="mt-1 rounded bg-red-100 px-2 py-0.5 text-xs text-red-800 hover:bg-red-200 dark:bg-red-900/50 dark:text-red-200 dark:hover:bg-red-800/50"
            >
              Retry
            </button>
          </div>
        )}
      </div>

      <div className="flex gap-2 border-t border-slate-100 p-2 dark:border-slate-800">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about this code..."
          rows={1}
          className="min-h-[36px] flex-1 resize-none rounded border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />
        <button
          type="button"
          onClick={sendMessage}
          disabled={!input.trim() || pending}
          className="rounded bg-slate-700 px-3 py-1.5 text-sm text-white disabled:opacity-40 dark:bg-slate-600"
        >
          Send
        </button>
      </div>
    </div>,
    document.body,
  );
}
