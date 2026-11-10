"""The researcher — the one part of this app that looks outside the database.

It is a second agent on purpose. It holds no database tools and the copilot
holds no web access, and the only thing that crosses between them is a
validated `ResearchReport`. That split is the whole design: a public claim
cannot arrive dressed as a database fact, and a simulated figure cannot be
cited as public evidence.

What it may not do, structurally rather than by instruction:
  * write anything — it never touches a pool;
  * state a figure about the account — it cannot see the dataset;
  * return an undated claim — `ResearchSource` rejects it.
"""
from __future__ import annotations

from datetime import date
import json
from typing import Any, Callable, Literal

from pydantic_ai import Agent, WebSearchTool
from pydantic_ai.capabilities import NativeTool
from pydantic_ai.usage import UsageLimits

from .config import settings
from .contracts import RESEARCH_CATEGORIES, ResearchBlock, ResearchReport

ResearchMode = Literal["account", "industry", "prospects"]

CATEGORY_MENU = "\n".join(f"  - {name}: {what}" for name, what in RESEARCH_CATEGORIES.items())

RESEARCH_PROMPT = f"""
You research public, citable context for a telecom account team selling
connectivity, cloud, security and workplace services to business customers. You
work for the account manager who is about to walk into a meeting.

You search the web and you report what you found. You never report what you
remember: every finding must rest on a page you actually opened in this run.

Categories, one per finding:
{CATEGORY_MENU}

Your budget, and it is strict. Someone is waiting for this between two
meetings, and a thorough answer that arrives after the meeting is worth
nothing. Make AT MOST THREE searches. Stop searching and write up the moment you
have three well-sourced findings, or after the third search, whichever comes
first. Three findings on pages you actually read beat eight you half-checked —
aim for three, never more than four. Do not go back for completeness.
If the budget runs out, write up what you have and put the rest in `gaps`.

How to work:
1. Search first, and plan the few searches you get: the company name with the
   risk area, the sector, or the regulation by name. Do not repeat a search in
   another wording.
2. Prefer sources from the last 24 months, and the primary source over coverage
   of it: the company's own statement, the regulator's own page, the vendor's
   own end-of-life notice. Never use a claim published by an attacker — a name
   on a ransomware leak site is not a source.
3. Every finding carries a real URL, a publisher and a publication date you
   read off the page. If you cannot find the date, drop the finding — an
   undated claim is rejected by the output schema, not merely frowned upon.
4. Keep `claim` to what the source actually says, in one or two sentences. Put
   what it might mean for this customer in `implication`, and say it as a
   possibility, not a fact.
5. `question` is the discovery question that TESTS the implication — the thing
   the account manager has to ask because no one can look it up. `next_step` is
   what to do after the answer.
6. Found little? Say so in `gaps` and return fewer findings. "No dated public
   source in the last two years" is a useful, honest answer. Never pad.

The line you must not cross: a sector risk is not evidence that this customer
is exposed. We have no inventory of what they run, no contract dates and no
contacts. Never write that the customer IS affected, IS vulnerable or HAS a
deadline — write what the source says, then the question that would establish
it. Do not name an individual employee of the customer.

Prospect mode: when asked for companies that resemble an existing customer,
fill `candidates` — two, not a long list, under the same search budget.
Each one needs a public reason it matches and the sources it came from. Never invent a deal, a value, a probability or a spend estimate for
a company — there is no data for that and no one asked you to guess. `opener`
is one sentence a salesperson could actually open with.

The figures the team holds about its own customers are simulated and are none
of your business — you were given a name and a question, nothing else. Do not
comment on their revenue, pipeline or deals.

Write in English, plainly, for someone reading between meetings.
"""

#: No database tools, no deps, no write path: a search tool and a schema.
research_agent = Agent(
    output_type=ResearchReport,
    #: The model drives this tool agentically, so one question of its own costs
    #: several uses — 8 is about three real searches, which is what the prompt
    #: asks for. A low context size on top: this is meeting prep, read between
    #: two appointments, and measured runs went from four minutes to under one
    #: once the search budget came down. Exhausting the budget does not fail the
    #: run, it quietly halves the answer, so the prompt is the real brake and
    #: this is only the backstop.
    capabilities=[NativeTool(WebSearchTool(max_uses=8, search_context_size="low"))],
    system_prompt=RESEARCH_PROMPT,
    #: One retry, not two. A rejected report costs a whole extra pass over the
    #: search results, and two of those put the run past any wait a person will
    #: sit through — the date validator normalises what it can for the same
    #: reason. Better a visible failure than a four-minute spinner.
    retries=1,
)

