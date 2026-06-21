#!/usr/bin/env python3
"""
Score pre-generated answers and compare baseline vs full pipeline accuracy.

Run generate.py first to produce the input files.

Usage:
  python eval/experiment.py --dataset smoke
  python eval/experiment.py --dataset full

Output:
  Comparison table printed to stdout
  eval/datasets/results_{dataset}_scored.jsonl  (per-question verdicts)
"""

import argparse
import asyncio
import json
import os
import sys

from dotenv import load_dotenv
load_dotenv()  # must run before app.telemetry so PHOENIX_* vars are present at register() time

import anthropic

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import app.telemetry  # noqa: F401 — Phoenix auto-traces all Haiku judge calls
from opentelemetry import trace

_tracer = trace.get_tracer("sourcerer.eval")

DATASETS_DIR = os.path.join(os.path.dirname(__file__), "datasets")

JUDGE_SYSTEM = (
    "You are a strict factual accuracy judge. "
    "Given a question, a reference answer, and a candidate answer, "
    "respond with exactly one word: 'correct', 'partial', or 'incorrect'.\n"
    "- correct: the candidate captures the key fact(s) from the reference\n"
    "- partial: the candidate is partially right but missing key details or has minor errors\n"
    "- incorrect: the candidate contradicts or omits the key fact(s) in the reference"
)


def _results_path(dataset: str, mode: str) -> str:
    return os.path.join(DATASETS_DIR, f"results_{dataset}_{mode}.jsonl")


def _load(path: str) -> list[dict]:
    with open(path) as f:
        return [json.loads(line) for line in f if line.strip()]


# ── Haiku judges (run in parallel) ───────────────────────────────────────────

_VERDICT_SCORE = {"correct": 1.0, "partial": 0.5, "incorrect": 0.0}


async def _judge_one(
    client: anthropic.AsyncAnthropic,
    question: str,
    reference: str,
    answer: str,
) -> str:
    response = await client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=5,
        system=[{"type": "text", "text": JUDGE_SYSTEM, "cache_control": {"type": "ephemeral"}}],
        messages=[{
            "role": "user",
            "content": f"Question: {question}\nReference: {reference}\nCandidate: {answer}",
        }],
    )
    raw = response.content[0].text.strip().lower()
    if "incorrect" in raw:
        return "incorrect"
    if "partial" in raw:
        return "partial"
    return "correct"


async def _judge_pair(
    client: anthropic.AsyncAnthropic,
    b_row: dict,
    p_row: dict,
) -> tuple[str, str]:
    """Judge one question pair and emit a Phoenix span with both verdicts."""
    question = b_row["question"]
    reference = b_row["reference_answer"]
    b_verdict, p_verdict = await asyncio.gather(
        _judge_one(client, question, reference, b_row["answer"]),
        _judge_one(client, question, reference, p_row["answer"]),
    )
    with _tracer.start_as_current_span("eval.question") as span:
        span.set_attribute("eval.question", question[:300])
        span.set_attribute("eval.baseline_verdict", b_verdict)
        span.set_attribute("eval.baseline_score", _VERDICT_SCORE[b_verdict])
        span.set_attribute("eval.pipeline_verdict", p_verdict)
        span.set_attribute("eval.pipeline_score", _VERDICT_SCORE[p_verdict])
        span.set_attribute("eval.pipeline_confidence", p_row.get("confidence") or 0.0)
        span.set_attribute("eval.delta", _VERDICT_SCORE[p_verdict] - _VERDICT_SCORE[b_verdict])
    return b_verdict, p_verdict


async def _score_all(baseline_rows: list[dict], pipeline_rows: list[dict]) -> tuple[list[str], list[str]]:
    client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
    pairs = await asyncio.gather(*[
        _judge_pair(client, b, p) for b, p in zip(baseline_rows, pipeline_rows)
    ])
    b_verdicts = [pair[0] for pair in pairs]
    p_verdicts = [pair[1] for pair in pairs]
    return b_verdicts, p_verdicts


# ── Metrics + display ─────────────────────────────────────────────────────────

def _accuracy(verdicts: list[str]) -> float:
    if not verdicts:
        return 0.0
    score = sum(1.0 if v == "correct" else 0.5 if v == "partial" else 0.0 for v in verdicts)
    return score / len(verdicts)


