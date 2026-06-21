import { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  ShieldCheck,
  Search,
  GraduationCap,
  ExternalLink,
  ArrowUp,
  Send,
  Plus,
  Loader2,
} from "lucide-react";
import {
  chat,
  convert,
  replyToComment,
  type AgentComment,
  type BlogPostResult,
  type ChatTurn,
  type ConfidenceLevel,
  type ParagraphStatus,
  type Paragraph as ParagraphT,
} from "./api";
import CursorEffects from "./CursorEffects";

type AppState = "home" | "chat" | "loading" | "workspace";

const SUGGESTIONS = [
  "Explain how SSMs compare to Transformers",
  "Why is the sky blue?",
  "How do vaccines train the immune system?",
  "What caused the 2008 financial crisis?",
];

const LOADING_STEPS = [
  "Drafting the study post…",
  "Domain Expert reviewing…",
  "Skeptical Critic checking claims…",
  "Verifier fetching web sources…",
  "Synthesizing trust signals…",
];

// ── small UI helpers ─────────────────────────────────────────────────────────────

const STATUS_PARA: Record<ParagraphStatus, string> = {
  verified: "border-l-4 border-verified bg-verified/10",
  disputed: "border-l-4 border-disputed bg-disputed/10",
  hallucination: "border-l-4 border-hallucination bg-hallucination/10",
  neutral: "border-l-4 border-transparent",
};

const VERDICT_BADGE: Record<string, string> = {
  supports: "bg-verified/15 text-verified",
  refutes: "bg-hallucination/15 text-hallucination",
  unclear: "bg-disputed/15 text-disputed",
};

const CONFIDENCE_STYLE: Record<ConfidenceLevel, string> = {
  high: "bg-verified/15 text-verified",
  medium: "bg-disputed/15 text-disputed",
  low: "bg-hallucination/15 text-hallucination",
};

function personaColor(role: string): string {
  const r = role.toLowerCase();
  if (r.includes("verif")) return "var(--color-factcheck)";
  if (r.includes("fact") || r.includes("skeptic")) return "var(--color-skeptic)";
  if (r.includes("domain") || r.includes("expert")) return "var(--color-explainer)";
  if (r.includes("devil") || r.includes("advocate")) return "var(--color-defender)";
  return "var(--color-consensus)";
}

/** Maps agent role keywords → avatar image path in /avatars/. */
function personaAvatar(agent: string, role: string): string {
  const r = role.toLowerCase();
  if (agent === "verifier" || r.includes("verif")) return "/avatars/verifier.svg";
  if (r.includes("fact") || r.includes("skeptic")) return "/avatars/skeptic.svg";
  if (r.includes("domain") || r.includes("expert")) return "/avatars/expert.svg";
  if (r.includes("devil") || r.includes("advocate")) return "/avatars/advocate.svg";
  return "/avatars/generator.svg";
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-1" aria-label="Tutor is typing">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-gold"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </span>
  );
}

function AgentIcon({ agent, role }: { agent: string; role: string }) {
  const r = role.toLowerCase();
  const cls = "h-4 w-4";
  if (agent === "verifier") return <ShieldCheck className={cls} />;
  if (r.includes("fact") || r.includes("skeptic")) return <Search className={cls} />;
  if (r.includes("domain") || r.includes("expert")) return <GraduationCap className={cls} />;
  return <Sparkles className={cls} />;
}

// ── Fireflies — ambient floating particles ──────────────────────────────────────

function Fireflies({ count = 12 }: { count?: number }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          className="firefly"
          style={{
            left: `${Math.random() * 100}%`,
            bottom: `${Math.random() * 30}%`,
            animationDelay: `${Math.random() * 4}s`,
            animationDuration: `${3 + Math.random() * 3}s`,
          }}
        />
      ))}
    </div>
  );
}

// ── TopBar ─────────────────────────────────────────────────────────────────────

function TopBar({ onHome }: { onHome: () => void }) {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-surface/90 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <button onClick={onHome} className="flex items-center gap-2.5 font-semibold tracking-tight">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-gold text-background">
            <Sparkles className="h-4 w-4" />
          </span>
          <span className="font-serif text-lg text-gold">Sourcerer</span>
        </button>
        <nav className="hidden gap-6 text-sm text-muted sm:flex">
          <span className="cursor-default transition hover:text-gold">How it works</span>
          <span className="cursor-default transition hover:text-gold">About</span>
        </nav>
      </div>
    </header>
  );
}

