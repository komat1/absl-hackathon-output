"""The contract between the three layers.

Tool inputs and outputs, and the UI block spec the agent is allowed to emit.
This file is the only coupling point between the database work, the agent work
and the frontend work — the TypeScript mirror lives in web/src/types/blocks.ts.
Change it deliberately, and change both sides.
"""
from __future__ import annotations

import re
from datetime import date
from enum import StrEnum
from typing import Annotated, Literal, Sequence

from pydantic import BaseModel, Field, field_validator, model_validator

# ───────────────────────────── vocabulary ──────────────────────────────


class Cluster(StrEnum):
    connectivity = "Connectivity"
    cloud = "Cloud Services"
    security = "Security"
    workplace = "Workplace & Communications"


class Status(StrEnum):
    active = "Active"
    won = "Won"
    lost = "Lost"


class OpportunityType(StrEnum):
    new_business = "New Business"
    renewal = "Renewal"
    upsell = "Upsell"


class EditableField(StrEnum):
    """The only three things a confirmed update may touch.

    Prices and recorded revenue are read-only in this exercise, and the brief
    says a status or close-date edit does not recalculate historical revenue.
    """

    status = "won_lost_active_status"
    close_date = "close_date"
    win_probability = "win_probability_percent"


Month = Annotated[str, Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$", examples=["2026-01"])]
DealId = Annotated[str, Field(min_length=1, max_length=40, pattern=r"^[0-9A-Za-z_-]+$")]
PartnerId = Annotated[str, Field(min_length=1, max_length=40, pattern=r"^[0-9A-Za-z_-]+$")]


class Period(BaseModel):
    """An inclusive month range. Both ends are required: a half-open period is
    how "January–October 2026" silently becomes "everything since January"."""

    from_month: Month
    to_month: Month

    @field_validator("to_month")
    @classmethod
    def ordered(cls, value: str, info) -> str:
        start = info.data.get("from_month")
        if start and value < start:
            raise ValueError("to_month is before from_month")
        return value

    @property
    def bounds(self) -> tuple[int, int, int, int]:
        y1, m1 = (int(p) for p in self.from_month.split("-"))
        y2, m2 = (int(p) for p in self.to_month.split("-"))
        return y1, m1, y2, m2

    def label(self) -> str:
        return f"{self.from_month} … {self.to_month}"


# ───────────────────────────── tool inputs ─────────────────────────────


class CustomerQuery(BaseModel):
    name: str = Field(min_length=2, max_length=80, description="Full or partial company name")
    limit: int = Field(default=5, ge=1, le=20)


class AccountQuery(BaseModel):
    partner: PartnerId
    period: Period


class RevenueQuery(BaseModel):
    period: Period
    partner: PartnerId | None = None
    by_cluster: bool = False


class PipelineQuery(BaseModel):
    partner: PartnerId | None = None
    status: Status = Status.active
    #: Whether a cluster's figure counts only the matching product lines, or the
    #: full value of every deal that contains such a line. The brief asks for the
    #: answer to say which — so the caller has to choose.
    basis: Literal["lines", "full_deals"] = "lines"


class OpportunityQuery(BaseModel):
    status: Status | None = None
    cluster: Cluster | None = None
    partner: PartnerId | None = None
    opportunity_type: OpportunityType | None = None
    closed_between: Period | None = None
    sort: Literal["deal_value", "close_date", "probability", "weighted"] = "deal_value"
    descending: bool = True
    limit: int = Field(default=20, ge=1, le=100)
    offset: int = Field(default=0, ge=0, le=10_000)


class ComparisonQuery(BaseModel):
    current: Period
    previous: Period
    partner: PartnerId | None = None
    partners: list[PartnerId] | None = Field(default=None, max_length=20)
    by_cluster: bool = False


class TopCustomersQuery(BaseModel):
    period: Period
    limit: int = Field(default=5, ge=1, le=20)
    by_cluster: bool = True


class RecommendQuery(BaseModel):
    partner: PartnerId | None = None
    limit: int = Field(default=3, ge=1, le=10)


class UpdateRequest(BaseModel):
    """One field of one deal. Sugar over `AdvanceRequest` for "set X to Y"."""

    deal: DealId
    field: EditableField
    value: str = Field(max_length=40)

    def as_advance(self) -> "AdvanceRequest":
        field_name = {
            EditableField.status: "status",
            EditableField.close_date: "close_date",
            EditableField.win_probability: "win_probability_percent",
        }[self.field]
        return AdvanceRequest(deal=self.deal, **{field_name: self.value})

    @field_validator("value")
    @classmethod
    def plausible(cls, value: str, info) -> str:
        field = info.data.get("field")
        if field == EditableField.win_probability:
            number = int(value)
            if not 0 <= number <= 100:
                raise ValueError("probability must be 0–100")
        elif field == EditableField.close_date:
            date.fromisoformat(value)
        elif field == EditableField.status:
            Status(value)
        return value


class AdvanceRequest(BaseModel):
    """The decision to move a deal forward: one to three fields, one transaction.

    This is the only shape a write takes. A single-field edit is this model with
    one field set, so there is one guarded write path rather than two — see
    `UpdateRequest.as_advance`.
    """

    deal: DealId
    status: Status | None = None
    win_probability_percent: int | None = Field(default=None, ge=0, le=100)
    close_date: str | None = None
    #: Set by the validator below when it supplied the probability itself, so
    #: the confirmation card can say why a field the user never named is in the
    #: list. Callers leave it alone.
    probability_derived: bool = False

    @field_validator("close_date")
    @classmethod
    def iso_date(cls, value: str | None) -> str | None:
        if value is not None:
            date.fromisoformat(value)
        return value

    @model_validator(mode="after")
    def coherent(self) -> "AdvanceRequest":
        if self.status is None and self.win_probability_percent is None and self.close_date is None:
            raise ValueError("An advance has to change status, win probability or close date.")
        # The brief pins probability to the outcome: Won is 100, Lost is 0,
        # Active is 0–99. Where the caller named an outcome and left probability
        # out, fill it in — the preview shows it before anything is written, so
        # the user still sees and confirms the whole change. Where the caller
        # asked for a combination the data forbids, refuse it instead.
        if self.status is Status.won:
            if self.win_probability_percent is None:
                self.win_probability_percent, self.probability_derived = 100, True
            elif self.win_probability_percent != 100:
                raise ValueError("A Won deal carries 100% win probability.")
        elif self.status is Status.lost:
            if self.win_probability_percent is None:
                self.win_probability_percent, self.probability_derived = 0, True
            elif self.win_probability_percent != 0:
                raise ValueError("A Lost deal carries 0% win probability.")
        elif self.status is Status.active and self.win_probability_percent == 100:
            raise ValueError("An Active deal carries 0–99% win probability; 100 means Won.")
        return self

    def changes(self) -> dict[EditableField, str]:
        """The fields to write, in a fixed order, as SQL-bound strings."""
        out: dict[EditableField, str] = {}
        if self.status is not None:
            out[EditableField.status] = self.status.value
        if self.win_probability_percent is not None:
            out[EditableField.win_probability] = str(self.win_probability_percent)
        if self.close_date is not None:
            out[EditableField.close_date] = self.close_date
        return out


# ──────────────────────────── tool outputs ─────────────────────────────


class Customer(BaseModel):
    partner: str
    name: str
    deals: int
    revenue_total: float


class DealLine(BaseModel):
    product_name: str
    cluster: str
    total_price_eur: float


class Deal(BaseModel):
    deal: str
    partner: str
    name: str
    status: str
    opportunity_type: str
    deal_value_eur: float
    win_probability_percent: int
    weighted_value_eur: float
    close_date: str
    line_count: int
    clusters: list[str]
    overdue: bool = False


class Recommendation(BaseModel):
    deal: Deal
    score: float
    #: Named contributions, so the agent can explain the ranking instead of
    #: asserting it.
    reasons: list[str]


class FieldChange(BaseModel):
    """One field of a pending decision: what is stored, what would replace it.

    `old_values` is a list because the lines of a deal are read individually —
    if they ever disagreed, the card has to show that rather than hide it behind
    a single value.
    """

    field: EditableField
    old_values: list[str]
    new_value: str
    #: True where the stored value already equals the new one. Shown struck
    #: through rather than dropped: "nothing to do here" is information.
    unchanged: bool = False


class AdvancePreview(BaseModel):
    """What a write WOULD do. Produced by read-only queries; holds no lock,
    opens no transaction and performs no write. `pending_id` is the only way to
    reach the write, and it is handed to a human, not to the model."""

    pending_id: str
    deal: str
    name: str
    changes: list[FieldChange] = Field(min_length=1, max_length=3)
    affected_lines: int
    expires_at: str
    #: The stored row as it is right now, so the card states the decision
    #: against reality instead of against what the conversation remembers.
    stored_now: dict[str, str | int | float | None] = Field(default_factory=dict)
    deal_value_eur: float = 0.0
    #: Weighted pipeline before and after — what saying yes does to the number
    #: the account manager is measured on. A deal leaving Active weighs 0.
    weighted_before_eur: float = 0.0
    weighted_after_eur: float = 0.0
    leaves_active_pipeline: bool = False
    #: Why a field the user did not name is in the list (Won implies 100%).
    derived_note: str | None = None


class AppliedChange(BaseModel):
    field: EditableField
    old_value: str | None
    new_value: str


class UpdateResult(BaseModel):
    deal: str
    applied: list[AppliedChange]
    rows_affected: int
    #: One audit row per field, all written in the transaction that made the
    #: change, so they share `changed_at` — that is what groups them into one
    #: recorded decision in /api/audit.
    audit_ids: list[int]

    @property
    def summary(self) -> str:
        return ", ".join(f"{c.field.value} = {c.new_value}" for c in self.applied)


# ───────────────────── UI blocks (the generated view) ──────────────────
# The agent picks blocks and fills validated settings. It never sends code, and
# it never sends more rows than a human would read.

BlockTone = Literal["good", "bad", "warn", "info", "neutral"]
ValueFormat = Literal["number", "money", "percent", "date"]


class StatItem(BaseModel):
    label: str
    value: float | str
    format: ValueFormat = "number"
    sublabel: str | None = None
    delta_percent: float | None = None
    tone: BlockTone = "neutral"


class StatsBlock(BaseModel):
    type: Literal["stats"] = "stats"
    id: str
    title: str | None = None
    items: list[StatItem] = Field(max_length=6)


class Column(BaseModel):
    key: str
    label: str
    type: Literal["text", "number", "money", "percent", "date", "badge"] = "text"
    align: Literal["left", "right"] | None = None


class TableBlock(BaseModel):
    type: Literal["table"] = "table"
    id: str
    title: str | None = None
    columns: list[Column] = Field(max_length=12)
    rows: list[dict[str, float | int | str | bool | None]] = Field(max_length=100)
    total_rows: int | None = None
    note: str | None = None


#: Every chart the agent may ask for. One per job a sales question actually has
#: — see CHART_JOBS for which answers which, and the system prompt for the rule
#: the model follows when it picks.
ChartKind = Literal[
    "line",             # a measure over time
    "area",             # one measure over time, volume reading
    "bar",              # compare a measure across a few named things
    "stacked-bar",      # a split over time, or several wholes side by side
    "horizontal-bar",   # a ranking, or long labels (company names)
    "combo",            # two measures in the SAME unit: bars + a line
    "pie",              # a split at a glance; ranked bars usually beat it
    "funnel",           # stage-by-stage drop-off through the sales phases
    "scatter",          # two dimensions per deal — value against probability
    "waterfall",        # what carried a total from one period to the next
    "heatmap",          # a grid: category against month
]

#: What each kind is for, in one line. Handed to the model so "show me that as a
#: funnel" is a choice between documented forms rather than a guess.
CHART_JOBS: dict[str, str] = {
    "line": "a measure over time, one or more series",
    "area": "a single measure over time, read as volume",
    "bar": "compare one measure across a few named categories",
    "stacked-bar": "how a total splits, over time or across categories",
    "horizontal-bar": "a ranking, or any chart whose labels are company names",
    "combo": "two measures in the same unit — bars plus a line, one shared axis",
    "pie": "a split at a glance; prefer horizontal-bar to compare the parts",
    "funnel": "drop-off from one sales phase to the next",
    "scatter": "one point per deal: value against win probability",
    "waterfall": "the bridge from a previous total to a current one",
    "heatmap": "a category-by-month grid of one measure",
}


class Series(BaseModel):
    key: str
    name: str
    #: combo only: how this series is drawn. Every series of a combo shares one
    #: y-axis, so they must share a unit — a second y-scale is not available
    #: here on purpose. Two measures of different magnitude are two charts.
    draw: Literal["bar", "line"] | None = None
    #: Pin a series to a meaning rather than to its position in the palette, so
    #: a filter that drops a series cannot repaint the ones that remain.
    tone: BlockTone | None = None


class ChartReference(BaseModel):
    """A line to read the data against: the reference date, an average, a target."""

    axis: Literal["x", "y"] = "y"
    value: float | str
    label: str
    tone: BlockTone = "neutral"


class ChartBlock(BaseModel):
    type: Literal["chart"] = "chart"
    id: str
    chart: ChartKind = "line"
    title: str | None = None
    x_key: str = "x"
    series: list[Series] = Field(max_length=8)
    data: list[dict[str, float | int | str | None]] = Field(max_length=400)
    format: ValueFormat = "money"
    note: str | None = None

    #: scatter: the second dimension, and what sizes a point.
    y_key: str | None = None
    size_key: str | None = None
    #: scatter: which row value colours a point. heatmap: which one makes a row.
    group_key: str | None = None
    #: scatter: what names a point in the tooltip.
    label_key: str | None = None
    #: The unit of y_key where it differs from `format` — a scatter plots money
    #: against percent, which is two dimensions of one point, not two y-scales.
    y_format: ValueFormat | None = None
    #: scatter/heatmap: what each value of group_key means, so a class is drawn
    #: in the colour of its state rather than in the next free palette hue.
    group_tones: dict[str, BlockTone] = Field(default_factory=dict)
    references: list[ChartReference] = Field(default_factory=list, max_length=3)
    #: horizontal-bar only: stack the series into one bar per row — a ranking
    #: whose bars are also a split (top accounts, by cluster).
    stacked: bool = False
    #: How much of the dashboard row the chart takes. Two consecutive halves sit
    #: side by side; a compact form (a donut, a short ranking) does not need the
    #: full width and reads better next to its companion.
    size: Literal["full", "half"] = "full"

    @model_validator(mode="after")
    def renderable(self) -> "ChartBlock":
        """Refuse a chart the client could not draw.

        The browser renders a predefined component from this spec, so a spec that
        does not carry what its component needs has to fail here — on the server,
        where it is a validation error — and not there, as a blank panel.
        """
        if not self.series:
            raise ValueError("a chart needs at least one series")
        single = {"pie", "funnel", "waterfall", "heatmap", "scatter"}
        if self.chart in single and len(self.series) != 1:
            raise ValueError(f"a {self.chart} chart carries exactly one series")
        if self.chart == "scatter":
            if not self.y_key:
                raise ValueError("a scatter chart needs y_key")
            if self.group_key and len({row.get(self.group_key) for row in self.data}) > 3:
                # Colour read in all pairs at once stops being separable past
                # three classes; fold the tail together instead of adding hues.
                raise ValueError("a scatter groups into at most 3 colours — fold the rest together")
        if self.stacked and self.chart != "horizontal-bar":
            raise ValueError("stacked belongs to a horizontal-bar; a vertical stack is chart='stacked-bar'")
        if self.chart == "heatmap" and not self.group_key:
            raise ValueError("a heatmap needs group_key for its rows")
        if self.chart == "waterfall":
            # Each row is a step of the bridge: a delta, or one of the two
            # totals it runs between. `base` is the transparent offset the step
            # floats on, so the client stacks rather than recomputes.
            for row in self.data:
                if row.get("kind") not in (None, "total", "delta"):
                    raise ValueError("a waterfall row is kind 'total' or 'delta'")
        if self.chart == "combo":
            if any(s.draw is None for s in self.series):
                raise ValueError("every series of a combo says draw='bar' or draw='line'")
            kinds = {s.draw for s in self.series}
            if kinds != {"bar", "line"}:
                raise ValueError("a combo needs at least one bar series and one line series")
        elif any(s.draw is not None for s in self.series):
            raise ValueError("series.draw belongs to a combo chart only")
        return self


class CalloutBlock(BaseModel):
    type: Literal["callout"] = "callout"
    id: str
    tone: BlockTone = "info"
    title: str
    body: str
    #: Facts the statement rests on. Empty means "this is a judgement call".
    evidence: list[str] = Field(default_factory=list, max_length=8)


class FindingItem(BaseModel):
    title: str
    summary: str
    tone: BlockTone = "info"
    evidence: list[str] = Field(default_factory=list, max_length=6)
    next_step: str | None = None


class FindingsBlock(BaseModel):
    type: Literal["findings"] = "findings"
    id: str
    title: str | None = None
    items: list[FindingItem] = Field(max_length=8)


# ─────────────────────────── web research ──────────────────────────────
#
# The one part of this app that does not come from the database. It gets its own
# vocabulary, its own validation and its own block, because a public claim and a
# simulated figure must never arrive in the same shape.

ResearchCategory = Literal[
    "cybersecurity",
    "service-continuity",
    "technology-lifecycle",
    "regulatory",
    "business-context",
]

#: The four risk areas the brief names, plus plain company news. Generated into
#: the research prompt, so a category added here cannot be missing from it.
RESEARCH_CATEGORIES: dict[str, str] = {
    "cybersecurity": "breaches, disclosed vulnerabilities, security posture",
    "service-continuity": "outages, incidents, resilience, supply disruption",
    "technology-lifecycle": "end-of-life dates, migrations, platform changes",
    "regulatory": "rules and deadlines the customer has to meet",
    "business-context": "results, expansion, restructuring, leadership change",
}


class ResearchSource(BaseModel):
    """Where a claim came from. No date, no claim — the brief asks for both."""

    title: str
    url: str
    publisher: str
    #: As published: YYYY-MM-DD, or YYYY-MM when the day is not given.
    published: str

    @field_validator("url")
    @classmethod
    def _real_url(cls, value: str) -> str:
        if not value.startswith(("http://", "https://")):
            raise ValueError("a source needs a real http(s) URL, not a description")
        return value

    @field_validator("published")
    @classmethod
    def _real_date(cls, value: str) -> str:
        """Require a date; accept the shapes a page actually prints it in.

        The brief asks for a publication date on every claim, so a finding
        without one is rejected. But rejecting "May 2026" because it is not
        "2026-05" throws away a good finding over formatting, and a rejected
        report costs a whole extra model pass — so the common forms are
        normalised here rather than argued about in the prompt.
        """
        raw = value.strip()
        if match := re.match(r"^(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2}))?", raw):
            year, month, day = match.group(1), int(match.group(2)), match.group(3)
            if not 1 <= month <= 12:
                raise ValueError("published has an impossible month")
            return f"{year}-{month:02d}" + (f"-{int(day):02d}" if day else "")
        # "12 May 2026", "May 12, 2026", "May 2026"
        months = {m: i for i, m in enumerate(
            ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], start=1)}
        words = re.findall(r"[A-Za-z]+|\d+", raw)
        month_no = next((months[w[:3].lower()] for w in words if w[:3].lower() in months), None)
        year_no = next((w for w in words if len(w) == 4 and w.isdigit()), None)
        if month_no and year_no:
            day_no = next((w for w in words if w.isdigit() and len(w) <= 2), None)
            return f"{year_no}-{month_no:02d}" + (f"-{int(day_no):02d}" if day_no else "")
        raise ValueError(
            "published must carry a real publication date (YYYY-MM-DD or YYYY-MM) read off the page"
        )


