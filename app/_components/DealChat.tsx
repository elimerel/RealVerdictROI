"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import type { DealInputs } from "@/lib/calculations";

const SUGGESTIONS = [
  "What would make this deal work?",
  "What's the biggest risk here?",
  "What rent do I need to break even?",
  "What price should I offer instead?",
  "How does this compare to a good deal?",
] as const;

export default function DealChat({ inputs }: { inputs: DealInputs }) {
  // `inputs` never changes for a given results URL, so the transport
  // can be instantiated once per mount.
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages }) => ({
          body: { messages, inputs },
        }),
      }),
    [inputs],
  );

  const { messages, sendMessage, status, stop, error, setMessages } = useChat({
    transport,
  });

  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll whenever new content streams in.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    sendMessage({ text: trimmed });
    setInput("");
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (status === "streaming" || status === "submitted") return;
    send(input);
  };

  const isBusy = status === "streaming" || status === "submitted";
  const hasConversation = messages.length > 0;

  return (
    <section className="mb-12">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Ask about this deal
          </h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Grounded in your exact numbers — not generic advice.
          </p>
        </div>
        {hasConversation && (
          <button
            type="button"
            onClick={() => {
              stop();
              setMessages([]);
            }}
            className="text-xs font-medium text-zinc-500 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
          >
            Clear chat
          </button>
        )}
      </div>

      <div className="flex flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <div
          ref={scrollRef}
          className="flex max-h-[32rem] min-h-[16rem] flex-col gap-4 overflow-y-auto p-5"
        >
          {!hasConversation && (
            <EmptyState />
          )}

          {messages.map((m) => (
            <Message key={m.id} role={m.role}>
              {m.parts.map((part, i) => {
                if (part.type === "text") {
                  return (
                    <span key={i} className="whitespace-pre-wrap">
                      {part.text}
                    </span>
                  );
                }
                return null;
              })}
              {/* Typing dots while this is the last message and we're still streaming */}
              {m === messages[messages.length - 1] &&
                m.role === "assistant" &&
                isBusy && <TypingDots className="ml-1 inline-flex" />}
            </Message>
          ))}

          {status === "submitted" &&
            (messages.length === 0 ||
              messages[messages.length - 1].role === "user") && (
              <Message role="assistant">
                <TypingDots />
              </Message>
            )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
              Something went wrong. {error.message || "Please try again."}
            </div>
          )}
        </div>

        <div className="border-t border-zinc-100 bg-zinc-50/60 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
          {/* Quick-tap suggestion chips */}
          <div className="mb-3 flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                disabled={isBusy}
                onClick={() => send(s)}
                className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
              >
                {s}
              </button>
            ))}
          </div>

          <form onSubmit={onSubmit} className="flex items-center gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={isBusy}
              placeholder="Ask anything about this deal…"
              className="flex-1 rounded-full border border-zinc-200 bg-white px-4 py-2.5 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50 dark:focus:border-zinc-200 dark:focus:ring-zinc-100/10"
            />
            {isBusy ? (
              <button
                type="button"
                onClick={() => stop()}
                className="inline-flex h-10 items-center justify-center rounded-full border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
              >
                Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                className="inline-flex h-10 items-center justify-center rounded-full bg-zinc-900 px-5 text-sm font-semibold text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                Send
              </button>
            )}
          </form>
        </div>
      </div>
    </section>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 via-sky-500 to-indigo-500 text-white shadow-lg">
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-5 w-5"
          aria-hidden="true"
        >
          <path d="M2 5.5A2.5 2.5 0 014.5 3h11A2.5 2.5 0 0118 5.5v7A2.5 2.5 0 0115.5 15h-3.69l-3.15 2.63a1 1 0 01-1.66-.76V15H4.5A2.5 2.5 0 012 12.5v-7z" />
        </svg>
      </div>
      <div className="max-w-sm">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Ask anything about this specific deal.
        </h3>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          RealVerdict has the full picture — price, rent, financing, projected
          IRR, risks — and will answer with your actual numbers.
        </p>
      </div>
    </div>
  );
}

function Message({
  role,
  children,
}: {
  role: "user" | "assistant" | "system";
  children: React.ReactNode;
}) {
  if (role === "system") return null;
  const isUser = role === "user";
  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      <div
        className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          isUser
            ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
            : "bg-gradient-to-br from-emerald-500 via-sky-500 to-indigo-500 text-white"
        }`}
      >
        {isUser ? "You" : "RV"}
      </div>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
            : "bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

function TypingDots({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 ${className}`}
      aria-label="Assistant is typing"
    >
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.3s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.15s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400" />
    </span>
  );
}
