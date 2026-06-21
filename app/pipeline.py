import app.telemetry  # noqa: F401 — must be first; triggers Phoenix register() before any anthropic client init

from opentelemetry import trace

from app.agents.generator import generate
from app.agents.tutor import tutor_reply
from app.agents.blogger import write_post
from app.agents.critics import critique
from app.agents.verifier import verify
from app.agents.teacher import teach
from app.confidence import compute_confidence
from app.models import AgentComment, ChatTurn, PipelineResult

_tracer = trace.get_tracer("sourcerer.pipeline")


async def _review(text: str, topic: str) -> tuple[list[AgentComment], list[AgentComment], float, str]:
    """Shared accuracy engine: decompose + red-team claims, ground flagged ones, score confidence.

    Used both by the full single-question pipeline and by the blog-post conversion step.
    """
    critic_comments = await critique(text, topic)
    verifier_comments = await verify(critic_comments)
    confidence, confidence_level = await compute_confidence(critic_comments, verifier_comments)
    return critic_comments, verifier_comments, confidence, confidence_level


# ── Tutoring phase: plain conversation, NO checking ──────────────────────────────

async def chat(messages: list[ChatTurn]) -> str:
    """One tutor turn in the live study conversation. No critics/verifier/grounding run here."""
    with _tracer.start_as_current_span("tutor.chat") as span:
        span.set_attribute("turns", len(messages))
        reply = await tutor_reply(messages)
        span.set_attribute("reply.length", len(reply))
    return reply


# ── Conversion phase: turn the conversation into a reviewed blog post ─────────────

async def convert_to_blog_post(messages: list[ChatTurn]) -> PipelineResult:
    """Synthesize the conversation into a blog post, THEN deploy critics + verifier on it."""
    with _tracer.start_as_current_span("blogpost.convert") as span:
        span.set_attribute("turns", len(messages))

        title, post = await write_post(messages)
        span.set_attribute("post.length", len(post))

        # Topic context for claim decomposition = what the learner actually asked about.
        topic = "\n".join(m.content for m in messages if m.role == "user")[:1000]

        critic_comments, verifier_comments, confidence, confidence_level = await _review(post, topic)
        span.set_attribute("critic.count", len(critic_comments))
        span.set_attribute("verifier.count", len(verifier_comments))
        span.set_attribute("confidence", confidence)

    return PipelineResult(
        answer=post,
        title=title,
        comments=[*critic_comments, *verifier_comments],
        confidence=confidence,
        confidence_level=confidence_level,
    )


# ── Full single-question pipeline (used by the eval harness + /ask) ───────────────

async def run_pipeline(question: str) -> PipelineResult:
    with _tracer.start_as_current_span("pipeline.run") as span:
        span.set_attribute("question", question[:200])

        draft = await generate(question)
        span.set_attribute("draft.length", len(draft))

        critic_comments, verifier_comments, confidence, confidence_level = await _review(draft, question)
        span.set_attribute("critic.count", len(critic_comments))
        span.set_attribute("verifier.count", len(verifier_comments))

        answer = await teach(draft, question, critic_comments, verifier_comments)
        span.set_attribute("answer.length", len(answer))
        span.set_attribute("confidence", confidence)

    return PipelineResult(
        answer=answer,
        comments=[
            AgentComment(agent="generator", role="Generator", content=draft),
            *critic_comments,
            *verifier_comments,
        ],
        confidence=confidence,
        confidence_level=confidence_level,
    )


async def reply_to_comment(
    comment: AgentComment,
    followup: str,
    messages: list[ChatTurn] | None = None,
) -> str:
    """Follow-up on a specific agent's review comment.

    Re-enters the tutoring *conversation* (not the full pipeline) with the commenting
    agent's context injected, so the learner keeps studying from that agent's perspective.
    The enriched conversation can later be re-converted into an updated blog post.
    """
    context = (
        f"{followup}\n\n"
        f"[This is a follow-up about a review comment from the {comment.role}. "
        f"Their note: {comment.content[:500]}"
        + (f" Regarding the claim: '{comment.claim}'." if comment.claim else "")
        + (f" Cited source: {comment.url}." if comment.url else "")
        + "]"
    )
    convo = list(messages or [])
    convo.append(ChatTurn(role="user", content=context))
    return await chat(convo)
