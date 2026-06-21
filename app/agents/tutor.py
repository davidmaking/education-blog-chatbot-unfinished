import os

import anthropic
from dotenv import load_dotenv

from app.models import ChatTurn

load_dotenv()

_client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

# The tutor is a plain, multi-turn teaching conversation. No critics, no verifier,
# no grounding run here — checking happens ONLY when the learner converts the
# conversation into a verifiable blog post. Keep this fast and conversational.
TUTOR_SYSTEM = (
    "You are a warm, expert AI tutor having a live study conversation with a curious learner. "
    "Teach the topic step by step, building on what was said earlier in the conversation. "
    "Explain clearly at the level the learner seems to be at, use concrete examples, and "
    "invite follow-up questions. Keep replies focused and conversational — this is a back-and-forth "
    "chat, not an essay. Do not add disclaimers about being an AI or about verification; a separate "
    "review stage handles fact-checking later."
)


async def tutor_reply(messages: list[ChatTurn]) -> str:
    """Generate the next tutor turn given the conversation so far. No grounding/critique."""
    response = await _client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=2048,
        system=[
            {
                "type": "text",
                "text": TUTOR_SYSTEM,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=[{"role": m.role, "content": m.content} for m in messages],
    )
    return response.content[0].text
