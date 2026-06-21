from fastapi import FastAPI
from pydantic import BaseModel

from app.pipeline import run_pipeline, reply_to_comment, chat, convert_to_blog_post
from app.models import AgentComment, ChatTurn, PipelineResult

app = FastAPI(title="Sourcerer", description="AI tutor with verified answers")


class AskRequest(BaseModel):
    question: str


class ReplyRequest(BaseModel):
    comment: AgentComment
    followup: str
    messages: list[ChatTurn] = []


class ReplyResponse(BaseModel):
    reply: str


class ChatRequest(BaseModel):
    messages: list[ChatTurn]


class ChatResponse(BaseModel):
    reply: str


class ConvertRequest(BaseModel):
    messages: list[ChatTurn]


@app.post("/chat", response_model=ChatResponse)
async def chat_endpoint(request: ChatRequest) -> ChatResponse:
    """Tutoring phase: plain conversation, no fact-checking."""
    return ChatResponse(reply=await chat(request.messages))


@app.post("/convert", response_model=PipelineResult)
async def convert(request: ConvertRequest) -> PipelineResult:
    """Conversion phase: turn the conversation into a reviewed blog post."""
    return await convert_to_blog_post(request.messages)


@app.post("/ask", response_model=PipelineResult)
async def ask(request: AskRequest) -> PipelineResult:
    return await run_pipeline(request.question)


@app.post("/reply", response_model=ReplyResponse)
async def reply(request: ReplyRequest) -> ReplyResponse:
    """Follow-up on an agent comment — continues the tutoring conversation."""
    return ReplyResponse(
        reply=await reply_to_comment(request.comment, request.followup, request.messages)
    )


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