def _print_table(
    dataset: str,
    pipeline_rows: list[dict],
    b_verdicts: list[str],
    p_verdicts: list[str],
) -> None:
    n = len(b_verdicts)
    b = {v: b_verdicts.count(v) for v in ("correct", "partial", "incorrect")}
    p = {v: p_verdicts.count(v) for v in ("correct", "partial", "incorrect")}
    b_acc = _accuracy(b_verdicts)
    p_acc = _accuracy(p_verdicts)
    delta = p_acc - b_acc
    avg_conf = sum(r.get("confidence", 0.0) for r in pipeline_rows) / max(len(pipeline_rows), 1)
    delta_str = f"+{delta * 100:.0f}pp" if delta >= 0 else f"{delta * 100:.0f}pp"

    print(f"\n{'─' * 56}")
    print(f"  Eval results — {dataset} set ({n} questions)")
    print(f"{'─' * 56}")
    print(f"  {'':20s}  {'Baseline':>10}  {'Pipeline':>10}")
    print(f"  {'─' * 20}  {'─' * 10}  {'─' * 10}")
    print(f"  {'Correct':20s}  {b['correct']:>10}  {p['correct']:>10}")
    print(f"  {'Partial':20s}  {b['partial']:>10}  {p['partial']:>10}")
    print(f"  {'Incorrect':20s}  {b['incorrect']:>10}  {p['incorrect']:>10}")
    print(f"  {'─' * 20}  {'─' * 10}  {'─' * 10}")
    print(f"  {'Accuracy':20s}  {b_acc * 100:>9.0f}%  {p_acc * 100:>9.0f}%")
    print(f"  {'Avg confidence':20s}  {'—':>10}  {avg_conf:>10.2f}")
    print(f"{'─' * 56}")
    print(f"  Delta: {delta_str}")
    print(f"{'─' * 56}\n")


def _save_scored(
    dataset: str,
    baseline_rows: list[dict],
    pipeline_rows: list[dict],
    b_verdicts: list[str],
    p_verdicts: list[str],
) -> None:
    out_path = _results_path(dataset, "scored")
    with open(out_path, "w") as f:
        for b_row, p_row, bv, pv in zip(baseline_rows, pipeline_rows, b_verdicts, p_verdicts):
            f.write(json.dumps({
                "question": b_row["question"],
                "reference_answer": b_row["reference_answer"],
                "baseline_answer": b_row["answer"],
                "baseline_verdict": bv,
                "pipeline_answer": p_row["answer"],
                "pipeline_verdict": pv,
                "pipeline_confidence": p_row.get("confidence"),
                "pipeline_confidence_level": p_row.get("confidence_level"),
            }) + "\n")
    print(f"Per-question verdicts → {out_path}")


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dataset", choices=["smoke", "full"], default="smoke")
    args = parser.parse_args()

    b_path = _results_path(args.dataset, "baseline")
    p_path = _results_path(args.dataset, "pipeline")

    for path in (b_path, p_path):
        if not os.path.exists(path):
            sys.exit(f"Missing: {path}\nRun: python eval/generate.py --dataset {args.dataset}")

    baseline_rows = _load(b_path)
    pipeline_rows = _load(p_path)
    n = min(len(baseline_rows), len(pipeline_rows))

    print(f"Judging {n} question pairs with Haiku (parallel)...")

    async def run() -> tuple[list[str], list[str]]:
        with _tracer.start_as_current_span("eval.experiment") as span:
            span.set_attribute("eval.dataset", args.dataset)
            span.set_attribute("eval.n_questions", n)
            b_v, p_v = await _score_all(baseline_rows[:n], pipeline_rows[:n])
            b_acc = _accuracy(b_v)
            p_acc = _accuracy(p_v)
            avg_conf = sum(r.get("confidence", 0.0) for r in pipeline_rows[:n]) / max(n, 1)
            span.set_attribute("eval.baseline_accuracy", round(b_acc, 4))
            span.set_attribute("eval.pipeline_accuracy", round(p_acc, 4))
            span.set_attribute("eval.delta_pp", round((p_acc - b_acc) * 100, 1))
            span.set_attribute("eval.avg_pipeline_confidence", round(avg_conf, 4))
            span.set_attribute("eval.baseline_correct", b_v.count("correct"))
            span.set_attribute("eval.pipeline_correct", p_v.count("correct"))
            span.set_attribute("eval.baseline_incorrect", b_v.count("incorrect"))
            span.set_attribute("eval.pipeline_incorrect", p_v.count("incorrect"))
        return b_v, p_v

    b_verdicts, p_verdicts = asyncio.run(run())

    _print_table(args.dataset, pipeline_rows[:n], b_verdicts, p_verdicts)
    _save_scored(args.dataset, baseline_rows[:n], pipeline_rows[:n], b_verdicts, p_verdicts)


if __name__ == "__main__":
    main()
