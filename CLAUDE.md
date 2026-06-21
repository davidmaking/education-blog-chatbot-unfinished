# CLAUDE.md — Sourcerer

> Working title: **Sourcerer** (sourceless UX, self-sourcing engine). Rename freely.
> This file is auto-loaded by Claude Code as persistent project context. Keep it current.

## What we're building

An **AI tutor that reduces LLM hallucination and teaches the learner to evaluate claims**. Think
"NotebookLM without the user uploading sources" — the *user experience* is sourceless, but the
*system* fetches and checks its own evidence behind the scenes. Built for the AI Hackathon 2026.
Optionally exposed as a discoverable agent on Fetch.ai's ASI:One network (see Phase 6).

Three things make this more than a chatbot wrapper, and they must stay front-and-center:

1. **A measured accuracy gain.** We prove, with numbers, that the multi-agent + grounding pipeline
   beats a single model call on factuality.
2. **Confidence transparency as pedagogy.** Every answer is shaded by confidence and backed by
   citations the system found itself. Teaching a learner *what to distrust* is the product.
3. **Agents as collaborators, not black boxes.** The multi-agent deliberation is surfaced to the
   learner as a **blog post with comments**: the Teacher's final answer is the post; each agent
   (Generator draft, Critics with their roles, Verifier with citations) contributes a visible
   comment. The learner can **reply to any comment** to ask a follow-up question — that reply
   carries the commenting agent's context back into the pipeline, enabling targeted, collaborative
   learning from each agent's perspective.

### The core design decision (do not relitigate)
We are **grounded, not pure-model**. A frontier model alone has a low ceiling on *factual* accuracy
because multiple instances share the same wrong priors (correlated errors). So:\
\
- Multi-agent debate handles **reasoning** errors.
- **Web grounding** (Browserbase) handles **factual** errors.
- **Uncertainty estimation** (multi-sample) handles **overconfidence** — flagging, not always fixing.

## Architecture: a 6-stage agent pipeline

```
Learner question
  → Generator agent      drafts a first answer (Sonnet)
  → Critic agents        decompose into atomic claims, red-team each (Haiku, run in parallel)
  → Verifier agent       fetch web evidence per flagged claim via Browserbase/Stagehand (Sonnet)
  → Confidence pass      multi-sample contested claims; semantic disagreement = low confidence
  → Teacher agent        synthesize, drop/hedge unsupported claims, adapt to mode (Sonnet)
  → Deliver              answer + confidence shading + study artifacts
```

- Orchestrate with `asyncio`; the critic swarm runs concurrently (faster + literally multi-agent).
- Give critics **differentiated roles** (skeptical fact-checker, domain expert, etc.) so their
  errors de-correlate instead of echoing.
- The verifier's retrieved evidence **is** the grounding context that the hallucination eval checks
  the final answer against. Keep it attached to each claim.
- Teacher modes: **explain** (confidence-shaded), **quiz** (claims → questions), **Socratic**
  (withhold the answer, ask leading questions). Flashcards/concept map fall out of the claim set.
### Two-phase UX: study first, check on demand (current flow)

The verification pipeline above does **not** run while the learner is studying. The product splits
into two phases:

1. **Tutoring phase (no checking).** The learner chats with the AI tutor turn by turn. Nothing is
   fact-checked, grounded, or critiqued during this — it's a fast, plain teaching conversation.
   Entry point: `chat(messages: list[ChatTurn]) -> str`.
2. **Conversion phase (checking runs here).** When the learner clicks **"Convert to verifiable blog
   post"**, the system synthesizes the conversation so far into a structured blog post and *then*
   deploys the critic swarm + verifier + confidence pass over **that post**. The critique stays
   visible as comments on the published post (it is *not* silently rewritten by a Teacher).
   Entry point: `convert_to_blog_post(messages: list[ChatTurn]) -> PipelineResult` (`.title` = post
   title, `.answer` = post body, `.comments` = the agent review).

