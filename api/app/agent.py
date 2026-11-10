"""The copilot agent.

What the model may do: pick a tool and fill validated parameters. What it may
not do: write SQL, see the dataset, or change anything without a human
confirmation. Both of those are structural — there is no tool for either.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Annotated, Any, Callable, Literal

from pydantic import Field, ValidationError
from pydantic_ai import Agent, ModelRetry, RunContext

from . import blocks as B
from . import queries as Q
from .research import run_research
from .config import settings
from .contracts import (
    CHART_JOBS,
    AccountQuery,
    AdvanceRequest,
    Block,
    ChartBlock,
    ChartKind,
    Cluster,
    ComparisonQuery,
    CustomerQuery,
    Dashboard,
    EditableField,
    OpportunityQuery,
    OpportunityType,
    Period,
    PipelineQuery,
    RecommendQuery,
    RevenueQuery,
    Status,
    TopCustomersQuery,
    UpdateRequest,
)


@dataclass
class Session:
    """Conversation state. The selected customer, period and filters live here —
    not in the prompt — so a follow-up question inherits them exactly."""

    partner: str | None = None
    partner_name: str | None = None
    period: Period = field(default_factory=lambda: Period(from_month="2026-01", to_month="2026-10"))
    dashboard: Dashboard = field(default_factory=Dashboard)
    #: Blocks produced by the current turn, streamed to the UI as they appear.
    fresh: list[Block] = field(default_factory=list)
    #: What the agent looked at this turn, one human sentence per tool call,
    #: streamed to the UI the same way. The copilot verifies before it writes
    #: and that takes seconds a spinner cannot explain — so the wait narrates
    #: itself. Written here rather than inferred in the browser: a trace is a
    #: record of queries that ran, and only the server knows which ones did.
    steps: list[str] = field(default_factory=list)
    #: How to rebuild a block on its own. This is what lets a saved deal edit
    #: refresh the affected components only — each one re-runs its own query
    #: instead of the page reloading everything.
    recipes: dict[str, Callable[[], Block]] = field(default_factory=dict)

    def step(self, label: str) -> None:
        """Record one line of the trace. `label` is a sentence a salesperson can
        read, optionally `Prefix: detail` — the UI reads the prefix to pick the
        icon, so keep the prefixes in step with web/src/components/assistant/StepChips.tsx."""
        self.steps.append(label)

    def emit(self, block: Block, refresh: Callable[[], Block] | None = None) -> None:
        self.dashboard.replace(block)
        self.fresh.append(block)
        if refresh is not None:
            self.recipes[block.id] = refresh

    def rebuild(self, block_ids: list[str]) -> list[Block]:
        """Re-run the recipes for these blocks and swap the results in."""
        rebuilt: list[Block] = []
        for block_id in block_ids:
            recipe = self.recipes.get(block_id)
            if recipe is None:
                continue
            block = recipe()
            if block is None:
                # A companion chart with nothing left to show (a donut whose
                # split collapsed to one slice) leaves rather than going blank.
                self.dashboard.drop(block_id)
                continue
            self.dashboard.replace(block)
            rebuilt.append(block)
        return rebuilt

    def need_partner(self) -> str:
        if not self.partner:
            raise ModelRetry("No customer selected yet. Call select_customer first.")
        return self.partner


#: The forms the model picks between, one line each. Generated from the
#: contract so a chart added there cannot be missing from the prompt.
CHART_MENU = "\n".join(f"  - {name}: {job}" for name, job in CHART_JOBS.items())

SYSTEM_PROMPT = f"""
You are a sales copilot for a telecom account team. You answer from the database
only, through your tools, and you help the account manager prepare for meetings,
prioritize open deals and safely update them.

Reference date: {settings().reference_date}. The dataset ends there — treat it as
today. Revenue scheduled after 2026-10 is future revenue, not historical.

How to work:
- Resolve a company name to an account with select_customer before any
  account-level question. Keep the selected customer, period and filters across
  follow-up questions; only change them when the user asks.
