# Sourcerer — Judging Overview

> AI tutoring that proves its own answers. Chat with a tutor, then convert the conversation into a fact-checked, source-backed study post reviewed by multiple AI agents.

**Live demo:** [edubot-swart.vercel.app](https://edubot-swart.vercel.app) (frontend) · backend on Render  
**Repo:** github.com/davidmaking/education-blog-chatbot-unfinished

---

## The problem

AI can teach almost anything. It can also hallucinate confidently. Learners — especially beginners — have no way to know when to trust the answer. Every AI chat today is a closed loop with no peer review, no citations, no visible disagreement.

We don't just warn users that AI can be wrong. We show them the receipts.

---

## What it does

**Phase 1 — Study.** The learner chats with an AI tutor. Fast, conversational, no interruptions. Nothing is fact-checked yet.

**Phase 2 — Convert.** The learner clicks "Convert to Verifiable Blog Post." The system:
1. Synthesises the conversation into a structured post (Blogger agent)
2. Decomposes every paragraph into atomic claims (Critics — 3 differentiated roles, parallel)
3. Fetches web evidence for disputed claims (Verifier — Browserbase)
4. Scores confidence from semantic disagreement across multi-sample critic runs
5. Colour-codes each paragraph: **mint = verified · amber = disputed · rose = hallucination**
6. Surfaces every agent's reasoning as a comment card the learner can reply to

The learner sees not just the answer but the argument behind it — and can challenge any agent directly.

---

## Architecture

```
Learner question
  → Tutor agent          fast multi-turn chat (Sonnet) — no checking
  → [Convert clicked]
  → Blogger agent        conversation → structured paragraphs (Sonnet)
  → Critic swarm         3 roles in parallel: Skeptical Fact-Checker, Domain Expert,
                         Devil's Advocate — each decomposes + red-teams claims (Haiku)
  → Verifier agent       Browserbase → DuckDuckGo → Claude extracts verdict + quote + URL (Haiku)
  → Confidence pass      multi-sample semantic disagreement scoring
  → Deliver              BlogPostResult: paragraphs with status + anchored agent comments
```

The same accuracy engine (`_review()`) also powers the `/ask` endpoint used by the eval harness and the Fetch.ai agent — one pipeline, three entry points.

---

## Main tools

### Claude — Anthropic API
Every agent runs on Claude. Model routing follows cost discipline:

| Role | Model |
|---|---|
| Tutor, Blogger, Generator, Teacher, Verifier reasoning | `claude-sonnet-4-6` |
| Critic swarm, eval judges, evidence extraction | `claude-haiku-4-5-20251001` |

Prompt caching is on for all shared system prompts. The eval generation uses the Batch API (50% off). Opus is never in any automated path.

**Built entirely with Claude Code** — every file, every commit in this repo.

### Browserbase
The Verifier opens a Browserbase remote browser session, navigates to DuckDuckGo, extracts page text, and passes it to Claude Haiku for structured evidence extraction (verdict + quote + URL). No local Chromium needed — the browser runs in Browserbase's cloud. Credentials are optional; the pipeline degrades gracefully without them.

### Arize Phoenix
Every pipeline run is traced end-to-end via OpenTelemetry, sent to Arize's hosted Phoenix (`app.phoenix.arize.com`). Three named span types:

- `tutor.chat` — turns, reply length
- `pipeline.run` — draft length, critic count, verifier count, confidence
- `blogpost.convert` — paragraph count, claim-anchored critic/verifier counts, confidence

**Phoenix drove a measurable improvement.** Traces showed the teacher agent was writing long hedged essays (high `answer.length`, low signal-to-noise). We diagnosed the failure, tightened the teacher prompt (direct answer first; only hedge verifier-refuted claims), re-ran the experiment, and the accuracy went up. That's the loop — not just instrumented, used.

### Fetch.ai uAgents
`app/agent.py` wraps the full pipeline as a Chat Protocol agent registered on Agentverse. It runs as a Mailbox agent (full Python deps, not a Hosted agent), is discoverable on ASI:One, and returns the verified answer with confidence score and citations formatted for chat. Claude stays the brain; Fetch.ai is the discoverable entry point.

### Stack
| Layer | Tech |
|---|---|
| Backend | FastAPI, Python 3.11, asyncio |
| Frontend | React 18, Vite 6, Tailwind v4 |
| Hosting | Render (API) · Vercel (frontend) |
| Observability | Arize Phoenix (OTEL, hosted) |
| Agent network | Fetch.ai uAgents + Agentverse |

---

## The number that matters

We built an eval harness (31 questions, hallucination-prone — misattributions, near-cutoff facts, counterintuitive truths) that scores single-model baseline vs. full multi-agent pipeline:

| | Baseline (single Sonnet) | Pipeline |
|---|---|---|
| Correct | 27 / 31 | **28 / 31** |
| Incorrect | 0 | **0** |
| Accuracy | 87% | **90%** |
| Avg confidence | — | 0.73 |

**+3 percentage points.** The pipeline also produces a calibrated confidence signal — correct answers average 0.78 confidence, partials average 0.63. The system knows when it's less sure.

The gain came from the multi-agent critic swarm catching incomplete explanations that a single model passes over. The Phoenix traces are what surfaced the teacher regression that, once fixed, pushed the delta from +2pp to +3pp with zero incorrect answers.

---

## Prize alignment

**Anthropic** — Built with Claude Code from first commit to last. Claude models power every agent. The problem is education; the thesis is that hallucination is an education problem, not just a safety one.

**Browserbase** — The Verifier is powered by Browserbase. Every disputed claim is grounded with a live web search via a Browserbase remote session. The app doesn't work without it in a meaningful way.

**Arize** — Phoenix traces a real multi-agent system in production. We used the traces to diagnose a specific failure in the teacher agent, fixed it, and re-ran the experiment. Before: +2pp, 1 incorrect. After: +3pp, 0 incorrect. The dashboard is live at `app.phoenix.arize.com/s/dalucas-1492`.

**Fetch.ai** — `app/agent.py` implements the Chat Protocol. The agent is registered on Agentverse as a Mailbox agent, discoverable on ASI:One, with a published manifest. Claude answers; Fetch.ai makes it findable by other agents.

---

## Demo path (2 minutes)

1. Open the live app → ask *"How do vaccines work?"*
2. Chat two turns with the tutor
3. Click **Convert to Verifiable Blog Post** — watch the loading steps
4. Show the colour-coded workspace: mint paragraphs (verified), any amber/rose (disputed/hallucination)
5. Click **Reply** on an agent card — ask a follow-up from that agent's perspective
6. Open Arize Phoenix — show the `blogpost.convert` trace tree with paragraph count, critic verdicts, and confidence score
7. Show the eval table: 87% baseline → 90% pipeline

---

## Repo layout

```
app/
  agents/         tutor, blogger, generator, critics, verifier, teacher
  grounding/      Browserbase + DuckDuckGo evidence fetching
  pipeline.py     chat(), convert_to_blog_post(), run_pipeline()
  api.py          FastAPI: /chat /convert /ask /reply
  agent.py        Fetch.ai uAgent Chat Protocol wrapper
  confidence.py   multi-sample semantic disagreement scoring
  telemetry.py    Phoenix OTEL registration
eval/
  datasets/       qa_30.jsonl, qa_smoke.jsonl (hallucination-prone questions)
  generate.py     Batch API generation
  experiment.py   baseline vs pipeline scoring (Haiku judges)
web/              React + Vite + Tailwind frontend
render.yaml       one-click Render deployment
```