The 6-stage diagram above is the **accuracy engine**, shared by the conversion phase and by
`run_pipeline` (the single-question path used by the eval harness + `POST /ask`). The shared
critique→verify→confidence steps live in `pipeline._review(text, topic)`.

`reply_to_comment(comment: AgentComment, followup: str, messages=None) -> str` handles follow-up
questions on individual agent comments. It re-enters the **tutoring conversation** (via `chat`) with
the commenting agent's context injected — so the learner keeps studying from that agent's
perspective, and can later re-convert the enriched conversation into an updated post.

## Current implementation state (as of Phase 4 completion + two-phase UX split)

| Component | Status | Notes |
|---|---|---|
| `app/models.py` | ✅ Done | `ChatTurn` + `AgentComment` + `PipelineResult` (now with `.title`) |
| `app/pipeline.py` | ✅ Done | `chat()`, `convert_to_blog_post()`, `run_pipeline()`, `reply_to_comment()`; shared `_review()` |
| `app/api.py` | ✅ Done | POST /chat, POST /convert, POST /ask, POST /reply, GET /health |
| `app/telemetry.py` | ✅ Done | Phoenix auto-instrument |
| `app/agents/tutor.py` | ✅ Done | Sonnet, multi-turn tutoring chat — NO checking (study phase) |
| `app/agents/blogger.py` | ✅ Done | Sonnet, conversation → structured blog post (title + body) |
| `app/agents/generator.py` | ✅ Done | Sonnet, prompt caching (used by `run_pipeline`) |
| `app/agents/teacher.py` | ✅ Done | Sonnet, prompt caching (used by `run_pipeline`) |
| `app/agents/critics.py` | ✅ Done | Haiku, parallel role-differentiated critic swarm |
| `app/agents/verifier.py` | ✅ Done | Stagehand/Browserbase evidence extraction (capped at 3 claims) |
| `app/grounding/browser.py` | ✅ Done | Browserbase client helpers |
| `app/confidence.py` | ✅ Done | Multi-sample semantic-disagreement scoring |
| `eval/` | ✅ Done | datasets (qa_30, qa_smoke), generate.py (Batch API), experiment.py |
| `ui/streamlit_app.py` | ✅ Done | Two-phase: chat thread + "Convert to verifiable blog post" → reviewed post |
| `app/agent.py` | ❌ Phase 6 | Fetch.ai uAgent wrapper (optional) |

**Currently on:** Phase 5 (education polish — teacher modes, confidence shading, reply boxes) /
optional Phase 6 (Fetch.ai). Core accuracy engine + eval harness are done.

### Blog-post-comments data model

Models are implemented as Pydantic `BaseModel` (not dataclasses) in `app/models.py`.

```python
from pydantic import BaseModel

class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]   # the study conversation (tutoring phase)
    content: str

class AgentComment(BaseModel):
    agent: Literal["generator", "critic", "verifier"]
    role: str            # e.g. "Skeptical Fact-Checker", "Domain Expert", "Verifier"
    content: str         # the agent's contribution text
    claim: str | None    # the specific claim this comment is about (critics + verifier)
    verdict: Literal["supports", "refutes", "unclear"] | None  # verifier only
    url: str | None      # verifier citation

class PipelineResult(BaseModel):
    answer: str                   # synthesized artifact — final answer OR blog post body
    comments: list[AgentComment]  # all agent contributions — the "comments"
    confidence: float             # 0.0–1.0
    confidence_level: Literal["high", "medium", "low"]
    title: str | None = None      # set when the artifact is a blog post
```

`convert_to_blog_post` and `run_pipeline` both return a `PipelineResult` (the conversion sets
`.title`). `chat` and `reply_to_comment` return plain reply strings for the tutoring phase.
The Streamlit UI renders the conversation as a chat thread and the converted result as a blog post +
comment thread. The Fetch.ai handler returns only `.answer` (plain text for ASI:One chat).

## Stack (verified June 2026 — confirm exact API surfaces against the linked docs before coding)