// ── Home ─────────────────────────────────────────────────────────────────────────

function HomeView({ onAsk }: { onAsk: (q: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="fade-in relative mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-2xl flex-col items-center justify-center px-4 pb-24">
      <Fireflies count={16} />
      <h1
        className="glow-pulse mb-3 text-center text-4xl font-bold tracking-tight text-gold sm:text-5xl"
        style={{ fontFamily: "var(--font-display)" }}
      >
        Ask something worth trusting
      </h1>
      <p className="mb-8 text-center text-muted">
        Study with an AI tutor, then convert the chat into a fact‑checked, source‑backed post.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onAsk(value.trim());
        }}
        className="w-full"
      >
        <div className="golden-focus flex items-center gap-2 rounded-2xl border border-border bg-surface p-2 shadow-lg transition">
          <Search className="ml-2 h-5 w-5 text-muted" />
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Explain how SSMs compare to Transformers"
            className="flex-1 bg-transparent px-1 py-2 text-[15px] text-foreground outline-none placeholder:text-muted"
          />
          <button
            type="submit"
            disabled={!value.trim()}
            className="btn-gold grid h-9 w-9 place-items-center rounded-xl"
          >
            <ArrowUp className="h-5 w-5" />
          </button>
        </div>
      </form>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => onAsk(s)}
            className="rounded-full border border-border bg-surface px-3.5 py-1.5 text-sm text-muted transition hover:border-gold/40 hover:text-gold hover:shadow-[0_0_12px_oklch(0.78_0.16_75/0.15)]"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Chat ───────────────────────────────────────────────────────────────────────

function ChatView({
  messages,
  thinking,
  onSend,
  onConvert,
}: {
  messages: ChatTurn[];
  thinking: boolean;
  onSend: (text: string) => void;
  onConvert: () => void;
}) {
  const [value, setValue] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-5 px-4 py-8 pb-40">
          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div
                className={
                  m.role === "user"
                    ? "max-w-[85%] whitespace-pre-wrap rounded-2xl bg-gold/20 border border-gold/30 px-4 py-2.5 text-[15px] leading-[1.7] text-foreground"
                    : "max-w-[85%] whitespace-pre-wrap rounded-2xl border border-border bg-surface px-4 py-2.5 text-[15px] leading-[1.75]"
                }
              >
                {m.content}
              </div>
            </div>
          ))}
          {thinking && (
            <div className="flex justify-start">
              <div className="rounded-2xl border border-border bg-surface px-4 py-3">
                <TypingDots />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Composer + convert button */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-10">
        <div className="mx-auto max-w-3xl px-4 pb-5">
          <div className="pointer-events-auto mb-3 flex justify-center">
            <button
              onClick={onConvert}
              disabled={thinking || messages.length === 0}
              className="btn-gold flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium shadow-lg"
            >
              <ShieldCheck className="h-4 w-4" />
              Convert to Verifiable Blog Post
            </button>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (value.trim() && !thinking) {
                onSend(value.trim());
                setValue("");
              }
            }}
            className="golden-focus pointer-events-auto flex items-center gap-2 rounded-2xl border border-border bg-surface p-2 shadow-md transition"
          >
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Ask a follow-up…"
              className="flex-1 bg-transparent px-2 py-1.5 text-[15px] text-foreground outline-none placeholder:text-muted"
            />
            <button
              type="submit"
              disabled={!value.trim() || thinking}
              className="btn-gold grid h-9 w-9 place-items-center rounded-xl"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// ── Loading ───────────────────────────────────────────────────────────────────

function LoadingView() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStep((s) => (s + 1) % LOADING_STEPS.length), 1500);
    return () => clearInterval(id);
  }, []);
  const bar = "rounded-md bg-border/50 animate-pulse";
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <div className="space-y-4">
        <div className={`${bar} h-8 w-3/4`} />
        <div className="flex gap-2">
          <div className={`${bar} h-6 w-28`} />
          <div className={`${bar} h-6 w-20`} />
        </div>
        <div className="space-y-2 pt-4">
          <div className={`${bar} h-4 w-full`} />
          <div className={`${bar} h-4 w-11/12`} />
          <div className={`${bar} h-4 w-10/12`} />
          <div className={`${bar} h-4 w-full`} />
        </div>
        <div className="space-y-2 pt-4">
          <div className={`${bar} h-4 w-11/12`} />
          <div className={`${bar} h-4 w-full`} />
          <div className={`${bar} h-4 w-9/12`} />
        </div>
      </div>
      <div className="mt-10 flex items-center justify-center gap-3">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold/40" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-gold" />
        </span>
        <span className="shimmer-text text-sm font-medium">{LOADING_STEPS[step]}</span>
      </div>
    </div>
  );
}

