import json
import os
import re

import anthropic
from dotenv import load_dotenv

from app.models import ChatTurn

load_dotenv()

_client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

# Turns the (un-checked) tutoring conversation into a structured blog-style study
# post. This is the artifact the critic/verifier agents will then comment on — so
# write what the learner actually concluded, faithfully, without inventing new claims.
BLOGGER_SYSTEM = (
    "You convert a learner's tutoring conversation into a clear, structured, blog-style study post. "
    "The post should stand on its own as a study artifact: a short intro, well-organized sections "
    "with headings, and a concise summary of the key takeaways. "
    "Faithfully reflect what was taught in the conversation — do NOT introduce new facts or claims "
    "that were not discussed. Write in plain explanatory prose suitable for review.\n\n"
    'Respond with JSON only, no other text: {"title": "<concise post title>", "body": "<markdown body>"}'
)


def _strip_fences(text: str) -> str:
    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return text.strip()


def _format_transcript(messages: list[ChatTurn]) -> str:
    label = {"user": "Learner", "assistant": "Tutor"}
    return "\n\n".join(f"{label.get(m.role, m.role)}: {m.content}" for m in messages)


async def write_post(messages: list[ChatTurn]) -> tuple[str, str]:
    """Synthesize the conversation into (title, markdown_body)."""
    transcript = _format_transcript(messages)
    response = await _client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=4096,
        system=[
            {
                "type": "text",
                "text": BLOGGER_SYSTEM,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=[{"role": "user", "content": f"Conversation transcript:\n\n{transcript}"}],
    )
    raw = response.content[0].text
    try:
        data = json.loads(_strip_fences(raw))
        title = (data.get("title") or "Study Notes").strip()
        body = (data.get("body") or "").strip()
        if not body:
            raise ValueError("empty body")
        return title, body
    except Exception:
        # Fall back to treating the whole response as the post body.
        return "Study Notes", raw.strip()
