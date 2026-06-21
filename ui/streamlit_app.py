import asyncio
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import streamlit as st
from app.pipeline import chat, convert_to_blog_post
from app.models import ChatTurn

st.set_page_config(page_title="Sourcerer", page_icon="🔍", layout="centered")

st.title("Sourcerer")
st.caption("Study with an AI tutor, then turn the conversation into a fact-checked blog post.")

# ── Session state ────────────────────────────────────────────────────────────────
if "messages" not in st.session_state:
    st.session_state.messages = []          # list[ChatTurn]
if "post" not in st.session_state:
    st.session_state.post = None            # PipelineResult after conversion

# ── Tutoring phase: plain chat, NO checking happens here ──────────────────────────
for m in st.session_state.messages:
    with st.chat_message("user" if m.role == "user" else "assistant"):
        st.markdown(m.content)

if prompt := st.chat_input("Ask your tutor anything..."):
    st.session_state.messages.append(ChatTurn(role="user", content=prompt))
    with st.chat_message("user"):
        st.markdown(prompt)
    with st.chat_message("assistant"):
        with st.spinner("Thinking..."):
            reply = asyncio.run(chat(st.session_state.messages))
        st.markdown(reply)
    st.session_state.messages.append(ChatTurn(role="assistant", content=reply))

# ── Conversion trigger ───────────────────────────────────────────────────────────
if st.session_state.messages:
    st.divider()
    if st.button("📝 Convert to verifiable blog post", type="primary"):
        with st.spinner("Writing the post and deploying review agents..."):
            st.session_state.post = asyncio.run(
                convert_to_blog_post(st.session_state.messages)
            )

# ── Reviewed blog post ───────────────────────────────────────────────────────────
result = st.session_state.post
if result:
    st.divider()
    confidence_emoji = {"high": "🟢", "medium": "🟡", "low": "🔴"}.get(
        result.confidence_level, "⚪"
    )
    if result.title:
        st.header(result.title)
    st.markdown(
        f"{confidence_emoji} **{result.confidence_level.capitalize()} confidence** "
        f"({result.confidence:.0%})"
    )
    st.markdown(result.answer)

    if result.comments:
        st.subheader(f"Agent review ({len(result.comments)} comments)")
        for c in result.comments:
            verdict_badge = ""
            if c.verdict:
                colours = {"supports": "🟢", "refutes": "🔴", "unclear": "🟡"}
                verdict_badge = f" {colours.get(c.verdict, '')} {c.verdict}"
            st.markdown(f"**{c.role}**{verdict_badge}")
            if c.claim:
                st.caption(f"Claim: {c.claim}")
            st.markdown(c.content)
            if c.url:
                st.markdown(f"[Source]({c.url})")
            st.divider()
