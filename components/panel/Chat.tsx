"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Send, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
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

  // Suggestion-pick handler — either pre-applies a scenario change (the
  // ✦ chips) or just sends the canned question.
  const onPickSuggestion = useCallback((suggestion: SmartSuggestion) => {
    if (suggestion.scenario) {
      applyScenarioFromBus(suggestion.scenario)
    }
    setShowSuggestions(false)
    const userMsg: ChatMessage = {
      id:      `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
      role:    "user",
      content: suggestion.query,
      at:      Date.now(),
    }
    void onSend(userMsg)
  }, [onSend])

  // Internal expand state — drives whether suggestions/history show.
  // Compact (collapsed) = just the input bar at the bottom (~52px).
  // Expanded = suggestions popover above the bar OR conversation
  // history floating above the bar. Either way the analysis above is
  // mostly visible — chat is unobtrusive when not in use.
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [showHistory, setShowHistory] = useState(empty ? false : true)
  // When messages first appear, auto-show history. When clear → hide.
  useEffect(() => { setShowHistory(messages.length > 0) }, [messages.length])

  // Suppress unused warning
  void context

  return (
    <div
      className="absolute left-0 right-0 bottom-0 flex flex-col pointer-events-none"
      style={{ zIndex: 20 }}
    >
      {/* Conversation history — only renders when there are messages.
          Floats above the input as a translucent overlay. The analysis
          above is still visible behind the soft scrim. Click the X to
          collapse history (messages stay; just hide the panel). */}
      {showHistory && messages.length > 0 && (
        <div
          className="pointer-events-auto mx-3 mb-2 rounded-[12px] flex flex-col rv-chat-history-pop"
          style={{
            maxHeight:        "min(360px, 60vh)",
            background:       "var(--rv-popover-bg)",
            backdropFilter:   "blur(28px) saturate(160%)",
            WebkitBackdropFilter: "blur(28px) saturate(160%)",
            border:           "0.5px solid var(--rv-border-mid)",
            boxShadow:        "0 12px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.04)",
            overflow:         "hidden",
          }}
        >
          <div className="flex items-center justify-between px-3 pt-2 pb-1.5 shrink-0">
            <span className="text-[10px] uppercase tracking-widest font-medium" style={{ color: "var(--rv-t4)" }}>
              Conversation · {messages.length}
            </span>
            <div className="flex items-center gap-1">
              {onClear && (
                <Button onClick={onClear} variant="ghost" size="xs">Clear</Button>
              )}
              <Button
                onClick={() => setShowHistory(false)}
                aria-label="Hide conversation"
                variant="ghost"
                size="icon-xs"
                className="size-5"
              >
                <svg width="10" height="10" viewBox="0 0 11 11" fill="none" aria-hidden>
                  <path d="M2.5 2.5L8.5 8.5M8.5 2.5L2.5 8.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </Button>
            </div>
          </div>
          <div
            ref={scrollRef}
            className="flex-1 min-h-0 overflow-y-auto panel-scroll px-3 pb-3 flex flex-col gap-2.5"
          >
            {messages.map((m) => <ChatBubble key={m.id} message={m} />)}
            {loading && <ChatTyping />}
          </div>
        </div>
      )}

      {/* Suggestions popover — shows when user clicks the ✦ chip.
          Floats above the input bar; click outside or pick a suggestion
          to dismiss. Hidden when there's already conversation history. */}
      {showSuggestions && empty && (
        <div
          className="pointer-events-auto mx-3 mb-2 rounded-[12px] flex flex-col gap-1.5 px-2.5 pt-2.5 pb-2 rv-chat-history-pop"
          style={{
            background:       "var(--rv-popover-bg)",
            backdropFilter:   "blur(28px) saturate(160%)",
            WebkitBackdropFilter: "blur(28px) saturate(160%)",
            border:           "0.5px solid var(--rv-border-mid)",
            boxShadow:        "0 12px 32px rgba(0,0,0,0.45)",
          }}
        >
          <ChatSuggestions onPick={onPickSuggestion} disabled={disabled} />
        </div>
      )}

      {/* The slim input bar — always visible at the bottom. Collapsed
          state of the chat (52px). Click the ✦ to reveal suggestions;
          type to ask anything. */}
      <div
        className="pointer-events-auto mx-3 mb-3 rounded-[10px] flex items-end gap-2 px-2.5 py-2 transition-colors"
        style={{
          background:     "var(--rv-popover-bg)",
          backdropFilter: "blur(28px) saturate(160%)",
          WebkitBackdropFilter: "blur(28px) saturate(160%)",
          border:         "0.5px solid var(--rv-border-mid)",
          boxShadow:      "0 6px 18px rgba(0,0,0,0.30)",
        }}
        onClick={() => inputRef.current?.focus()}
      >
        {/* ✦ Sparkle button — toggles the suggestions popover. Doubles
            as a "show conversation" button when there are messages. */}
        <Button
          onClick={(e) => {
            e.stopPropagation()
            if (messages.length > 0) {
              setShowHistory((v) => !v)
            } else {
              setShowSuggestions((v) => !v)
            }
          }}
          disabled={disabled}
          title={messages.length > 0 ? "Toggle conversation" : "Show suggestions"}
          aria-label={messages.length > 0 ? "Toggle conversation" : "Show suggestions"}
          variant="ghost"
          size="icon-xs"
          style={
            (showSuggestions || (messages.length > 0 && showHistory))
              ? { color: "var(--rv-accent)", background: "var(--rv-accent-dim)" }
              : undefined
          }
        >
          <Sparkles size={12} strokeWidth={2} />
        </Button>
        <textarea
          ref={inputRef}
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          disabled={disabled || loading}
          placeholder={disabled ? "Open a listing to ask…" : "Ask anything about this listing…"}
          className="flex-1 bg-transparent border-none outline-none resize-none text-[12.5px] leading-snug py-1"
          style={{
            color:      "var(--rv-t1)",
            maxHeight:  120,
            fontFamily: "inherit",
          }}
          spellCheck
        />
        <Button
          onClick={handleSend}
          disabled={disabled || loading || !draft.trim()}
          aria-label="Send message"
          variant={draft.trim() ? "default" : "ghost"}
          size="icon-xs"
        >
          <Send size={11} strokeWidth={2} />
        </Button>
      </div>
    </div>
  )
}

/** Suggestion chip list — pulled out so it can render in the popover.
 *  Same SmartSuggestion behavior as before. */
function ChatSuggestions({
  onPick, disabled,
}: {
  onPick: (s: SmartSuggestion) => void
  disabled?: boolean
}) {
  if (disabled) return null
  return (
    <>
      {SUGGESTIONS.map((s) => {
        const isAction = !!s.scenario
        return (
          <Button
            key={s.label}
            onClick={() => onPick(s)}
            variant={isAction ? "secondary" : "outline"}
            size="sm"
            className="justify-start text-left text-[12px] whitespace-normal h-auto py-2"
            style={
              isAction
                ? { color: "var(--rv-t1)", background: "var(--rv-accent-dim)", borderColor: "var(--rv-accent-border)" }
                : undefined
            }
          >
            {isAction && (
              <Sparkles size={10} strokeWidth={2} style={{ color: "var(--rv-accent)", flexShrink: 0 }} />
            )}
            <span className="flex-1">{s.label}</span>
          </Button>
        )
      })}
    </>
  )
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