- Call a tool for every figure you state. Never estimate, never carry a number
  over from memory, never do arithmetic the database can do.
- Say plainly which part of your answer is a database fact and which is your
  recommendation.
- Never write a table in your reply — no markdown tables, no row-by-row lists
  of deals, months or clusters. Everything a tool returned is already on the
  dashboard as a block. Mention a deal by its number only when your point is
  about that deal, and quote the one or two figures that make the point.

How a reply looks. A sales person reads it on a phone between meetings, so it is
a crisp corporate briefing — calm, plain, no filler, no hedging, no exclamation
marks, no "I'd suggest" or "Great question". Under 90 words unless the user asks
for more. Use exactly this shape and skip any part that has nothing to say:

**<One-line headline: the answer or the key figure, under 15 words.>**
<At most one short sentence of context.>

### Facts
- <2–3 bullets, each one short line with one or two figures from a tool>

### Next step
- <1–3 bullets, each an action starting with a verb; options as **Option** — effect>

Rules for that shape:
- "Facts" holds only database figures; "Next step" holds only your
  recommendation. Never mix the two. Public research gets its own "### Context"
  section with source and date.
- One idea per bullet, one line each. No sub-bullets, no numbered lists, no
  paragraphs longer than one sentence.
- Round in prose: €11.8k, €1.2m, 40%. Dates as 25 Sep 2026. The blocks carry the
  exact figures, so never restate what a block already shows.
- After a preview, end with the single line "Confirm or cancel on the card —
  nothing is saved until you do."

Example, for an overdue deal:
**Mercedes-Benz 990601976 is overdue.**
Still Active at 80%, but the close date passed five weeks ago (25 Sep 2026).

### Facts
- 2 Connectivity lines: Business Fiber 1000 (€11.8k), 5G Business Backup (€1.7k)
- The data does not show why it slipped

### Next step
- Check the status with the deal owner, then tell me which applies:
- **Won** — moves to 100% and leaves the Active pipeline
- **Still open** — new close date, lower probability if at risk
- **Lost** — moves to 0% and leaves the Active pipeline

What the data cannot tell you: contacts, account ownership, addresses, site
counts, installed equipment, service usage, real contract expiry dates, or group
structure. close_date is a decision date, not a contract end. Opportunity history
is evidence of proposals, not an inventory of what the customer runs. If asked for
any of that, say it is not in the data, use show_limitation, and offer the nearest
answer the data does support.

Outside context is a separate thing. research_context searches public sources
and returns dated claims with URLs; it is the only tool that does not read the
database. It takes seconds, so call it only when the user asks for public,
external, news or risk context — never for a figure, and never on your own
initiative in the middle of a pipeline answer. Report what it returns as public
research with its source and date, keep it apart from the database figures, and
never let a sector finding imply that this customer is affected. The researcher
has its own page in the sidebar; point the user there for deeper work.

Honesty rules that matter here:
- Weighted pipeline is value × probability. It is a prioritization aid, never a
  forecast and never guaranteed revenue.
- When a cluster figure is reported, state whether it counts only the matching
  product lines or the full value of the deals containing them.
- A percentage change against a zero base is undefined. Say so.
- Loss comments are simulated explanations, not verified causes.
- Company names are real but every figure is simulated. Never present them as a
  company's own reported results.

Choosing a chart. The blocks carry the detail, so pick the form that fits the
question being asked, and change it with change_chart_type when the user asks for
a different one — that keeps the data and the scope and redraws only the form:
{CHART_MENU}
Three rules about charts that do not bend:
- Never ask for two y-axes. Two measures of different magnitude are two charts;
  a combo is for two measures in the SAME unit, like pipeline value and weighted
  value.
