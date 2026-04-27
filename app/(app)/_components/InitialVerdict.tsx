"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useEffect, useMemo, useRef } from "react";
import type { DealInputs } from "@/lib/calculations";
import type { ChatAnalysisContext } from "@/app/api/chat/route";
import { renderAIProse } from "./aiProse";

/**
 * Streams the opening verdict summary on mount via `/api/chat` with
 * mode="verdict". Renders only the assistant paragraph (the hidden user
 * kickoff lives in useChat's state so the model treats it as turn 1, which
 * triggers the structured verdict format). If the API errors or is
 * unconfigured, falls back to the deterministic summary computed by the
 * calculation engine.
 *
 * `analysisContext` is optional; when the parent page has comp data, it
 * passes walk-away price, fair value, and top-3 weak assumptions down so
 * the AI's verdict is in lockstep with the rest of the page instead of
 * re-deriving a "fair offer" that disagrees with the OfferCeilingCard.
 */
export default function InitialVerdict({
  inputs,
  fallback,
  analysisContext,
}: {
  inputs: DealInputs;
  fallback: string;
  analysisContext?: ChatAnalysisContext;
}) {
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ messages }) => ({
          body: { messages, inputs, mode: "verdict", analysisContext },
        }),
      }),
    [inputs, analysisContext],
  );

  const { messages, sendMessage, status, error } = useChat({ transport });

  // Fire once, even under React strict mode's double-invoked effects.
  const kickedOffRef = useRef(false);
  useEffect(() => {
    if (kickedOffRef.current) return;
    kickedOffRef.current = true;
    sendMessage({ text: "Give me your verdict on this deal." });
  }, [sendMessage]);

  const assistant = messages[1];
  const text = assistant?.role === "assistant" ? textOf(assistant) : "";
  const isBusy = status === "streaming" || status === "submitted";
  const isStreaming = isBusy && !!text;
  const isWaiting = isBusy && !text;
  const hasFailed = !!error && !text && !isBusy;

  return (
    <div className="py-2 text-sm leading-relaxed text-zinc-200">
      {text ? (
        <p className="whitespace-pre-wrap">
          {renderAIProse(text)}
          {isStreaming && <Caret />}
        </p>
      ) : hasFailed ? (
        <p className="whitespace-pre-wrap">{renderAIProse(fallback)}</p>
      ) : isWaiting ? (
        <p className="animate-pulse text-zinc-500">Reading the numbers...</p>
      ) : null}
    </div>
  );
}

function Caret() {
  return (
    <span
      aria-hidden
      className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[0.15em] animate-pulse bg-[var(--accent)]"
    />
  );
}

function textOf(m: UIMessage): string {
  return m.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}
