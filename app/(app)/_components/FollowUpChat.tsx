"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useMemo, useState } from "react";
import type { DealInputs } from "@/lib/calculations";
import type { ChatAnalysisContext } from "@/app/api/chat/route";
import { renderAIProse } from "./aiProse";

const SUGGESTIONS = [
  "What would make this work?",
  "What's the actual risk here?",
  "What price should I offer?",
] as const;

/**
 * The follow-up conversation. Starts empty — no auto-kickoff. User's own
 * message triggers the first round. Uses mode="chat" which selects gpt-4o
 * server-side. Responses are rendered in the exact same visual language as
 * the opening verdict (accent left border, faint accent tint).
 *
 * `analysisContext` (optional) feeds the AI the authoritative walk-away,
 * fair value, and weak assumptions so it doesn't invent competing
 * numbers when the user asks "what should I offer?"
 */
export default function FollowUpChat({
  inputs,
  analysisContext,
}: {
  inputs: DealInputs;
  analysisContext?: ChatAnalysisContext;
}) {
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages }) => ({
          body: { messages, inputs, mode: "chat", analysisContext },
        }),
      }),
    [inputs, analysisContext],
  );

  const { messages, sendMessage, status, error, stop } = useChat({ transport });

  const [input, setInput] = useState("");
  const isBusy = status === "streaming" || status === "submitted";

  // Pair messages into question/answer blocks for rendering.
  const pairs: Pair[] = [];
  for (let i = 0; i < messages.length; i += 2) {
    const q = messages[i];
    if (!q || q.role !== "user") break;
    const a = messages[i + 1];
    const isLast = i + 2 >= messages.length;
    pairs.push({
      id: q.id,
      question: textOf(q),
      answer: a?.role === "assistant" ? textOf(a) : "",
      isAnswering: isLast && isBusy && !a,
      isStreaming: isLast && isBusy && !!a,
    });
  }

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isBusy) return;
    sendMessage({ text: trimmed });
    setInput("");
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    submit(input);
  };

  return (
    <div className="flex flex-col gap-8">
      {pairs.length > 0 && (
        <div className="flex flex-col gap-8">
          {pairs.map((p) => (
            <PairBlock key={p.id} pair={p} />
          ))}
        </div>
      )}

      {error && pairs.length === 0 && (
        <p className="text-sm text-red-400">
          Couldn&rsquo;t reach the advisor ({error.message || "unknown error"}).
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            disabled={isBusy}
            onClick={() => submit(s)}
            className="rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {s}
          </button>
        ))}
      </div>

      <form onSubmit={onSubmit} className="relative">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isBusy}
          placeholder="Ask a follow-up about this deal..."
          aria-label="Ask a follow-up question"
          className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-3.5 pr-24 text-[15px] text-zinc-100 outline-none transition placeholder:text-zinc-500 focus:border-[var(--accent)] disabled:opacity-60"
        />
        {isBusy ? (
          <button
            type="button"
            onClick={() => stop()}
            className="absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center justify-center rounded-md px-3 py-1.5 text-xs font-medium text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            style={{ backgroundColor: "var(--accent)" }}
            className="absolute right-2 top-1/2 inline-flex -translate-y-1/2 items-center justify-center rounded-md px-4 py-1.5 text-xs font-semibold text-black transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Send
          </button>
        )}
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------

type Pair = {
  id: string;
  question: string;
  answer: string;
  isAnswering: boolean;
  isStreaming: boolean;
};

function PairBlock({ pair }: { pair: Pair }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-zinc-400">{pair.question}</p>
      <div
        className="border-l-2 pl-4 sm:pl-5"
        style={{
          borderColor: "var(--accent)",
          backgroundColor: "var(--accent-soft)",
        }}
      >
        <div className="py-3 text-[15px] leading-relaxed text-zinc-200 sm:text-base">
          {pair.isAnswering ? (
            <p className="animate-pulse text-zinc-500">Thinking…</p>
          ) : (
            <p className="whitespace-pre-wrap">
              {renderAIProse(pair.answer)}
              {pair.isStreaming && (
                <span
                  aria-hidden
                  className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[0.15em] animate-pulse bg-[var(--accent)]"
                />
              )}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function textOf(m: UIMessage): string {
  return m.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}