#: A bounded run, twice over: the model cannot keep searching, and the whole
#: thing cannot outlast the patience of someone standing in a demo. A
#: researcher that quietly loops is a researcher nobody can show.
LIMITS = UsageLimits(request_limit=8)
#: Measured: with the three-search budget an account question lands in well
#: under a minute, a sector or prospect one a little later. Past three minutes
#: nobody is still watching, so the run is cut and the failure is shown.
TIMEOUT_SECONDS = 180.0


def _ask(mode: ResearchMode, query: str, customer: str | None) -> str:
    """Turn the page's mode and text into one instruction.

    The mode is a UI affordance, not a different researcher: it only decides
    what is being asked about, so the rules above apply unchanged to all three.
    """
    today = date.today().isoformat()
    who = f"The account is {customer}. " if customer else ""
    asked = query.strip()
    if mode == "prospects":
        return (
            f"Today is {today}. {who}Find companies that resemble this profile and could be "
            f"worth approaching, and fill `candidates`. Profile and constraints: {asked}\n"
            "Say in `scope` what profile you matched on. Public reasons only, no figures."
        )
    if mode == "industry":
        return (
            f"Today is {today}. {who}Research the industry or topic below and fill `findings`. "
            f"Keep it at sector level — do not attribute any of it to a single company "
            f"unless the source names that company.\nTopic: {asked}"
        )
    return (
        f"Today is {today}. {who}Research public context on this account for an upcoming "
        f"sales meeting and fill `findings`. Cover whichever of the categories the sources "
        f"actually support.\n"
        + (f"What the account manager asked: {asked}" if asked else "No specific question — give the general picture.")
    )


def _query_of(part: Any) -> str | None:
    """The search string out of a native tool call part, however it is carried."""
    args = getattr(part, "args", None)
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except ValueError:
            return args[:200] or None
    if isinstance(args, dict):
        query = args.get("query")
        return str(query)[:200] if query else None
    return None


def _searches(messages: list[Any]) -> int:
    """How many distinct searches the run actually made.

    Read off the history rather than counted in the prompt: the number under the
    block has to be what happened. Distinct queries, because the model wraps the
    search tool in its own calls and the same query can come back twice.
    """
    seen: set[str] = set()
    for message in messages:
        for part in getattr(message, "parts", []):
            if getattr(part, "tool_name", None) != "web_search":
                continue
            if query := _query_of(part):
                seen.add(query)
    return len(seen)


async def run_research(
    mode: ResearchMode,
    query: str,
    customer: str | None = None,
    block_id: str = "research",
    on_step: Callable[[str], None] | None = None,
) -> ResearchBlock:
    """Run the researcher and return a block the UI can render.

    `on_step` is handed each search as the model makes it. This is the one call
    in the app that waits on the public internet — tens of seconds, sometimes
    two minutes — and a wait that long has to narrate itself or it looks broken.
    The steps are the real queries, not a scripted animation.

    Raises on failure instead of returning an empty report: a researcher that
    quietly finds nothing looks exactly like a missing API key, and a confident
    empty page is the one outcome this feature cannot afford.
    """
    seen: set[str] = set()

    async def events(_ctx: Any, stream: Any) -> None:
        async for event in stream:
            part = getattr(event, "part", None)
            if part is None or getattr(part, "tool_name", None) != "web_search":
                continue
            search = _query_of(part)
            if search and search not in seen:
                seen.add(search)
                if on_step:
                    on_step(f"Searching: {search}")

    result = await research_agent.run(
        _ask(mode, query, customer),
        model=f"anthropic:{settings().model}",
        usage_limits=LIMITS,
        timeout=TIMEOUT_SECONDS,
        event_stream_handler=events,
    )
    if on_step:
        on_step("Writing up what the sources support")
    report: ResearchReport = result.output
    subject = customer if mode != "industry" and customer else None
    return ResearchBlock(
        id=block_id,
        title=(
            f"Prospect research \u00b7 {subject}" if mode == "prospects" and subject
            else "Prospect research" if mode == "prospects"
            else f"Public research \u00b7 {subject}" if subject
            else "Public research"
        ),
        report=report,
        accessed=date.today(),
        about=subject,
        searched=len(seen) or _searches(result.all_messages()),
    )
