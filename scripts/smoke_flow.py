#!/usr/bin/env python3
"""
Smoke-test the two-phase flow end to end:

  1. Tutoring phase  — chat() turns, NO checking runs.
  2. Conversion      — convert_to_blog_post() writes the post, THEN runs critics + verifier.
  3. Comment reply   — reply_to_comment() continues the conversation with an agent's context.

Usage:
  python scripts/smoke_flow.py
  python scripts/smoke_flow.py "How do black holes form?"

Requires ANTHROPIC_API_KEY in .env. Browserbase is optional (verifier no-ops without it).
Cost: a handful of Sonnet/Haiku calls — cents.
"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.pipeline import chat, convert_to_blog_post, reply_to_comment
from app.models import ChatTurn


def rule(title: str) -> None:
    print(f"\n{'=' * 70}\n{title}\n{'=' * 70}")


async def main() -> None:
    topic = sys.argv[1] if len(sys.argv) > 1 else "What is the speed of light and how was it measured?"

    # ── Phase 1: tutoring conversation (no checking) ────────────────────────────
    rule("PHASE 1 — Tutoring chat (no fact-checking runs here)")
    messages: list[ChatTurn] = [ChatTurn(role="user", content=topic)]
    print(f"\nLearner: {topic}")
    reply = await chat(messages)
    print(f"\nTutor: {reply}")
    messages.append(ChatTurn(role="assistant", content=reply))

    # A follow-up turn, still un-checked.
    followup = "Can you give a concrete example?"
    messages.append(ChatTurn(role="user", content=followup))
    print(f"\nLearner: {followup}")
    reply2 = await chat(messages)
    print(f"\nTutor: {reply2}")
    messages.append(ChatTurn(role="assistant", content=reply2))

    # ── Phase 2: convert → review ───────────────────────────────────────────────
    rule("PHASE 2 — Convert to verifiable blog post (critics + verifier deploy NOW)")
    result = await convert_to_blog_post(messages)
    print(f"\nTitle: {result.title}")
    print(f"Confidence: {result.confidence:.0%} ({result.confidence_level})")
    print(f"\n--- POST ---\n{result.answer}")
    print(f"\n--- {len(result.comments)} AGENT COMMENTS ---")
    for c in result.comments:
        verdict = f" [{c.verdict}]" if c.verdict else ""
        print(f"\n• {c.role}{verdict}")
        if c.claim:
            print(f"  claim: {c.claim}")
        print(f"  {c.content}")
        if c.url:
            print(f"  source: {c.url}")

    # ── Phase 3: reply to a comment (continues the conversation) ─────────────────
    if result.comments:
        rule("PHASE 3 — Reply to an agent comment (re-enters the tutoring conversation)")
        target = result.comments[0]
        followup_q = "Why does that matter for understanding the topic?"
        print(f"\nReplying to: {target.role}")
        print(f"Follow-up: {followup_q}")
        tutor_reply = await reply_to_comment(target, followup_q, messages)
        print(f"\nTutor: {tutor_reply}")


if __name__ == "__main__":
    asyncio.run(main())