- A ranking, or any chart whose labels are company names, is a horizontal-bar.
- Prefer horizontal-bar over pie when the reader has to compare the parts.
Use the whole menu, not just bars. The tools already pair forms — a briefing
adds a cluster donut and an outcome donut, the pipeline adds a cluster donut and
a deal-count ranking, a comparison adds a side-by-side chart, top accounts are
split by cluster. For revenue_trend pick the form from the question: line for a
long period or a trend question, area for a company total read as volume,
stacked-bar for "what is it made of", heatmap for "which cluster in which
month", combo when the user wants the months against their own average, bar for
a short run of months. When a follow-up asks the same thing again, offer the
next useful form rather than redrawing the identical chart.

A message beginning "[system note" is a record of something that already
happened through the UI buttons, not a request. Never call a tool because of one
— take it as fact and answer from it. To check what is actually stored for a
deal, call deal_detail; it reads the live row.

Updating a deal:
1. move_deal_forward previews a whole decision — status, win probability and
   close date, any one of them or all three, applied together in one
   transaction. Use it whenever the user wants a deal advanced, won, lost,
   pushed out or re-rated. preview_deal_update is the same path for a single
   named field.
2. Either one writes nothing. Then STOP and ask the user to confirm or cancel.
   Never apply in the same turn as the preview, and never because you think the
   user would agree.
3. The confirm and cancel buttons on the card are the user's, not yours. Only
   call apply_deal_update if they confirm in words instead of clicking, and
   cancel_deal_update if they decline — then say "Cancelled. No changes were
   saved."
State the outcome a decision has on the deal, including that a Won or Lost deal
leaves the Active pipeline and its weighted value goes to zero. A Won deal
carries 100% probability and a Lost one 0%: name the status and leave the
probability out, and the preview will show what that implies before anything is
written.
Only status, close date and win probability can change. Prices and recorded
revenue are read-only, and an edit does not recalculate historical revenue.