class ResearchFinding(BaseModel):
    """One dated public claim, and what it might mean for the conversation.

    The fields are kept apart on purpose. `claim` is what the source says;
    `implication` is what WE think it could mean; `question` is what the account
    manager has to ask, because neither the source nor the dataset can tell us
    whether this customer is actually affected.
    """

    claim: str
    category: ResearchCategory
    source: ResearchSource
    implication: str
    question: str
    next_step: str
    tone: BlockTone = "info"


class ProspectCandidate(BaseModel):
    """A company that resembles an account we already sell to.

    A research suggestion and nothing else: no deal value, no probability, no
    score, and no row anywhere near the database.
    """

    company: str
    why: str
    opener: str
    sources: list[ResearchSource] = Field(default_factory=list, max_length=3)


class ResearchReport(BaseModel):
    """What the researcher must produce before anything can be rendered.

    A validated object, not prose with links in it. A finding whose source has
    no date fails here, which is the only reason the dates on screen can be
    trusted.
    """

    #: What was actually researched, in one line — the scope the reader is owed.
    scope: str
    summary: str
    findings: list[ResearchFinding] = Field(default_factory=list, max_length=8)
    candidates: list[ProspectCandidate] = Field(default_factory=list, max_length=6)
    #: Things worth raising in the meeting, each drawn from a finding above.
    topics: list[str] = Field(default_factory=list, max_length=5)
    #: What no dated public source was found for. An empty answer is an answer.
    gaps: list[str] = Field(default_factory=list, max_length=5)