- **Language/runtime:** Python 3.11+, `asyncio`.
- **Backend:** FastAPI.
- **Frontend:** Streamlit (default, fastest path). A React app is optional and only worth it for the
  Best UI/UX prize — don't start there. (For the Fetch.ai track, ASI:One chat *is* the frontend.)
- **Model:** Claude via the Anthropic API. Build the whole thing **with Claude Code** (required for
  the Anthropic prize).
- **Grounding:** Stagehand Python SDK (`stagehand-py`) on Browserbase cloud browsers.
- **Observability + eval:** Arize Phoenix (`arize-phoenix`, self-hosted locally = free).
- **Agent exposure (optional, Phase 6):** Fetch.ai uAgents (`uagents`) — wraps the tutor as a
  Chat-Protocol agent on Agentverse/ASI:One. This is an entry/orchestration layer only; **Claude
  stays the model** and the pipeline does not change.

### Model routing (strict — see cost rules)
| Role | Model string | Why |
|---|---|---|
| Critic swarm, eval judges | `claude-haiku-4-5-20251001` | cheap, high-volume |
| Generator, verifier reasoning, teacher/synthesis | `claude-sonnet-4-6` | the workhorse, default everywhere |
| Hard synthesis only, **demo-time only** | `claude-opus-4-8` | **NEVER in dev or eval loops** — 5x output cost |

### Key docs to fetch for current specifics
- Anthropic API + prompt caching + Batch API: https://docs.claude.com/en/api/overview
- Claude Code: https://docs.claude.com/en/docs/claude-code/overview
- Stagehand: https://docs.stagehand.dev  ·  https://pypi.org/project/stagehand-py/
- Browserbase: https://docs.browserbase.com  ·  pricing: https://www.browserbase.com/pricing
- Phoenix tracing + evals: https://arize.com/docs/phoenix
- Fetch.ai uAgents + Chat Protocol: https://uagents.fetch.ai/docs  ·  Agentverse: https://docs.agentverse.ai
- Fetch.ai Innovation Lab (hackathon resources, Anthropic-in-uAgents guide): https://innovationlab.fetch.ai

## Cost rules (HARD — total token budget is $20)

The platforms are free (Phoenix self-hosted, Browserbase free tier, Stagehand open-source, uAgents
open-source). The **only** spend is Claude tokens, and the **only** thing that can blow the budget is
repeated full-pipeline eval runs. The Fetch.ai wrapper adds ~$0 — it just routes a chat message into
`run_pipeline`, so token spend is unchanged. Obey all of these:

1. **Decouple generation from scoring.** Generating eval answers (6 agents) is expensive and only
   needs redoing when the pipeline changes. Scoring (judges) is cheap. **Generate eval answers once,
   store them as a Phoenix dataset, and re-run judges over stored answers** as often as needed.
2. **Batch the generation runs.** Eval generation is not latency-sensitive → use the **Batch API**
   (50% off). Never run a full eval set synchronously.
3. **Prompt caching on** for the shared system prompts and the repeated retrieved context. Cache
   reads are ~10% of input price; this matters a lot for a multi-agent pipeline.
4. **Eval set = 30 questions.** Keep a **5-question smoke set** for constant iteration (cents/run).
   Only run the full 30 at milestones.
5. **No Opus in any automated or eval path.** Sonnet for all synthesis during dev. Opus only on a
   couple of hard questions, live, at the very end, if Sonnet looks weak.
6. **Verifier is the silent token hog** — fetched page text goes into the prompt. `extract` **narrow
   fields**, and trim what the model sees. Prefer Browserbase **Search + Fetch APIs** over spinning
   full browser sessions where possible (faster, cheaper, lighter on the free browser-hour).
7. **Set a hard spend cap in the Anthropic Console.** Prepaid + cap = cannot overspend.

Rough allocation: ~$6 build + smoke set · ~$8 for 4–5 milestone experiments on 30 Qs · ~$6 buffer.