Next steps: end every answer with two or three follow-ups the user could ask
next, each on its own line starting with ">> " — a short imperative request in
the user's voice (">> Add a cluster heatmap for Siemens"). Do not write
"tell me which you want" or list those options in prose as well; the lines are
shown as buttons. Only suggest what your tools can actually do.
"""

#: Built with no model on purpose: the model name (and the API key behind it) is
#: resolved per run, so the API boots, serves /api/health and reports a missing
#: key instead of crashing on import.
agent = Agent(
    deps_type=Session,
    system_prompt=SYSTEM_PROMPT,
    retries=2,
    # Short briefings stream faster; the cap also stops a runaway essay.
    model_settings={"max_tokens": 1200},
)


def model_name() -> str:
    return f"anthropic:{settings().model}"


# ──────────────────────────── context tools ────────────────────────────


@agent.tool
def select_customer(ctx: RunContext[Session], name: str) -> dict[str, Any]:
    """Resolve a company name to an account and select it for the conversation."""
    ctx.deps.step(f"Looking up the account: {name}")
    found = Q.find_customer(CustomerQuery(name=name))
    if not found:
        raise ModelRetry(f"No account matches '{name}'. Ask the user for the exact company name.")
    if len(found) > 1 and found[0].name.lower() != name.lower():
        return {
            "ambiguous": True,
            "candidates": [{"partner": c.partner, "name": c.name, "deals": c.deals} for c in found],
        }
    chosen = found[0]
    ctx.deps.partner, ctx.deps.partner_name = chosen.partner, chosen.name
    return {"selected": chosen.name, "partner": chosen.partner, "deals": chosen.deals}


@agent.tool
def set_period(ctx: RunContext[Session], from_month: str, to_month: str) -> str:
    """Set the period every later answer uses, as YYYY-MM to YYYY-MM."""
    ctx.deps.step(f"Setting the period: {from_month}…{to_month}")
    ctx.deps.period = Period(from_month=from_month, to_month=to_month)
    return f"Period set to {ctx.deps.period.label()}"


@agent.tool
def current_context(ctx: RunContext[Session]) -> dict[str, Any]:
    """What is currently selected: customer, period and the blocks on screen."""
    ctx.deps.step("Checking what is selected")
    return {
        "customer": ctx.deps.partner_name,
        "partner": ctx.deps.partner,
        "period": ctx.deps.period.label(),
        "blocks": [b.id for b in ctx.deps.dashboard.blocks],
    }


# ─────────────────────────── analysis tools ────────────────────────────


@agent.tool
def account_briefing(ctx: RunContext[Session]) -> dict[str, Any]:
    """Meeting prep for the selected account: recorded revenue in the period,
    the cluster split, deal counts by outcome. Renders cards and a chart."""
    ctx.deps.step("Reading the account briefing")
    partner = ctx.deps.need_partner()
    briefing = Q.account_briefing(AccountQuery(partner=partner, period=ctx.deps.period))
    series = Q.revenue_timeseries(RevenueQuery(period=ctx.deps.period, partner=partner))
    period = ctx.deps.period
    ctx.deps.emit(
        B.revenue_cards(briefing),
        refresh=lambda: B.revenue_cards(Q.account_briefing(AccountQuery(partner=partner, period=period))),
    )
    chart_title = f"{briefing['name']} · monthly recorded revenue"
    ctx.deps.emit(
        # Bars for the months, a line for the three-month average: both in euros,
        # so one axis carries them and the trend reads against its own months.
        B.revenue_chart(series, chart="combo", title=chart_title),
        refresh=lambda: B.revenue_chart(
            Q.revenue_timeseries(RevenueQuery(period=period, partner=partner)),
            chart="combo",
            title=chart_title,
        ),
    )
    # Two half-width donuts under the trend: what the revenue is made of, and
    # how the account's deals have ended. They sit side by side on screen.
    recompute = lambda: Q.account_briefing(AccountQuery(partner=partner, period=period))  # noqa: E731
    for build in (B.cluster_mix, B.outcome_mix):
        block = build(briefing)
        if block is not None:
            ctx.deps.emit(block, refresh=lambda build=build: build(recompute()))
    return briefing


@agent.tool
def revenue_trend(
    ctx: RunContext[Session],
    by_cluster: bool = False,
    chart: Literal["bar", "line", "area", "combo", "stacked-bar", "heatmap"] = "bar",
    whole_company: bool = False,
) -> list[dict[str, Any]]:
    """Monthly recorded revenue, for the selected account or for the whole company.

    Works with or without an account selected — pass whole_company=True for the
    company total, which is aggregated in the database the same way.

    `combo` adds the three-month average as a line over the months. `heatmap`
    and `stacked-bar` show the cluster split and set by_cluster themselves.
    """
    ctx.deps.step("Querying monthly revenue")
    split = by_cluster or chart in {"heatmap", "stacked-bar"}
    partner = None if whole_company else ctx.deps.partner
    query = RevenueQuery(period=ctx.deps.period, partner=partner, by_cluster=split)
    rows = Q.revenue_timeseries(query)
    # A grid and a time series answer different questions about the same
    # measure, so they are different components and can sit side by side. A
    # chart asked for again in another form replaces its own block — that is
    # what change_chart_type is for, and what keeps a follow-up from quietly
    # dropping the chart the user already had.
    block_id = "revenue-heatmap" if chart == "heatmap" else "revenue-chart"
    who = "Company" if partner is None else (ctx.deps.partner_name or "Account")
    title = (
        f"{who} · recorded revenue by cluster and month"
        if chart == "heatmap"
        else f"{who} · monthly recorded revenue"
    )
    ctx.deps.emit(
        B.revenue_chart(rows, chart=chart, by_cluster=split, block_id=block_id, title=title),
        refresh=lambda: B.revenue_chart(
            Q.revenue_timeseries(query), chart=chart, by_cluster=split, block_id=block_id, title=title
        ),
    )
    return rows[: settings().max_rows]


@agent.tool
def pipeline_funnel(
    ctx: RunContext[Session],
    status: Status = Status.active,
    measure: Literal["deals", "value"] = "deals",
    whole_company: bool = False,
) -> dict[str, Any]:
    """Drop-off from one sales phase to the next: Discovery through Negotiation.

    The phase is the dataset's snapshot stage and does not move when a deal is
    edited — say so when you report it.
    """
    ctx.deps.step(f"Querying the funnel: {status.value} by phase")
    partner = None if whole_company else ctx.deps.partner
    funnel = Q.pipeline_funnel(partner, status)
    ctx.deps.emit(
        B.funnel_chart(funnel, measure=measure),
        refresh=lambda: B.funnel_chart(Q.pipeline_funnel(partner, status), measure=measure),
    )
    return funnel


@agent.tool
def deal_risk_map(
    ctx: RunContext[Session],
    limit: Annotated[int, Field(ge=5, le=80)] = 40,
    whole_company: bool = False,
) -> dict[str, Any]:
    """Active deals plotted by value against win probability, coloured by how
    urgent they are. Answers "what is big, what is likely, what is running out
    of time" in one picture."""
    ctx.deps.step("Mapping active deals by value and probability")
    partner = None if whole_company else ctx.deps.partner
    risk = Q.deal_risk_map(partner, limit)
    ctx.deps.emit(
        B.risk_scatter(risk), refresh=lambda: B.risk_scatter(Q.deal_risk_map(partner, limit))
    )
    return risk


