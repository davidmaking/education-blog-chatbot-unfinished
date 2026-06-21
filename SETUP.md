# Setup & Test Guide

Everything needed to get the current build running from scratch. Phases 0–4 are implemented; follow these steps in order.

---

## Step 1 — Python environment

```bash
python3 --version          # must be 3.11+
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

You also need **Node.js 18+** (for the React frontend in `web/`): `node --version`.

---

## Step 2 — API key and spend cap

1. Go to [console.anthropic.com](https://console.anthropic.com) → **API Keys** → create a key.
2. **Set a hard spend cap first:** Console → **Billing** → **Spend Limit** → set to $20.
3. Create your `.env` file:
   ```bash
   cp .env.example .env
   ```
4. Open `.env` and set:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```
   The other variables can stay blank for now — the pipeline runs without Browserbase (the verifier just returns nothing and the pipeline continues).

---

## Step 3 — Run the app

You need **three terminals**, all with the venv active (`source .venv/bin/activate`).

**Terminal 1 — Phoenix (observability dashboard):**
```bash
python3 -c "import phoenix as px; px.launch_app()"
```
Open http://localhost:6006 — you'll see traces appear here as you use the app.

**Terminal 2 — API backend:**
```bash
uvicorn app.api:app --reload --port 8000
```
Confirm it's running: http://localhost:8000/health → `{"status": "ok"}`

**Terminal 3 — React frontend (primary UI):**
```bash
cd web
npm install        # first time only
npm run dev        # http://localhost:5173
```
Vite proxies `/api/*` to the FastAPI backend on :8000 — Terminal 2 must be running first.

Other useful frontend commands (run from `web/`):
```bash
npm run typecheck  # TypeScript check without building
npm run build      # production build → web/dist/
npm run preview    # serve the production build locally
```

> Minimal fallback UI (optional): `streamlit run ui/streamlit_app.py` → http://localhost:8501.

---

## Step 4 — Test the two-phase flow