## Fetch.ai exposure (HARD constraints — read before building the agent wrapper)

The Fetch.ai prize is satisfied by **registering the tutor on Agentverse, implementing the Chat
Protocol (mandatory), and demoing through ASI:One** — not by rebuilding the pipeline in their
framework. Their hackathon track explicitly allows any framework (Claude SDK / plain Python) and
needs no custom frontend. Rules to build against:

- **Run as a Mailbox agent locally or on a VM — NOT an Agentverse Hosted agent.** Hosted agents only
  allow the Python stdlib plus a small allowlist; our deps (`anthropic`, `stagehand`,
  `arize-phoenix`) won't run there. A Mailbox agent keeps full deps and is still reachable from
  ASI:One.
- **Monolith wrapper, one agent.** Do **not** split the pipeline into networked agents — it breaks
  the single clean Phoenix trace and is not needed to qualify. (If you later split the verifier into
  its own Agentverse agent for a "multi-agent on Fetch" flex, you must propagate trace context across
  the message. Only do this with hours to spare.)
- **Claude stays the brain.** ASI:One is the *caller* (chat interface/orchestrator), not our model.
  No ASI:One key is needed for our pipeline.
- **Keep the handler fast.** A chat handler that hangs for a minute can time out on the ASI:One side.
  Cap the verifier to ~3 flagged claims and pre-warm the demo topic.
- **VERIFY in current docs** (names drift): exact `Agent(mailbox=...)` config, the
  `ChatAcknowledgement` field name, and the registration/funding step (Agentverse abstracts the
  Almanac; use the testnet faucet for any FET — no real money for the hackathon). Follow the
  first-party "Anthropic + uAgents" SDK guide for the Claude wiring.
- **Judging framing:** a verified-tutoring domain-expert agent, discoverable on ASI:One, that other
  agents can call for fact-checked educational answers. Do not claim decentralization or payments
  improve the tutor — they don't, and judges will notice.
- **Confirm the Berkeley live-site criteria when posted.** The hacker guide listed Fetch.ai as
  "coming soon"; the above is Fetch.ai's standard hackathon pattern and the safe assumption.

## Repo layout

Files marked ✅ exist; others are planned.

```
app/
  agents/
    tutor.py            ✅ multi-turn tutoring chat (NO checking) → reply string
    blogger.py          ✅ conversation → structured blog post (title, body)
    generator.py        ✅ draft answer → AgentComment(agent="generator") [run_pipeline path]
    teacher.py          ✅ synthesize, hedge, mode-switch → final answer string [run_pipeline path]
    critics.py          ✅ decompose + role-differentiated red-team (parallel) → list[AgentComment]
    verifier.py         ✅ Stagehand evidence extraction per claim → list[AgentComment] with urls
  models.py             ✅ ChatTurn + AgentComment + PipelineResult Pydantic models
  pipeline.py           ✅ asyncio orchestration; chat(), convert_to_blog_post(), run_pipeline(), reply_to_comment(); shared _review()
  api.py                ✅ FastAPI: POST /chat, /convert, /ask, /reply, GET /health
  telemetry.py          ✅ Phoenix register() at import time
  confidence.py         ✅ multi-sample + semantic-disagreement scoring → (float, level)
  grounding/
    browser.py          ✅ Stagehand/Browserbase client; Search+Fetch helpers
  agent.py              ← Phase 6: Fetch.ai uAgent Chat Protocol wrapper (returns result.answer)
eval/
  datasets/             ✅ directory exists
    qa_30.jsonl         ✅ 30 questions w/ known answers
    qa_smoke.jsonl      ✅ 5-question smoke set
  generate.py           ✅ batch-generate pipeline answers -> result files
  experiment.py         ✅ baseline (single Sonnet call) vs full pipeline; Haiku judges
ui/
  streamlit_app.py      ✅ two-phase: chat thread + "Convert to verifiable blog post" → reviewed post
.env.example            ✅
requirements.txt        ✅
README.md               ✅ (judging writeup — keep current)
```

