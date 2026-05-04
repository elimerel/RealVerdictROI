"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Send, Sparkles } from "lucide-react"
import type { ChatContext, ChatMessage } from "@/lib/electron"
import { applyScenarioFromBus, type ScenarioOverrides } from "@/lib/scenario"
import { showToast } from "@/lib/toast"

interface PanelChatProps {
  /** Conversation history for the active listing. Bumped on every send. */
  messages:   ChatMessage[]
  /** Context bundle (listing snapshot + prefs + pipeline) sent with each turn. */
  context:    ChatContext
  /** Push a new user message onto the conversation log. The host page is
   *  responsible for then calling the IPC and pushing the assistant
   *  response (or an error message). */
  onSend:     (message: ChatMessage) => Promise<void>
  /** Disabled when there's no listing to chat about. */
  disabled?:  boolean
  /** Reset / clear the conversation. */
  onClear?:   () => void
  /** Surface-level loading flag — the host page sets true while waiting
   *  on Haiku, false on response or error. */
  loading:    boolean
}

// Smart suggestions — each chip is either a pure question OR a "what
// if?" that pre-applies a scenario change before asking the AI to
// narrate. The scenario-applying chips give the AI-agent feel without
// needing full tool use: the app does the work, the AI explains it.
//
// Each chip has:
//   label    — what the user sees on the chip
//   query    — what gets sent to the AI as the user message
//   scenario — optional partial overrides applied BEFORE the message
//              fires, so the AI sees the new scenario in context and
//              narrates the change
interface SmartSuggestion {
  label:     string
  query:     string
  scenario?: Partial<ScenarioOverrides>
  /** Toast text shown when the scenario change applies. */
  toast?:    string
}

const SUGGESTIONS: SmartSuggestion[] = [
  {
    label: "What's the rent comp range here?",
    query: "What's the rent comp range for this property type and zip code?",
  },
  {
    label: "Why is the cap rate what it is?",
    query: "Walk me through how the cap rate is calculated for this listing — what are the main inputs driving it?",
  },
  {
    label: "What if I put 30% down?",
    query: "I just adjusted to 30% down. What changed in the metrics, and is this typical for deals like this?",
    scenario: { downPaymentPct: 30 },
    toast:    "Adjusted to 30% down.",
  },
  {
    label: "What if rates dropped to 5.95%?",
    query: "I just dropped the rate to 5.95%. How do the metrics shift, and what would I need to believe for this rate to be realistic?",
    scenario: { interestRate: 5.95 },
    toast:    "Adjusted rate to 5.95%.",
  },
  {
    label: "How does this compare to my saves?",
    query: "How does this listing compare to my saved pipeline — better, worse, in line, on which dimensions?",
  },
]

export default function PanelChat({
  messages, context, onSend, disabled, onClear, loading,
}: PanelChatProps) {
  const [draft, setDraft] = useState("")
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-grow the textarea up to a cap, then scroll inside.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [draft])

  // Keep the conversation pinned to the bottom on new messages.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages.length, loading])

  const handleSend = useCallback(async () => {
    const text = draft.trim()
    if (!text || loading || disabled) return
    setDraft("")
    const userMsg: ChatMessage = {
      id:      `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
      role:    "user",
      content: text,
      at:      Date.now(),
    }
    await onSend(userMsg)
  }, [draft, loading, disabled, onSend])

  const onKey = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter inserts a newline.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }, [handleSend])

  const empty = messages.length === 0

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Conversation scroll area */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto panel-scroll px-4 py-4 flex flex-col gap-3"
      >
        {empty ? (
          <ChatEmpty
            onPickSuggestion={(suggestion) => {
              // If the chip carries a scenario change, apply it via the
              // bus immediately — ResultPane will re-mount when the user
              // returns to metrics view, but the bus dispatch happens
              // synchronously and any mounted ResultPane updates live.
              // Then send the question to the AI so it can narrate.
              if (suggestion.scenario) {
                applyScenarioFromBus(suggestion.scenario)
                if (suggestion.toast) {
                  showToast({
                    message: suggestion.toast,
                    detail:  "Switch to metrics view to see the new numbers.",
                    tone:    "pos",
                  })
                }
              }
              // Send the message immediately rather than just filling the
              // draft — chips are an action, not a typing helper.
              const text = suggestion.query
              const userMsg: ChatMessage = {
                id:      `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
                role:    "user",
                content: text,
                at:      Date.now(),
              }
              void onSend(userMsg)
            }}
            disabled={disabled}
          />
        ) : (
          messages.map((m) => <ChatBubble key={m.id} message={m} />)
        )}
        {loading && <ChatTyping />}
      </div>

      {/* Composer pinned to bottom */}
      <div
        className="shrink-0 px-3 py-2.5"
        style={{ borderTop: "0.5px solid var(--rv-border)" }}
      >
        <div
          className="flex items-end gap-2 rounded-[10px] px-3 py-2 transition-colors"
          style={{
            background: "var(--rv-elev-2)",
            border:     "0.5px solid var(--rv-border)",
          }}
          onClick={() => inputRef.current?.focus()}
        >
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            disabled={disabled || loading}
            placeholder={disabled ? "Open a listing to ask…" : "Ask anything about this listing…"}
            className="flex-1 bg-transparent border-none outline-none resize-none text-[12.5px] leading-snug"
            style={{
              color:      "var(--rv-t1)",
              maxHeight:  120,
              fontFamily: "inherit",
            }}
            spellCheck
          />
          <button
            onClick={handleSend}
            disabled={disabled || loading || !draft.trim()}
            aria-label="Send message"
            className="shrink-0 inline-flex items-center justify-center rounded-[6px] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            style={{
              width:      26,
              height:     26,
              color:      draft.trim() ? "var(--rv-accent)" : "var(--rv-t4)",
              background: draft.trim() ? "rgba(48,164,108,0.10)" : "transparent",
              border:     `0.5px solid ${draft.trim() ? "rgba(48,164,108,0.22)" : "transparent"}`,
            }}
          >
            <Send size={11} strokeWidth={2} />
          </button>
        </div>
        {messages.length > 0 && onClear && (
          <button
            onClick={onClear}
            className="mt-2 text-[10.5px]"
            style={{ color: "var(--rv-t4)" }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--rv-t2)" }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--rv-t4)" }}
          >
            Clear conversation
          </button>
        )}
      </div>
    </div>
  )

  // Suppress unused-import warning since we don't render context directly
  // (only use it for IPC). Kept in props so the typing flows for callers.
  void context
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user"
  return (
    <div className={isUser ? "flex flex-col items-end" : "flex flex-col items-start"}>
      <div
        className="max-w-[260px] rounded-[10px] px-3 py-2 text-[12.5px] leading-snug"
        style={{
          background: isUser ? "rgba(48,164,108,0.10)" : "var(--rv-elev-2)",
          border:     `0.5px solid ${isUser ? "rgba(48,164,108,0.22)" : "var(--rv-border)"}`,
          color:      isUser ? "var(--rv-t1)" : "var(--rv-t1)",
          letterSpacing: "-0.005em",
        }}
      >
        <Markdownish text={message.content} />
      </div>
    </div>
  )
}