@agent.tool
def revenue_bridge(
    ctx: RunContext[Session],
    current_from: str,
    current_to: str,
    previous_from: str,
    previous_to: str,
    whole_company: bool = False,
) -> dict[str, Any]:
    """The waterfall between two periods: which clusters carried revenue up or
    down, and the two totals the steps run between."""
    ctx.deps.step(f"Bridging two periods: {previous_from}…{previous_to} → {current_from}…{current_to}")
    query = ComparisonQuery(
        current=Period(from_month=current_from, to_month=current_to),
        previous=Period(from_month=previous_from, to_month=previous_to),
        partner=None if whole_company else ctx.deps.partner,
        by_cluster=True,
    )
    bridge = Q.revenue_bridge(query)
    ctx.deps.emit(B.bridge_chart(bridge), refresh=lambda: B.bridge_chart(Q.revenue_bridge(query)))
    return bridge


@agent.tool
def change_chart_type(ctx: RunContext[Session], block_id: str, chart: ChartKind) -> dict[str, Any]:
    """Redraw a chart already on screen as a different kind.

    Same data, same scope, same filters — only the form changes. Use this for
    "show that as a funnel" instead of running the query again.
    """
    ctx.deps.step(f"Redrawing {block_id} as a {chart} chart")
    for block in ctx.deps.dashboard.blocks:
        if block.id != block_id:
            continue
        if not isinstance(block, ChartBlock):
            raise ModelRetry(f"Block {block_id} is a {block.type}, not a chart.")
        try:
            switched = B.switch_chart(block, chart)
        except ValidationError as exc:
            raise ModelRetry(
                f"That chart cannot be drawn as a {chart}: {exc.errors()[0]['msg']}. "
                "Tell the user which forms its data does support."
            ) from exc
        previous = ctx.deps.recipes.get(block_id)
        ctx.deps.emit(
            switched,
            refresh=(lambda: B.switch_chart(previous(), chart)) if previous else None,  # type: ignore[arg-type]
        )
        return {"block": block_id, "chart": chart}
    raise ModelRetry(
        f"No block {block_id} on screen. The blocks are: "
        f"{', '.join(b.id for b in ctx.deps.dashboard.blocks) or 'none yet'}."
    )