## Environment variables (`.env.example`)

```
ANTHROPIC_API_KEY=         # the app's agents + judges
BROWSERBASE_API_KEY=
BROWSERBASE_PROJECT_ID=
MODEL_API_KEY=             # Stagehand's own reasoning model — set to the Anthropic key (Claude)
# Phoenix runs locally by default; no key needed for self-hosted px.launch_app()

# Fetch.ai — only if doing Phase 6
AGENT_SEED=                # stable seed phrase so the agent keeps one address across restarts
AGENTVERSE_API_KEY=        # for Mailbox connection / registration — verify exact var in docs
# ASI:One is the CALLER (chat UI), not our model — no ASI:One key needed for the pipeline
```

## Integration patterns (starting points — verify against current docs)

**Phoenix tracing** — call once at startup so every Claude call is auto-traced into one project:
```python
# app/telemetry.py
from phoenix.otel import register
register(project_name="sourcerer", auto_instrument=True)
```
Wrap each pipeline run in a single parent span so the 6 agents show as one trace tree (this is the
debugging X-ray for *which agent introduced a bad claim*).

**Verifier extraction** — narrow Pydantic schema, never dump whole pages:
```python
from pydantic import BaseModel
from typing import Literal

class Evidence(BaseModel):
    verdict: Literal["supports", "refutes", "unclear"]
    quote: str   # short
    url: str

result = await stagehand.page.extract(
    "evidence about whether this claim is true", schema=Evidence
)
```

**Evals** — Phoenix's built-ins map onto the pipeline: a relevance check (did the verifier fetch
relevant evidence), a hallucination check (is the final answer grounded in the retrieved evidence),
and a Q&A-correctness check (is it right vs the known answer). Judge with Haiku.
> NOTE: `phoenix.evals` has two API generations (`HallucinationEvaluator`/`run_evals` vs
> `create_classifier`/`evaluate_dataframe`). Check the installed version's docs before writing the
> call — do not hardcode from memory.

**Fetch.ai agent wrapper (Phase 6)** — the whole pipeline behind one Chat-Protocol handler. Run this
as a Mailbox agent (full deps), not a Hosted agent:
```python
# app/agent.py
from datetime import datetime
from uuid import uuid4
from uagents import Agent, Protocol, Context
from uagents_core.contrib.protocols.chat import (
    ChatAcknowledgement, ChatMessage, TextContent, EndSessionContent, chat_protocol_spec,
)
from app.pipeline import run_pipeline

agent = Agent(name="sourcerer", mailbox=True)   # VERIFY exact mailbox config in current docs
chat = Protocol(spec=chat_protocol_spec)

def reply(text: str, end: bool = False) -> ChatMessage:
    content = [TextContent(type="text", text=text)]
    if end:
        content.append(EndSessionContent(type="end-session"))
    return ChatMessage(timestamp=datetime.utcnow(), msg_id=uuid4(), content=content)

@chat.on_message(ChatMessage)
async def handle(ctx: Context, sender: str, msg: ChatMessage):
    await ctx.send(sender, ChatAcknowledgement(
        timestamp=datetime.utcnow(), acknowledged_msg_id=msg.msg_id))
    question = " ".join(i.text for i in msg.content if isinstance(i, TextContent))
    answer = await run_pipeline(question)        # generator→critics→verifier→teacher, unchanged
    await ctx.send(sender, reply(answer, end=True))

agent.include(chat, publish_manifest=True)       # registers manifest for ASI:One discovery
if __name__ == "__main__":
    agent.run()
```

## Build plan (phased — ship something demoable at every step)

- **Phase 0 — Setup.** ✅ DONE. Repo, `.env`, deps, Phoenix running locally.
- **Phase 1 — Spine.** ✅ DONE. Generator → Teacher, `run_pipeline()` + `reply_to_comment()`,
  FastAPI routes (POST /ask, POST /reply), Streamlit skeleton, Phoenix tracing. Models use Pydantic
  `BaseModel`. Confidence is stubbed at 1.0/"high" — to be replaced in Phase 3.