function ChatTyping() {
  return (
    <div className="flex flex-col items-start">
      <div
        className="rounded-[10px] px-3 py-2.5 inline-flex items-center gap-1.5"
        style={{
          background: "var(--rv-elev-2)",
          border:     "0.5px solid var(--rv-border)",
        }}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-1.5 h-1.5 rounded-full"
            style={{
              background:      "var(--rv-t3)",
              animation:       "dotPulse 1.4s ease-in-out infinite",
              animationDelay:  `${i * 0.18}s`,
            }}
          />
        ))}
      </div>
    </div>
  )
}

function ChatEmpty({
  onPickSuggestion, disabled,
}: {
  onPickSuggestion: (s: SmartSuggestion) => void
  disabled?: boolean
}) {
  return (
    <div className="flex flex-col gap-3.5 py-4">
      <div className="flex items-start gap-2.5">
        <span style={{ color: "var(--rv-accent)", marginTop: 1 }}>
          <Sparkles size={14} strokeWidth={1.7} />
        </span>
        <div>
          <p className="text-[13px] font-medium leading-tight" style={{ color: "var(--rv-t1)" }}>
            Ask about this listing
          </p>
          <p className="text-[11.5px] leading-snug mt-1" style={{ color: "var(--rv-t3)" }}>
            Hypothetical underwriting, comp ranges, why a metric is what it is. The ✦ chips actually adjust the scenario for you, then explain what changed.
          </p>
        </div>
      </div>
      {!disabled && (
        <div className="flex flex-col gap-1.5 mt-1">
          {SUGGESTIONS.map((s) => {
            const isAction = !!s.scenario
            return (
              <button
                key={s.label}
                onClick={() => onPickSuggestion(s)}
                className="text-left rounded-[7px] px-3 py-2 text-[12px] transition-colors flex items-center gap-2"
                style={{
                  color:      "var(--rv-t2)",
                  background: isAction ? "var(--rv-accent-dim)" : "var(--rv-elev-1)",
                  border:     `0.5px solid ${isAction ? "var(--rv-accent-border)" : "var(--rv-border)"}`,
                }}
                onMouseEnter={(e) => {
                  if (isAction) {
                    e.currentTarget.style.background = "var(--rv-accent-border)"
                  } else {
                    e.currentTarget.style.background = "var(--rv-elev-3)"
                  }
                  e.currentTarget.style.color = "var(--rv-t1)"
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = isAction ? "var(--rv-accent-dim)" : "var(--rv-elev-1)"
                  e.currentTarget.style.color      = "var(--rv-t2)"
                }}
              >
                {/* Action chips get the sparkle marker — visual cue
                    that the chip will DO something, not just ask. */}
                {isAction && (
                  <Sparkles size={10} strokeWidth={2} style={{ color: "var(--rv-accent)", flexShrink: 0 }} />
                )}
                <span className="flex-1">{s.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Bare-minimum markdown render: bold (`**text**`) and line breaks.
 *  Avoids pulling in a markdown library — Haiku rarely uses anything
 *  more elaborate, and the system prompt prohibits headers/bullets. */
function Markdownish({ text }: { text: string }) {
  const lines = text.split("\n")
  return (
    <>
      {lines.map((line, i) => (
        <span key={i} style={{ display: "block" }}>
          {renderInlineBold(line)}
          {i < lines.length - 1 && <br />}
        </span>
      ))}
    </>
  )
}

function renderInlineBold(text: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  const regex = /\*\*(.+?)\*\*/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    parts.push(<strong key={m.index} style={{ fontWeight: 600 }}>{m[1]}</strong>)
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts.length === 0 ? text : parts
}
