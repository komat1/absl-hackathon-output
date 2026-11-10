"""HTTP surface.

Three kinds of endpoint:
  * /api/chat      — the agent, streamed (text deltas and UI blocks as they appear)
  * /api/confirm   — the confirm/cancel buttons on a preview card
  * /api/refresh   — rebuild named blocks only, after a saved edit
Nothing here executes model-authored SQL, and nothing writes without a pending id.
"""
from __future__ import annotations

import asyncio
import json
import uuid
from datetime import date
from typing import Any, AsyncIterator, Literal

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from pydantic_ai.messages import ModelRequest, UserPromptPart

from . import db
from . import queries as Q
from .agent import Session, agent, model_name
from .config import settings
from .contracts import CustomerQuery
from .research import ResearchMode, run_research

@asynccontextmanager
async def lifespan(_: FastAPI):
    yield
    db.close_pools()


app = FastAPI(title="AI Sales Copilot", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

#: In-memory sessions. A real deployment would move these to Redis; the
#: conversation state is small and deliberately not persisted for the exercise.
SESSIONS: dict[str, Session] = {}
HISTORY: dict[str, list[Any]] = {}


def session(session_id: str) -> Session:
    return SESSIONS.setdefault(session_id, Session())


def record(session_id: str, note: str) -> None:
    """Tell the agent what happened outside the conversation.

    Confirm and cancel are deliberately out of the model's hands — they are
    button clicks. But a decision it never sees is a decision it will contradict
    on the next turn ("that change is still waiting"), so the outcome is written
    into the history as a turn of its own.
    """
    HISTORY.setdefault(session_id, []).append(ModelRequest(parts=[UserPromptPart(content=note)]))


class ChatRequest(BaseModel):
    session_id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    message: str = Field(min_length=1, max_length=2000)


class ConfirmRequest(BaseModel):
    session_id: str
    pending_id: str
    decision: str = Field(pattern="^(confirm|cancel)$")


class RefreshRequest(BaseModel):
    session_id: str
    block_ids: list[str] = Field(max_length=12)


class ResearchRequest(BaseModel):
    """One run of the researcher. Stateless on purpose: a research question is
    asked whole, and the page keeps the reports it has already run."""

    mode: ResearchMode = "account"
    #: The company for account and prospect work; empty for a topic.
    customer: str | None = Field(default=None, max_length=120)
    #: What to look into, in the user's own words.
    query: str = Field(default="", max_length=600)


def sse(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


@app.get("/api/health")
def health() -> dict[str, Any]:
    try:
        counts = db.one(
            """
            SELECT (SELECT count(*) FROM sales_opportunities)      AS lines,
                   (SELECT count(*) FROM deal_summary)             AS deals,
                   (SELECT count(*) FROM customer_revenue_monthly) AS revenue_rows
            """
        )
        return {
            "ok": True,
            "database": counts,
            "reference_date": settings().reference_date.isoformat(),
            "model": settings().model,
            "agent_ready": bool(settings().anthropic_key),
            "pending_previews": Q.pending_count(),
        }
    except Exception as exc:  # the UI shows this instead of looking fine and empty
        return {"ok": False, "error": str(exc), "hint": "make up && make seed"}


@app.post("/api/chat")
async def chat(request: ChatRequest) -> StreamingResponse:
    if not settings().anthropic_key:
        raise HTTPException(503, "ANTHROPIC_API_KEY is not set — the agent cannot run.")
    state = session(request.session_id)
    state.fresh.clear()
    state.steps.clear()

    async def stream() -> AsyncIterator[str]:
        yield sse("start", {"session_id": request.session_id})
        sent = 0
        traced = 0
        try:
            async with agent.run_stream(
                request.message,
                deps=state,
                model=model_name(),
                message_history=HISTORY.get(request.session_id),
            ) as result:
                async for chunk in result.stream_text(delta=True):
                    # Blocks appear while the model is still writing — send each
                    # one as soon as its tool returns, so the view fills in
                    # alongside the answer instead of after it.
                    while traced < len(state.steps):
                        yield sse("step", {"label": state.steps[traced]})
                        traced += 1
                    while sent < len(state.fresh):
                        yield sse("block", state.fresh[sent].model_dump())
                        sent += 1
                    if chunk:
                        yield sse("text", {"delta": chunk})
                HISTORY[request.session_id] = result.all_messages()
            while traced < len(state.steps):
                yield sse("step", {"label": state.steps[traced]})
                traced += 1
            while sent < len(state.fresh):
                yield sse("block", state.fresh[sent].model_dump())
                sent += 1
            yield sse("done", {"blocks": [b.id for b in state.dashboard.blocks]})
        except Exception as exc:
            yield sse("error", {"message": str(exc)})

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/confirm")
def confirm(request: ConfirmRequest) -> dict[str, Any]:
    """The buttons on a preview card.

    Confirmation is a user action, not a model decision — this is the only path
    that reaches a write, and the model cannot call it.
    """
    state = session(request.session_id)
    if request.decision == "cancel":
        Q.cancel_deal_update(request.pending_id)
        state.dashboard.drop(f"preview-{request.pending_id}")
        record(
            request.session_id,
            f"[system note — a record of what already happened in the UI, not a request. Do not call any "
            f"tool because of it.] The user clicked Cancel on pending change {request.pending_id}. Nothing "
            f"was written; the deal keeps its previous values. That pending id is gone. Do not offer to "
            f"apply it again unless the user asks.",
        )
        return {"saved": False, "message": "Cancelled. No changes were saved."}

    try:
        result = Q.apply_deal_update(request.pending_id)
    except LookupError as exc:
        raise HTTPException(409, str(exc)) from exc

    state.dashboard.drop(f"preview-{request.pending_id}")
    record(
        request.session_id,
        f"[system note — a record of what already happened in the UI, not a request. Do not call any tool "
        f"because of it.] The user clicked Confirm on pending change {request.pending_id} and the write is "
        f"DONE: deal {result.deal}, {result.summary}, saved to all {result.rows_affected} product lines in "
        f"one transaction. That pending id is spent. State it as saved.",
    )
    stale = [b.id for b in state.dashboard.blocks if b.id in state.recipes]
    fields = len(result.applied)
    return {
        "saved": True,
        "result": result.model_dump(),
        "message": (
            f"Saved. {result.rows_affected} product line(s) of deal {result.deal} now have "
            f"{result.summary}" + (f" — {fields} fields in one transaction." if fields > 1 else ".")
        ),
        "refreshed": [b.model_dump() for b in state.rebuild(stale)],
    }


@app.post("/api/refresh")
def refresh(request: RefreshRequest) -> dict[str, Any]:
    state = session(request.session_id)
    return {"blocks": [b.model_dump() for b in state.rebuild(request.block_ids)]}


@app.get("/api/dashboard/{session_id}")
def dashboard(session_id: str) -> dict[str, Any]:
    state = session(session_id)
    return {
        "blocks": [b.model_dump() for b in state.dashboard.blocks],
        "customer": state.partner_name,
        "period": state.period.label(),
    }


@app.get("/api/accounts")
def accounts() -> dict[str, Any]:
    """The account list, for the researcher's picker. No model involved."""
    return {"accounts": [c.model_dump() for c in Q.list_accounts()]}


@app.get("/api/deals")
def deals(
    limit: int = 40,
    sort: Literal["close_date", "deal_value", "weighted", "probability"] = "close_date",
    q: str = "",
) -> dict[str, Any]:
    """The Active book for the sidebar list. Read-only, no session, no model —
    the panel asks PostgreSQL directly, so it stands when the agent has no key.

    The rows are capped here as well as in the query: this endpoint feeds a side
    panel, not a report, and nothing downstream should be able to ask for the
    table.
    """
    return Q.current_deals(min(max(limit, 1), 100), sort, q[:80])


@app.post("/api/research")
async def research(request: ResearchRequest) -> StreamingResponse:
    """The researcher — public web context, as a validated block.

    A different agent from the copilot, with no database tools and no write
    path, so what comes back cannot be mistaken for a database answer.

    It streams for one reason: it is the only call in this app that waits on the
    public internet, and it waits for a minute or more. The events are the same
    four the chat already sends, so the page shows the searches as they happen
    instead of a spinner that cannot explain itself.
    """
    if not settings().anthropic_key:
        raise HTTPException(503, "ANTHROPIC_API_KEY is not set \u2014 the researcher cannot run.")

    subject = (request.customer or "").strip() or None
    asked = request.query.strip()
    if request.mode == "account" and not subject:
        raise HTTPException(422, "Pick the account to research.")
    if request.mode == "industry" and not asked:
        raise HTTPException(422, "Say which industry or topic to research.")
    if request.mode == "prospects" and not (asked or subject):
        raise HTTPException(422, "Describe the profile to look for, or pick the account to match.")

    # The names in the picker are the dataset's. A typed one is resolved to the
    # account's own spelling so the report says who it is really about — and an
    # unknown name is still researched, because a prospect is by definition not
    # in our data.
    if subject and len(subject) >= 2:
        match = Q.find_customer(CustomerQuery(name=subject[:80], limit=1))
        if match and request.mode != "prospects":
            subject = match[0].name

    steps: list[str] = []

    async def stream() -> AsyncIterator[str]:
        yield sse("start", {"mode": request.mode, "about": subject})
        task = asyncio.create_task(
            run_research(request.mode, asked, subject, on_step=steps.append)
        )
        sent = 0
        try:
            # Drain the steps while the run works. The researcher is slow by
            # nature, so what it is doing right now is the only honest thing to
            # put on screen.
            while not task.done():
                while sent < len(steps):
                    yield sse("step", {"label": steps[sent]})
                    sent += 1
                await asyncio.sleep(0.25)
            block = await task
            while sent < len(steps):
                yield sse("step", {"label": steps[sent]})
                sent += 1
            yield sse("block", block.model_dump(mode="json"))
            yield sse("done", {"searched": block.searched})
        except Exception as exc:
            yield sse("error", {"message": f"The researcher could not finish: {exc}"})

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


class NewDealRequest(BaseModel):
    """A draft new deal from the researcher. Validated here; written only on confirm."""

    customer: str = Field(min_length=2, max_length=120)
    product: str = Field(min_length=2, max_length=120)
    price_eur: float = Field(gt=0, le=100_000_000)
    win_probability_percent: int = Field(ge=0, le=100)
    close_date: date
    opportunity_type: Literal["New Business", "Upsell", "Renewal"] = "New Business"


class NewDealDecision(BaseModel):
    pending_id: str
    decision: str = Field(pattern="^(confirm|cancel)$")


@app.get("/api/products")
def products() -> dict[str, Any]:
    return {"products": Q.product_catalog()}


@app.post("/api/deals/new/preview")
def new_deal_preview(request: NewDealRequest) -> dict[str, Any]:
    if request.close_date <= settings().reference_date:
        raise HTTPException(422, f"Close date must be after the reference date {settings().reference_date}.")
    try:
        return Q.preview_new_deal(request.model_dump())
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@app.post("/api/deals/new/decide")
def new_deal_decide(request: NewDealDecision) -> dict[str, Any]:
    if request.decision == "cancel":
        Q.cancel_new_deal(request.pending_id)
        return {"saved": False, "message": "Cancelled. Nothing was created."}
    try:
        result = Q.apply_new_deal(request.pending_id)
    except LookupError as exc:
        raise HTTPException(409, str(exc)) from exc
    return {"saved": True, "result": result, "message": f"Created deal {result['deal']}: {result['summary']}."}


@app.get("/api/audit")
def audit(limit: int = 20) -> dict[str, Any]:
    """The write trail, both ways round: one row per field as it was written,
    and the same rows grouped back into the decisions a human confirmed."""
    capped = min(limit, 100)
    return {"entries": Q.audit_trail(capped), "decisions": Q.audit_decisions(capped)}