- **Phase 1.5 — Two-phase UX split.** ✅ DONE. Separated the un-checked tutoring conversation
  (`chat()`, `POST /chat`) from the on-demand review (`convert_to_blog_post()`, `POST /convert`):
  checking now runs only when the learner converts the conversation into a blog post. `reply_to_comment`
  re-enters the conversation (via `chat`), not the full pipeline. Added `app/agents/tutor.py` +
  `app/agents/blogger.py`; Streamlit rewritten to chat + convert.
- **Phase 2 — Accuracy engine.** ✅ DONE. Parallel critic decomposition + the Browserbase verifier.
  This is where "reduces inaccuracies" becomes true. **Time-box the verifier**; if latency is bad,
  fall back to a single `extract` over one search-results page instead of multi-hop browsing.
- **Phase 3 — Confidence.** ✅ DONE. Multi-sample contested claims; semantic disagreement = low confidence.
  Cheap, and the most impressive-looking part of the demo.
- **Phase 4 — Proof.** ✅ DONE (harness built; run the milestone experiments to capture numbers).
  Eval harness: batch-generate answers once, run the baseline-vs-pipeline **experiment**.
  **This number is what wins the room.**
- **Phase 5 — Education polish.** ← CURRENT. Blog-post-comments UI is in place (post + comment cards
  with role badge, claim, verdict/citation). Still to add: a reply box under each comment that calls
  `reply_to_comment(comment, followup, messages)` (returns a tutor reply that continues the
  conversation), teacher modes (quiz, Socratic), and richer confidence shading.
- **Phase 6 — Fetch.ai exposure (optional, last, 2–3h time-box).** Wrap `run_pipeline` as the
  Chat-Protocol uAgent in `app/agent.py`, run it as a **Mailbox agent**, register on Agentverse, and
  confirm a full **ASI:One round-trip** (type a question in ASI:One → agent answers). See the Fetch.ai
  constraints section. Test the round-trip well before demo time — the Mailbox is a live dependency.

**Fallbacks.** If Browserbase is fighting you at the halfway mark: ship Generator → Critics → Teacher
with Phoenix proving the **critic stage alone** beats baseline — still a real, measured result. If the
clock is tight at Phase 6: the monolith wrapper alone qualifies for Fetch.ai, and ASI:One chat can be
the demo surface for that track so you can skip building UI for it.

## Prize requirements (these shape the build — don't drift from them)

- **Anthropic:** built with Claude Code, Claude models, an education problem. Frame the README as the
  biggest swing you can take at hallucination — aspiration and effort are explicitly weighted.
- **Browserbase:** a web-using agent **powered by Browserbase**, via **Stagehand** (a qualifying
  harness). Satisfied by construction once the verifier exists.
- **Arize:** evidence that Arize was **used and actually improved the app** — not just instrumented.
  The win narrative: a trace surfaces a failure (verifier grabbing junk pages, teacher dropping a
  hedge) → you fix it → re-run the experiment → the number moves. Capture **before/after**.
- **Fetch.ai (co-host, $1500 / $1000 / $500):** a registered Chat-Protocol agent on Agentverse,
  demoed through ASI:One, with Claude as the brain. Satisfied by Phase 6. Confirm the Berkeley
  live-site criteria when posted.

These four stack — they don't compete. Claude is the model + build tool, Browserbase is the verifier's
web access, Arize proves the gain, Fetch.ai is the discoverable entry point. None changes the model.

## Working conventions for Claude Code

- Prefer small, focused functions and editing over wholesale rewrites.
- **Surfaces are thin entry points over `app/pipeline.py`** — every UI/route calls `chat()`,
  `convert_to_blog_post()`, `run_pipeline()`, or `reply_to_comment()`; none reimplement orchestration.
  The accuracy engine lives once in `_review()` and is shared by the conversion path and `run_pipeline`.
  Don't fork pipeline logic per surface.