@agent.tool
def pipeline_overview(
    ctx: RunContext[Session],
    status: Status = Status.active,
    basis: Literal["lines", "full_deals"] = "lines",
    whole_company: bool = False,
) -> dict[str, Any]:
    """Pipeline by cluster with unweighted value, weighted value and distinct
    deal counts. `basis` decides what a cluster figure counts — say which."""
    ctx.deps.step(f"Querying the pipeline: {status.value} by cluster")
    partner = None if whole_company else ctx.deps.partner
    query = PipelineQuery(partner=partner, status=status, basis=basis)
    pipeline = Q.pipeline_by_cluster(query)
    ctx.deps.emit(B.pipeline_cards(pipeline), refresh=lambda: B.pipeline_cards(Q.pipeline_by_cluster(query)))
    ctx.deps.emit(B.pipeline_chart(pipeline), refresh=lambda: B.pipeline_chart(Q.pipeline_by_cluster(query)))
    mix = B.pipeline_mix(pipeline)
    if mix is not None:
        ctx.deps.emit(mix, refresh=lambda: B.pipeline_mix(Q.pipeline_by_cluster(query)))
    size = "half" if mix is not None else "full"
    ctx.deps.emit(
        B.pipeline_deal_counts(pipeline, size=size),
        refresh=lambda: B.pipeline_deal_counts(Q.pipeline_by_cluster(query), size=size),
    )
    return pipeline


@agent.tool
def opportunity_table(
    ctx: RunContext[Session],
    status: Status | None = Status.active,
    cluster: Cluster | None = None,
    opportunity_type: OpportunityType | None = None,
    sort: Literal["deal_value", "close_date", "probability", "weighted"] = "deal_value",
    descending: bool = True,
    limit: Annotated[int, Field(ge=1, le=50)] = 20,
    whole_company: bool = False,
    closed_from: str | None = None,
    closed_to: str | None = None,
) -> dict[str, Any]:
    """Deal-level opportunity rows, paginated and sorted in the database.

    Filtering this table never changes any other block on screen.
    """
    ctx.deps.step("Listing opportunities")
    period = Period(from_month=closed_from, to_month=closed_to) if closed_from and closed_to else None
    query = OpportunityQuery(
        status=status,
        cluster=cluster,
        partner=None if whole_company else ctx.deps.partner,
        opportunity_type=opportunity_type,
        closed_between=period,
        sort=sort,
        descending=descending,
        limit=limit,
    )
    result = Q.list_opportunities(query)
    title = f"{status.value if status else 'All'} opportunities" + (f" · {cluster.value}" if cluster else "")

    def rebuild() -> Block:
        again = Q.list_opportunities(query)
        return B.deal_table(again["deals"], total=again["total"], title=title)

    ctx.deps.emit(B.deal_table(result["deals"], total=result["total"], title=title), refresh=rebuild)
    return {
        "total_matching": result["total"],
        "shown": len(result["deals"]),
        "deals": [d.model_dump() for d in result["deals"]],
    }


@agent.tool
def compare_revenue(
    ctx: RunContext[Session],
    current_from: str,
    current_to: str,
    previous_from: str,
    previous_to: str,
    by_cluster: bool = False,
    whole_company: bool = False,
) -> list[dict[str, Any]]:
    """Compare two periods of recorded revenue, with absolute and percentage
    change. Percentage is undefined where the base is zero."""
    ctx.deps.step(f"Comparing two periods: {current_from}…{current_to} vs {previous_from}…{previous_to}")
    query = ComparisonQuery(
        current=Period(from_month=current_from, to_month=current_to),
        previous=Period(from_month=previous_from, to_month=previous_to),
        partner=None if whole_company else ctx.deps.partner,
        by_cluster=by_cluster,
    )
    rows = Q.compare_periods(query)
    title = f"{current_from}…{current_to} vs {previous_from}…{previous_to}"
    chart = B.comparison_chart(rows, by_cluster=by_cluster, title=f"Recorded revenue · {title}")
    if chart is not None:
        ctx.deps.emit(
            chart,
            refresh=lambda: B.comparison_chart(
                Q.compare_periods(query), by_cluster=by_cluster, title=f"Recorded revenue · {title}"
            ),
        )
    ctx.deps.emit(B.comparison_table(rows, title=title))
    return rows[: settings().max_rows]