class ResearchBlock(BaseModel):
    """Public research, rendered as a block like any other.

    It carries its own access date and names the account it is about, because
    this is the one place in the app where real public facts sit next to
    invented business data — the screen has to say which is which.
    """

    type: Literal["research"] = "research"
    id: str
    title: str
    report: ResearchReport
    #: When we looked. The brief asks for it alongside the publication date.
    accessed: date
    #: The account this is about, where it is about one at all.
    about: str | None = None
    #: What the researcher ran on, for the trace line under the block.
    searched: int = 0


class PreviewBlock(BaseModel):
    """The confirmation card. The only block with buttons that change data."""

    type: Literal["preview"] = "preview"
    id: str
    preview: AdvancePreview
    #: What the user asked for in their own terms — "move this deal forward" vs
    #: "change the close date". The card leads with it so the person confirms a
    #: decision they recognize, not a diff they have to reverse-engineer.
    intent: str | None = None


Block = Annotated[
    StatsBlock | TableBlock | ChartBlock | CalloutBlock | FindingsBlock | PreviewBlock | ResearchBlock,
    Field(discriminator="type"),
]


class Dashboard(BaseModel):
    """The current generated view. Follow-up prompts patch this, they do not
    rebuild it — that is what keeps a filter on one block from moving another."""

    blocks: list[Block] = Field(default_factory=list, max_length=12)

    def replace(self, block: Block) -> None:
        for index, existing in enumerate(self.blocks):
            if existing.id == block.id:
                self.blocks[index] = block
                return
        self.blocks.append(block)

    def drop(self, block_id: str) -> bool:
        before = len(self.blocks)
        self.blocks = [b for b in self.blocks if b.id != block_id]
        return len(self.blocks) < before


def coerce_blocks(items: Sequence[object]) -> list[Block]:
    return [b for b in items if isinstance(b, BaseModel)]  # type: ignore[misc]