// ── Workspace ───────────────────────────────────────────────────────────────────

function TrustBadge({ confidence, level }: { confidence: number; level: ConfidenceLevel }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${CONFIDENCE_STYLE[level]}`}
    >
      <ShieldCheck className="h-3.5 w-3.5" />
      Trust Score {Math.round(confidence * 100)}%
      <span className="opacity-70">· {level.toUpperCase()}</span>
    </span>
  );
}

function ParagraphBlock({ p }: { p: ParagraphT }) {
  return (
    <p
      className={`rounded-r-md py-2 pl-4 pr-2 text-[15px] leading-[1.75] ${STATUS_PARA[p.status]}`}
    >
      {p.text}
    </p>
  );
}

function AgentCard({
  comment,
  onReply,
}: {
  comment: AgentComment;
  onReply: (followup: string) => Promise<string>;
}) {
  const [votes, setVotes] = useState(0);
  const [voted, setVoted] = useState(false);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingQ, setPendingQ] = useState<string | null>(null);
  const [thread, setThread] = useState<{ q: string; a: string }[]>([]);

  return (
    <div
      className="card-magical p-4"
      style={{ borderLeftWidth: 3, borderLeftColor: personaColor(comment.role) }}
    >
      <div className="flex items-center gap-2">
        <img
          src={personaAvatar(comment.agent, comment.role)}
          alt={comment.role}
          className="h-9 w-9 rounded-full ring-2 ring-border object-cover"
          style={{ boxShadow: `0 0 8px ${personaColor(comment.role)}40` }}
        />
        <span className="text-sm font-semibold text-foreground">{comment.role}</span>
        {comment.verdict && (
          <span
            className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold ${
              VERDICT_BADGE[comment.verdict] ?? ""
            }`}
          >
            {comment.verdict}
          </span>
        )}
      </div>

      {comment.claim && (
        <p className="mt-2 text-xs italic text-muted">on: "{comment.claim}"</p>
      )}
      <p className="mt-2 text-[14px] leading-[1.65]">{comment.content}</p>

      {comment.url && (
        <a
          href={comment.url}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-factcheck hover:underline"
        >
          <ExternalLink className="h-3 w-3" /> source
        </a>
      )}

      <div className="mt-3 flex items-center gap-3 text-xs text-muted">
        <button
          onClick={() => {
            setVotes((v) => v + (voted ? -1 : 1));
            setVoted((b) => !b);
          }}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 transition ${
            voted ? "border-gold text-gold" : "border-border hover:text-gold"
          }`}
        >
          <ArrowUp className="h-3 w-3" /> {votes}
        </button>
        <button onClick={() => setOpen((o) => !o)} className="hover:text-gold transition">
          Reply
        </button>
      </div>

      {open && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const q = text.trim();
            if (!q || sending) return;
            setText("");
            setPendingQ(q);
            setSending(true);
            try {
              const a = await onReply(q);
              setThread((t) => [...t, { q, a }]);
            } catch {
              setThread((t) => [...t, { q, a: "(failed to get a reply — try again)" }]);
            } finally {
              setPendingQ(null);
              setSending(false);
            }
          }}
          className="mt-3"
        >
          <div className="golden-focus flex items-center gap-2 rounded-lg border border-border bg-surface-raised p-1.5 transition">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={`Ask ${comment.role}…`}
              className="flex-1 bg-transparent px-1.5 text-sm text-foreground outline-none placeholder:text-muted"
            />
            <button
              type="submit"
              disabled={!text.trim() || sending}
              className="btn-gold grid h-7 w-7 place-items-center rounded-md"
            >
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            </button>
          </div>
        </form>
      )}

      {(thread.length > 0 || sending) && (
        <div className="mt-3 space-y-3">
          {thread.map((ex, i) => (
            <div key={i} className="space-y-1.5">
              <div className="ml-auto w-fit max-w-[90%] rounded-lg bg-gold/20 border border-gold/30 px-3 py-2 text-[13px] leading-[1.5] text-foreground">
                {ex.q}
              </div>
              <div className="rounded-lg bg-surface-raised p-3 text-[13px] leading-[1.6]">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gold-dim">
                  Tutor reply
                </span>
                {ex.a}
              </div>
            </div>
          ))}
          {sending && pendingQ && (
            <div className="space-y-1.5">
              <div className="ml-auto w-fit max-w-[90%] rounded-lg bg-gold/20 border border-gold/30 px-3 py-2 text-[13px] leading-[1.5] text-foreground">
                {pendingQ}
              </div>
              <div className="rounded-lg bg-surface-raised px-3 py-2">
                <TypingDots />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function WorkspaceView({
  result,
  onReply,
  onNew,
}: {
  result: BlogPostResult;
  onReply: (comment: AgentComment, followup: string) => Promise<string>;
  onNew: () => void;
}) {
  return (
    <div className="fade-in mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        <TrustBadge confidence={result.confidence} level={result.confidence_level} />
        <button
          onClick={onNew}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 py-1.5 text-sm text-muted transition hover:border-gold/40 hover:text-gold"
        >
          <Plus className="h-4 w-4" /> New question
        </button>
      </div>

      <div className="grid gap-8 lg:grid-cols-[7fr_3fr]">
        {/* Article */}
        <article className="card-magical p-6">
          <h1
            className="mb-5 text-3xl font-bold tracking-tight text-gold"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            {result.answer.title}
          </h1>
          <div className="space-y-2">
            {result.answer.paragraphs.map((p) => (
              <ParagraphBlock key={p.id} p={p} />
            ))}
          </div>
        </article>

        {/* Sidebar */}
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gold-dim font-serif">
            AI Review · {result.comments.length}
          </h2>
          <div className="space-y-3">
            {result.comments.length === 0 && (
              <p className="card-magical p-4 text-sm text-muted">
                No claims were flagged — the reviewers found nothing to contest.
              </p>
            )}
            {result.comments.map((c, i) => (
              <AgentCard key={i} comment={c} onReply={(f) => onReply(c, f)} />
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

// ── Root state machine ───────────────────────────────────────────────────────────

export default function App() {
  const [state, setState] = useState<AppState>("home");
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [thinking, setThinking] = useState(false);
  const [result, setResult] = useState<BlogPostResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runTutor(next: ChatTurn[]) {
    setThinking(true);
    setError(null);
    try {
      const reply = await chat(next);
      setMessages([...next, { role: "assistant", content: reply }]);
    } catch (e) {
      setError(String(e));
    } finally {
      setThinking(false);
    }
  }

  function handleAsk(q: string) {
    const next: ChatTurn[] = [{ role: "user", content: q }];
    setMessages(next);
    setState("chat");
    void runTutor(next);
  }

  function handleSend(text: string) {
    const next: ChatTurn[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    void runTutor(next);
  }

  async function handleConvert() {
    setState("loading");
    setError(null);
    try {
      const r = await convert(messages);
      setResult(r);
      setState("workspace");
    } catch (e) {
      setError(String(e));
      setState("chat");
    }
  }

  function handleNew() {
    setMessages([]);
    setResult(null);
    setError(null);
    setState("home");
  }

  return (
    <div>
      <CursorEffects />
      <TopBar onHome={handleNew} />
      {error && (
        <div className="mx-auto max-w-3xl px-4 pt-4">
          <div className="rounded-lg border border-hallucination/40 bg-hallucination/10 px-4 py-3 text-sm text-hallucination">
            {error}
          </div>
        </div>
      )}
      {state === "home" && <HomeView onAsk={handleAsk} />}
      {state === "chat" && (
        <ChatView
          messages={messages}
          thinking={thinking}
          onSend={handleSend}
          onConvert={handleConvert}
        />
      )}
      {state === "loading" && <LoadingView />}
      {state === "workspace" && result && (
        <WorkspaceView
          result={result}
          onReply={(comment, followup) => replyToComment(comment, followup, messages)}
          onNew={handleNew}
        />
      )}
    </div>
  );
}