@agent.tool
def top_customers(
    ctx: RunContext[Session],
    from_month: str,
    to_month: str,
    limit: Annotated[int, Field(ge=1, le=20)] = 5,
) -> dict[str, Any]:
    """The accounts with the most recorded revenue in a period, with their
    cluster split."""
    ctx.deps.step(f"Ranking accounts by revenue: top {limit}")
    result = Q.top_customers_by_revenue(
        TopCustomersQuery(period=Period(from_month=from_month, to_month=to_month), limit=limit)
    )
    title = f"Top {limit} accounts by recorded revenue · {from_month}…{to_month}"
    query = TopCustomersQuery(period=Period(from_month=from_month, to_month=to_month), limit=limit)
    ctx.deps.emit(
        B.top_customers_chart(result, block_id="top-customers", title=title),
        refresh=lambda: B.top_customers_chart(
            Q.top_customers_by_revenue(query), block_id="top-customers", title=title
        ),
    )
    return result


@agent.tool
def recommend_deals(ctx: RunContext[Session], limit: Annotated[int, Field(ge=1, le=5)] = 3,
                    whole_company: bool = False) -> list[dict[str, Any]]:
    """Active deals to prioritize, ranked by an explainable score. Returns the
    reasons behind each rank — use them, do not invent your own."""
    ctx.deps.step("Scoring active deals")
    items = Q.recommend_active_deals(
        RecommendQuery(partner=None if whole_company else ctx.deps.partner, limit=limit)
    )
    ctx.deps.emit(B.recommendations(items))
    return [{"deal": r.deal.model_dump(), "score": r.score, "reasons": r.reasons} for r in items]


@agent.tool
def deal_detail(ctx: RunContext[Session], deal: str) -> dict[str, Any]:
    """One deal as it is stored right now: its product lines and its current
    status, probability and close date. Use this to verify a saved change."""
    ctx.deps.step(f"Reading deal {deal}")
    lines = Q.deal_lines(deal)
    if not lines:
        raise ModelRetry(f"No opportunity {deal}.")
    return {
        "deal": deal,
        "stored_now": Q.deal_state(deal),
        "lines": [line.model_dump() for line in lines],
    }


@agent.tool
async def research_context(ctx: RunContext[Session], topic: str) -> dict[str, Any]:
    """Public web context for the selected account: security, service continuity,
    technology lifecycle or regulatory, as dated claims with source URLs. Use it
    only when the user asks for outside context — it is not a database tool and
    it cannot tell you anything about this account's deals or revenue."""
    ctx.deps.step(f"Researching public sources: {topic}")
    block = await run_research("account", topic, ctx.deps.partner_name, block_id="research")
    ctx.deps.emit(block)
    report = block.report
    # Narrow on purpose: the model gets the claims and where they came from, not
    # the pages behind them. Everything a reader needs is already in the block.
    return {
        "public_research": True,
        "about": block.about,
        "accessed": str(block.accessed),
        "scope": report.scope,
        "findings": [
            {
                "claim": f.claim,
                "category": f.category,
                "publisher": f.source.publisher,
                "published": f.source.published,
                "url": f.source.url,
                "ask_them": f.question,
            }
            for f in report.findings
        ],
        "topics": report.topics,
        "nothing_found_for": report.gaps,
        "reminder": (
            "These are public claims, not database facts, and none of them is evidence "
            "that this customer is affected. Keep them labelled as research."
        ),
    }


@agent.tool
def show_limitation(ctx: RunContext[Session], what_was_asked: str) -> str:
    """Render the 'not in the data' note. Use it instead of inventing an answer."""
    ctx.deps.step("Checking what the data holds")
    ctx.deps.emit(B.limitation(what_was_asked))
    return "Limitation shown."


# ─────────────────────── the write path (guarded) ──────────────────────


def _staged(preview: Any, intent: str) -> dict[str, Any]:
    """What a preview tool hands back to the model.

    Deliberately shaped as a report rather than a next step: the pending id is
    in it because the model may have to name the decision, never because the
    model may act on it.
    """
    return {
        **preview.model_dump(),
        "intent": intent,
        "written": False,
        "next": (
            "Nothing has been saved. Tell the user what the card shows and ask them to "
            "confirm or cancel. Do not call another tool in this turn."
        ),
    }