In the React UI (http://localhost:5173):

1. On the home screen, ask a question, e.g. **"What is the capital of Australia?"** → you enter the **chat** phase.
2. Chat with the tutor. **No fact-checking runs here** — in Phoenix you'll see only `tutor.chat` spans.
3. Click **"Convert to Verifiable Blog Post"** → the **review** runs and you land in the workspace.
4. The post appears with **color-coded paragraphs** (mint = verified, amber = disputed, rose = hallucination) and a sidebar of AI reviewer cards. Reply to a card to ask that agent a follow-up.

**What happens on "Convert":** in Phoenix (http://localhost:6006) you'll see a `blogpost.convert` trace with span attributes for paragraph count, critic count, verifier count, and confidence:
1. Blogger (Sonnet) turns the conversation into structured paragraphs
2. Critics (Haiku, parallel) decompose claims **anchored to each paragraph** and red-team them
3. Verifier checks flagged claims via Browserbase — **skipped if credentials are absent**, which is fine
4. Confidence is computed via multi-sample Haiku calls on contested claims
5. Each paragraph's trust status is derived from its comments' verdicts

> The standalone `python scripts/smoke_flow.py` exercises the same chat → convert → reply flow from the terminal (no UI needed).

---

## Step 5 — Run the eval harness smoke test

This is a standalone script — no need for the API or Streamlit to be running.

**Generate answers for the 5-question smoke set:**
```bash
python3 eval/generate.py --dataset smoke --mode both
```

- Baseline uses the Anthropic Batch API (submitted as one batch, polls every 30s until done — typically 1–3 minutes for 5 questions)
- Pipeline runs `run_pipeline()` sequentially for each question (takes a few minutes)
- Output: `eval/datasets/results_smoke_baseline.jsonl` and `results_smoke_pipeline.jsonl`

**Score and compare:**
```bash
python3 eval/experiment.py --dataset smoke
```

You'll see a table like:
```
────────────────────────────────────────────────────────
  Eval results — smoke set (5 questions)
────────────────────────────────────────────────────────
                        Baseline    Pipeline
  ────────────────────  ──────────  ──────────
  Correct                        3           4
  Partial                        1           1
  Incorrect                      1           0
  ────────────────────  ──────────  ──────────
  Accuracy                      70%         90%
  Avg confidence                  —        0.81
────────────────────────────────────────────────────────
  Delta: +20pp
────────────────────────────────────────────────────────
```
Per-question verdicts saved to `eval/datasets/results_smoke_scored.jsonl`.

> **Cost:** generating the smoke set costs roughly $0.05–0.15 total. Re-running `experiment.py` to re-score is free (no regeneration). The results files are not committed to git, so re-running `generate.py` again would cost again — avoid this unless the pipeline code has changed.

---

## Optional — Add Browserbase (verifier web grounding)

Without Browserbase the pipeline works fine — critics flag suspicious claims but the verifier stage is skipped. To enable web evidence lookup:

1. Sign up at [browserbase.com](https://browserbase.com) and grab your API key and project ID from the dashboard.
2. Add to `.env`:
   ```
   BROWSERBASE_API_KEY=bb_live_...
   BROWSERBASE_PROJECT_ID=prj_...
   MODEL_API_KEY=sk-ant-...    # same value as ANTHROPIC_API_KEY
   ```
3. Restart the API server. The verifier will now run for flagged claims (up to 3 per question).

---

## What's built / what's not yet

| Component | Status |
|---|---|
| Tutoring chat (no checking) + convert-to-blog-post review | ✅ Running |
| Generator → Critics → Verifier → Teacher pipeline (eval path) | ✅ Running |
| Confidence scoring (multi-sample Haiku) | ✅ Running |
| FastAPI backend (POST /chat, /convert, /ask, /reply) | ✅ Running |
| Phoenix OTEL tracing | ✅ Running |
| React SPA (primary UI — blog post + comment thread, reply boxes) | ✅ Running (`web/`) |
| Streamlit UI | ✅ Running (minimal fallback) |
| Eval harness (generate + experiment scripts) | ✅ Ready to run |
| Fetch.ai uAgent wrapper | ✅ Running |

---

## Step 6 — Run the Fetch.ai Agent (Phase 6)

The Sourcerer pipeline can also run as a Fetch.ai Chat Protocol agent, discoverable on ASI:One.

1. Re-install deps (adds `uagents`):
   ```bash
   pip install -r requirements.txt
   ```

2. Set `AGENT_SEED` in `.env` to any stable passphrase (keeps the agent address constant across restarts):
   ```
   AGENT_SEED=my-sourcerer-hackathon-seed
   ```

3. Start Phoenix (Terminal 1, if not already running):
   ```bash
   python3 -c "import phoenix as px; px.launch_app()"
   ```

4. Start the agent (Terminal 2):
   ```bash
   python3 app/agent.py
   ```
   The agent runs on port 8001 (separate from the FastAPI server on 8000). Note the agent address printed at startup.

5. Connect to Agentverse:
   - Go to [agentverse.ai](https://agentverse.ai) and log in
   - Use the "Connect Local Agent" flow with the agent address from step 4
   - Verify the agent appears on your dashboard with the Chat Protocol manifest

6. Test via ASI:One:
   - Go to [asi.one](https://asi.one)
   - Find the Sourcerer agent
   - Send a factual question — you should get a verified answer within 60 seconds

---

## Quick reference — URLs and commands

| What | Where / command |
|---|---|
| React UI (primary) | http://localhost:5173 (`cd web && npm run dev`) |
| Streamlit UI (fallback) | http://localhost:8501 |
| API health | http://localhost:8000/health |
| Phoenix traces | http://localhost:6006 |
| Terminal smoke test of the flow | `python scripts/smoke_flow.py` |
| Generate smoke answers | `python3 eval/generate.py --dataset smoke --mode both` |
| Score smoke answers | `python3 eval/experiment.py --dataset smoke` |
| Regenerate (if pipeline changed) | add `--force` to generate.py |
| Fetch.ai agent | `python3 app/agent.py` (port 8001) |

---

## Environment variable reference

| Variable | Required for | Where to get it |
|---|---|---|
| `ANTHROPIC_API_KEY` | Everything | [console.anthropic.com](https://console.anthropic.com) → API Keys |
| `PHOENIX_API_KEY` | Arize cloud traces (optional) | [app.phoenix.arize.com](https://app.phoenix.arize.com) → Settings → API Keys — omit to use local Phoenix on :6006 |
| `BROWSERBASE_API_KEY` | Verifier (optional) | [browserbase.com](https://browserbase.com) → Dashboard |
| `BROWSERBASE_PROJECT_ID` | Verifier (optional) | Browserbase Dashboard → Projects |
| `MODEL_API_KEY` | Verifier (optional) | Same value as `ANTHROPIC_API_KEY` |
| `AGENT_SEED` | Phase 6 only | Any stable passphrase you choose |
| `AGENTVERSE_API_KEY` | Phase 6 only | [agentverse.ai](https://agentverse.ai) → API Keys |
