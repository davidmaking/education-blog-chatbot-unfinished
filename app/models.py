from __future__ import annotations
from typing import Literal
from pydantic import BaseModel


class ChatTurn(BaseModel):
    """One turn in the learner ↔ tutor conversation (the un-checked study phase)."""
    role: Literal["user", "assistant"]
    content: str


class AgentComment(BaseModel):
    agent: Literal["generator", "critic", "verifier"]
    role: str
    content: str
    claim: str | None = None
    verdict: Literal["supports", "refutes", "unclear"] | None = None
    url: str | None = None


class PipelineResult(BaseModel):
    answer: str                     # the synthesized artifact — final answer or blog post body
    comments: list[AgentComment]
    confidence: float
    confidence_level: Literal["high", "medium", "low"]
    title: str | None = None        # set when the artifact is a blog post