@agent.tool
def move_deal_forward(
    ctx: RunContext[Session],
    deal: str,
    status: Status | None = None,
    win_probability_percent: Annotated[int | None, Field(ge=0, le=100)] = None,
    close_date: str | None = None,
) -> dict[str, Any]:
    """Stage the decision to move a deal forward. WRITES NOTHING.

    Status, win probability and close date together — pass the ones the decision
    changes and leave the rest out. They are applied in one transaction, so the
    deal is never half-advanced.

    A Won deal carries 100% probability and a Lost one 0%: pass the status alone
    and the preview fills that in and says that it did. Then stop and ask the
    user to confirm or cancel.
    """
    parts = [
        f"status {status.value}" if status else None,
        f"probability {win_probability_percent}%" if win_probability_percent is not None else None,
        f"close date {close_date}" if close_date else None,
    ]
    intent = f"Move deal {deal} forward: " + ", ".join(p for p in parts if p)
    ctx.deps.step(f"Previewing the change to deal {deal}")
    try:
        request = AdvanceRequest(
            deal=deal,
            status=status,
            win_probability_percent=win_probability_percent,
            close_date=close_date,
        )
    except ValidationError as exc:
        raise ModelRetry(f"That advance is not valid: {exc.errors()[0]['msg']}") from exc
    try:
        preview = Q.preview_deal_advance(request)
    except LookupError as exc:
        raise ModelRetry(str(exc)) from exc
    ctx.deps.emit(B.preview_card(preview, intent=intent))
    return _staged(preview, intent)


@agent.tool
def preview_deal_update(ctx: RunContext[Session], deal: str, field: EditableField, value: str) -> dict[str, Any]:
    """Show what a one-field change WOULD do. Writes nothing.

    The same guarded path as move_deal_forward, for "set the close date to X".
    After calling this, stop and ask the user to confirm or cancel.
    """
    ctx.deps.step(f"Previewing the change to deal {deal}")
    try:
        preview = Q.preview_deal_update(UpdateRequest(deal=deal, field=field, value=value))
    except (LookupError, ValidationError) as exc:
        raise ModelRetry(str(exc)) from exc
    intent = f"Change {field.value.replace('_', ' ')} of deal {deal} to {value}"
    ctx.deps.emit(B.preview_card(preview, intent=intent))
    return _staged(preview, intent)


@agent.tool
def apply_deal_update(ctx: RunContext[Session], pending_id: str) -> dict[str, Any]:
    """Save a previewed change to every product line of the deal. Only call this
    after the user has explicitly confirmed."""
    ctx.deps.step("Saving the confirmed change")
    try:
        result = Q.apply_deal_update(pending_id)
    except LookupError as exc:
        raise ModelRetry(str(exc)) from exc
    ctx.deps.dashboard.drop(f"preview-{pending_id}")
    # Every block that knows how to rebuild itself does so — the write touched
    # the deal's lines, and which blocks read those lines is not something to
    # guess at from here.
    rebuilt = ctx.deps.rebuild([b.id for b in ctx.deps.dashboard.blocks if b.id in ctx.deps.recipes])
    for block in rebuilt:
        ctx.deps.fresh.append(block)
    return {
        **result.model_dump(),
        "saved": True,
        "summary": result.summary,
        "refreshed": [b.id for b in rebuilt],
    }


@agent.tool
def cancel_deal_update(ctx: RunContext[Session], pending_id: str) -> dict[str, Any]:
    """Discard a pending change. No write happens — not now, not earlier."""
    ctx.deps.step("Discarding the pending change")
    dropped = Q.cancel_deal_update(pending_id)
    ctx.deps.dashboard.drop(f"preview-{pending_id}")
    return {"cancelled": dropped, "written": False, "say": "Cancelled. No changes were saved."}