- **Build the eval harness early** (Phase 4 scaffolding by end of Phase 2) — it's the deliverable.
- **Respect the cost rules above without being asked.** Never add Opus to a loop. Never run a full
  eval synchronously. Always cache shared prompts.
- **Ask before adding any new SDK or sponsor dependency** — every one is a 3am failure risk and a
  slice of demo time.
- Keep the demo path snappy: pre-warm the demo topic, lean on Stagehand's auto-caching, cap the
  verifier to ~3 flagged claims per question.
- For Fetch.ai: Mailbox agent only (not Hosted), monolith wrapper only, keep the handler fast.

## Definition of done (demo checklist)

- [x] Study with the tutor (no checking) → click "Convert to verifiable blog post" → reviewed post with confidence shading + system-found citations. *(`chat()` + `convert_to_blog_post()` done)*
- [x] Result is presented as a blog post; agent contributions appear as comment cards. *(Streamlit done; reply boxes pending — Phase 5)*
- [ ] Reply to any agent comment → follow-up generated with that agent's context. *(`reply_to_comment()` done; needs reply-box wiring in the UI — Phase 5)*
- [ ] One Phoenix experiment slide: single-model baseline vs full pipeline, factuality delta. *(harness done; run the experiment to capture the number)*
- [ ] At least one teacher mode beyond plain explain (quiz or Socratic). *(Phase 5)*
- [x] README exists. *(needs accuracy-gain framing once eval numbers are in)*
- [ ] (If Phase 6) Tutor registered on Agentverse and answers end-to-end via ASI:One chat.

> **AI made learning faster. Now we need to make it trustworthy.**

AI study platform where a learner chats with an AI tutor, turns that learning conversation into a blog-style study post, and then watches AI agents and humans critique, fact-check, debate, and improve the post.

Instead of trusting one confident AI answer blindly, learners can see the answer challenged, grounded with browser evidence, annotated with confidence, and discussed by multiple AI personas.

---

## One-Line Pitch

**TrustStudy turns AI tutoring conversations into reviewed study posts that can be critiqued, fact-checked, debated, and improved by other AIs and humans.**

---

## The Problem

AI can teach almost anything quickly.

But AI can also hallucinate.

That creates a major learning problem:

- AI answers often sound confident even when they are wrong.
- Beginners may not know enough to detect mistakes.
- Private AI chats usually have no comments, no peer review, no visible disagreement, and no correction layer.
- Unlike YouTube, Reddit, blogs, or classrooms, AI learning often lacks social validation.

The danger is not only that AI can be wrong.

The danger is that it can sound right.

---

## The Insight

People do not only trust knowledge.

They trust the process behind the knowledge.

A YouTube video, blog post, or forum answer often feels more trustworthy because other people can:

- comment
- disagree
- correct mistakes
- add context
- ask follow-up questions
- challenge assumptions

AI chat today is usually isolated.

TrustStudy adds that missing trust layer.

---

## The Solution

TrustStudy lets a user:

1. Chat with an AI tutor.
2. Learn a topic step by step.
3. Turn that chat into a structured blog-style study post.
4. Send the post to AI reviewer agents.
5. Browser-ground disputed claims.
6. Show citations, uncertainty, and confidence.
7. Let humans comment and reply.
8. Produce a final consensus summary.

The result is a learning artifact that is:

- visible
- reviewable
- debatable
- source-aware
- confidence-shaded
- socially validated
- improvable over time

---

## Core Demo Flow

```text
Learner asks a question
    ↓
AI tutor teaches through chat
    ↓
Learner clicks “Turn chat into post”
    ↓
System creates a structured study post
    ↓
AI reviewers critique exact paragraphs
    ↓
Browser verifier checks disputed claims
    ↓
Confidence score and citations are added
    ↓
Humans can comment and reply
    ↓
Consensus AI summarizes what to trust
