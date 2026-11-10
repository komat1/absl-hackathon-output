"""Query results → UI blocks.

The agent chooses WHICH block to show and with what settings; this module is the
only place that builds one. Numbers are passed through untouched — formatting is
the frontend's job, so a figure is never rounded twice.
"""
from __future__ import annotations

from typing import Any, Sequence

from .contracts import (
    AdvancePreview,
    CalloutBlock,
    ChartBlock,
    ChartKind,
    ChartReference,
    Column,
    Deal,
    FindingItem,
    FindingsBlock,
    PreviewBlock,
    Recommendation,
    Series,
    StatItem,
    StatsBlock,
    TableBlock,
)

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def month_label(year: int, month: int) -> str:
    return f"{MONTHS[month - 1]} {str(year)[2:]}"


def revenue_cards(briefing: dict[str, Any], block_id: str = "revenue-cards") -> StatsBlock:
    clusters = briefing["revenue_by_cluster"]
    top = clusters[0] if clusters else None
    deals = {row["status"]: row for row in briefing["deals_by_status"]}
    active = deals.get("Active", {"deals": 0, "value": 0.0})
    return StatsBlock(
        id=block_id,
        title=f"{briefing['name']} · recorded revenue {briefing['period']}",
        items=[
            StatItem(label="Recorded revenue", value=briefing["revenue_in_period"], format="money"),
            StatItem(
                label="Strongest cluster",
                value=top["revenue"] if top else 0,
                format="money",
                sublabel=top["cluster"] if top else "no revenue in period",
            ),
            StatItem(label="Open deals", value=active["deals"], format="number", sublabel="Active opportunities"),
            StatItem(label="Open pipeline", value=active["value"], format="money", sublabel="unweighted"),
        ],
    )


def revenue_chart(
    series_rows: Sequence[dict[str, Any]],
    *,
    block_id: str = "revenue-chart",
    chart: ChartKind = "bar",
    by_cluster: bool = False,
    title: str = "Monthly recorded revenue",
) -> ChartBlock:
    """Monthly recorded revenue, in whichever form the question called for.

    One measure over time has several honest readings — the months themselves,
    the months against their own average, the cluster split, the cluster grid —
    and they are settings on one block rather than four different blocks, so
    "show that as a heatmap" keeps the same data and the same scope.
    """
    if chart == "heatmap":
        return revenue_heatmap(series_rows, block_id=block_id, title=title)

    if by_cluster:
        clusters = sorted({row["cluster"] for row in series_rows})
        buckets: dict[str, dict[str, Any]] = {}
        for row in series_rows:
            key = month_label(row["year"], row["month_num"])
            buckets.setdefault(key, {"x": key})[row["cluster"]] = row["revenue"]
        data = list(buckets.values())
        series = [Series(key=c, name=c) for c in clusters]
        # A combo needs two series in one unit; a cluster split is many series
        # in one unit, which is a stack.
        if chart == "combo":
            chart = "stacked-bar"
        return ChartBlock(id=block_id, chart=chart, title=title, series=series, data=data, format="money")

    data = [
        {
            "x": month_label(row["year"], row["month_num"]),
            "revenue": row["revenue"],
            "trend_3m": row.get("trend_3m"),
        }
        for row in series_rows
    ]
    if chart == "combo" and any(row["trend_3m"] is not None for row in data):
        series = [
            Series(key="revenue", name="Recorded revenue", draw="bar"),
            Series(key="trend_3m", name="3-month average", draw="line"),
        ]
    else:
        if chart == "combo":
            chart = "bar"
        series = [Series(key="revenue", name="Recorded revenue")]

    # The benchmark is the database's own average over the period, not a target
    # someone invented — the only line a reader can hold the bars against.
    average = series_rows[0].get("period_avg") if series_rows else None
    references = (
        [ChartReference(axis="y", value=average, label="Average month", tone="neutral")]
        if average is not None and chart in {"bar", "line", "area", "combo"}
        else []
    )
    return ChartBlock(
        id=block_id,
        chart=chart,
        title=title,
        series=series,
        data=data,
        format="money",
        references=references,
    )


def revenue_heatmap(
    series_rows: Sequence[dict[str, Any]],
    *,
    block_id: str = "revenue-heatmap",
    title: str = "Recorded revenue by cluster and month",
) -> ChartBlock:
    """A cluster-by-month grid. Magnitude read as depth of one colour, which is
    the one encoding that stays readable across forty cells."""
    if series_rows and "cluster" not in series_rows[0]:
        raise ValueError("a heatmap needs revenue rows split by cluster")
    return ChartBlock(
        id=block_id,
        chart="heatmap",
        title=title,
        x_key="x",
        group_key="cluster",
        series=[Series(key="revenue", name="Recorded revenue")],
        data=[
            {
                "x": month_label(row["year"], row["month_num"]),
                "cluster": row["cluster"],
                "revenue": row["revenue"],
            }
            for row in series_rows
        ],
        format="money",
        note="A zero month is an empty cell, not missing data — the dataset carries every month.",
    )


def ranking_chart(
    rows: Sequence[dict[str, Any]],
    *,
    label_key: str,
    value_key: str,
    block_id: str,
    title: str,
    series_name: str = "Recorded revenue",
    value_format: str = "money",
    note: str | None = None,
) -> ChartBlock:
    """A ranking as horizontal bars: one hue, largest first.

    Company names do not fit under a vertical bar, and a ranking is a comparison
    of magnitudes rather than a set of identities — so one colour, and the
    labels get the room they need.
    """
    return ChartBlock(
        id=block_id,
        chart="horizontal-bar",
        title=title,
        x_key="x",
        series=[Series(key="value", name=series_name)],
        data=[{"x": str(row[label_key]), "value": row[value_key]} for row in rows],
        format=value_format,  # type: ignore[arg-type]
        note=note,
    )


#: Outcome colours are states, not palette slots — Won reads as good wherever
#: it appears, and a filter that drops Lost cannot repaint Active.
STATUS_TONES = {"Won": "good", "Lost": "bad", "Active": "info"}


def share_donut(
    rows: Sequence[dict[str, Any]],
    *,
    label_key: str,
    value_key: str,
    block_id: str,
    title: str,
    series_name: str,
    value_format: str = "money",
    tones: dict[str, str] | None = None,
    note: str | None = None,
    size: str = "half",
) -> ChartBlock | None:
    """A split at a glance, as a donut. None when there is nothing to split —
    an empty ring is not an answer, and a ring of one slice is not a split."""
    data = [
        {"x": str(row[label_key]), "value": row[value_key]}
        for row in rows
        if row.get(value_key) and float(row[value_key]) > 0
    ]
    if len(data) < 2:
        return None
    return ChartBlock(
        id=block_id,
        chart="pie",
        title=title,
        x_key="x",
        series=[Series(key="value", name=series_name)],
        data=data,
        format=value_format,  # type: ignore[arg-type]
        group_tones=tones or {},  # type: ignore[arg-type]
        note=note,
        size=size,  # type: ignore[arg-type]
    )


def cluster_mix(briefing: dict[str, Any], block_id: str = "revenue-mix") -> ChartBlock | None:
    """Where the account's recorded revenue in the period came from."""
    return share_donut(
        briefing["revenue_by_cluster"],
        label_key="cluster",
        value_key="revenue",
        block_id=block_id,
        title=f"Revenue mix by cluster · {briefing['period']}",
        series_name="Recorded revenue",
    )


def outcome_mix(briefing: dict[str, Any], block_id: str = "deal-outcomes") -> ChartBlock | None:
    """Every deal the account has had, by where it ended up."""
    return share_donut(
        sorted(briefing["deals_by_status"], key=lambda r: ["Active", "Won", "Lost"].index(r["status"])
               if r["status"] in STATUS_TONES else 9),
        label_key="status",
        value_key="deals",
        block_id=block_id,
        title="Deals by outcome · all time",
        series_name="Deals",
        value_format="number",
        tones=STATUS_TONES,
        note="Distinct deals, counted once each whatever their number of product lines.",
    )


def pipeline_mix(pipeline: dict[str, Any], block_id: str = "pipeline-mix") -> ChartBlock | None:
    """Pipeline share by cluster. Only on the `lines` basis: there the clusters
    partition the pipeline, while on `full_deals` a deal spanning two clusters
    is in both slices and the ring would add up to more than the whole."""
    if pipeline["basis"] != "lines":
        return None
    return share_donut(
        pipeline["clusters"],
        label_key="cluster",
        value_key="value",
        block_id=block_id,
        title=f"{pipeline['status']} pipeline mix by cluster",
        series_name="Unweighted value",
        note="Product-line value in each cluster.",
    )


def pipeline_deal_counts(pipeline: dict[str, Any], *, size: str = "half",
                         block_id: str = "pipeline-deals") -> ChartBlock:
    """How many distinct deals touch each cluster — a count, so its own chart."""
    return ChartBlock(
        id=block_id,
        chart="horizontal-bar",
        title=f"{pipeline['status']} deals per cluster",
        x_key="x",
        series=[Series(key="deals", name="Distinct deals")],
        # A ranking reads largest first; the query orders clusters by value.
        data=[
            {"x": row["cluster"], "deals": row["deals"]}
            for row in sorted(pipeline["clusters"], key=lambda r: r["deals"], reverse=True)
        ],
        format="number",
        size=size,  # type: ignore[arg-type]
        note="A deal with lines in two clusters is counted under both.",
    )


def comparison_chart(rows: Sequence[dict[str, Any]], *, by_cluster: bool, title: str,
                     block_id: str = "comparison-chart", limit: int = 12) -> ChartBlock | None:
    """The two periods side by side, previous in neutral and current in colour,
    so the eye reads the current bar against the one it replaced."""
    if not rows:
        return None
    shown = list(rows)[:limit]
    return ChartBlock(
        id=block_id,
        # Account names need the room a horizontal bar gives them.
        chart="bar" if by_cluster else "horizontal-bar",
        title=title,
        x_key="x",
        series=[
            Series(key="previous", name="Previous period", tone="neutral"),
            Series(key="current", name="Current period", tone="info"),
        ],
        data=[
            {
                "x": row.get("label") or str(row["dim"]),
                "previous": row["previous_value"],
                "current": row["current_value"],
            }
            for row in shown
        ],
        format="money",
        note=None if len(rows) <= limit else f"The {limit} largest of {len(rows)} by current revenue; the table has them all.",
    )


def top_customers_chart(result: dict[str, Any], *, block_id: str, title: str) -> ChartBlock:
    """The ranking, with each bar split by cluster: who is biggest, and what
    they are biggest in, in one chart."""
    customers = result["customers"]
    names = {row["partner"]: row["name"] for row in customers}
    clusters = sorted({row["cluster"] for row in result["by_cluster"]})
    if not clusters:
        return ranking_chart(customers, label_key="name", value_key="revenue", block_id=block_id, title=title)
    data: dict[str, dict[str, Any]] = {row["partner"]: {"x": str(row["name"])} for row in customers}
    for row in result["by_cluster"]:
        if row["partner"] in data:
            data[row["partner"]][row["cluster"]] = row["revenue"]
    return ChartBlock(
        id=block_id,
        chart="horizontal-bar",
        stacked=True,
        title=title,
        x_key="x",
        series=[Series(key=c, name=c) for c in clusters],
        data=[data[p] for p in names],
        format="money",
        note="Each bar is the account's recorded revenue in the period, split by cluster.",
    )


def funnel_chart(
    funnel: dict[str, Any],
    *,
    block_id: str = "pipeline-funnel",
    measure: str = "deals",
    title: str | None = None,
) -> ChartBlock:
    """Phase-by-phase drop-off.

    Each stage carries both readings a sales person asks for: what is left of
    the top of the funnel, and what survived the step before it.
    """
    key = "deals" if measure == "deals" else "value"
    return ChartBlock(
        id=block_id,
        chart="funnel",
        title=title or f"{funnel['status']} deals by sales phase",
        x_key="x",
        series=[Series(key="value", name="Deals" if key == "deals" else "Deal value")],
        data=[
            {
                "x": row["phase"],
                "value": row[key],
                "deals": row["deals"],
                "deal_value": row["value"],
                "weighted": row["weighted"],
                "share_of_first": row["share_of_first"],
                "step_retention": row["step_retention"],
            }
            for row in funnel["phases"]
        ],
        format="number" if key == "deals" else "money",
        note=funnel["note"],
    )


def risk_scatter(
    risk: dict[str, Any],
    *,
    block_id: str = "deal-risk-map",
    title: str = "Active deals · value against win probability",
) -> ChartBlock:
    """One point per Active deal: how big, how likely, how urgent.

    Colour carries urgency rather than cluster — three states a reader can tell
    apart at a glance, each with its name in the legend, instead of four hues
    that have to be matched back to a key.
    """
    return ChartBlock(
        id=block_id,
        chart="scatter",
        title=title,
        x_key="value",
        y_key="probability",
        size_key="weighted",
        group_key="urgency",
        label_key="name",
        group_tones={"Overdue": "bad", "Closing soon": "warn", "On track": "info"},
        series=[Series(key="weighted", name="Weighted value")],
        data=[
            {
                "deal": row["deal"],
                "name": row["name"],
                "value": row["value"],
                "probability": row["probability"],
                "weighted": row["weighted"],
                "urgency": row["urgency"],
                "close_date": row["close_date"],
                "opportunity_type": row["opportunity_type"],
            }
            for row in risk["deals"]
        ],
        format="money",
        y_format="percent",
        note=(
            f"{risk['shown']} of {risk['total_active']} Active deals, largest first. "
            "Point size is weighted value — value × probability, a prioritization aid, not a forecast."
        ),
    )


def bridge_chart(bridge: dict[str, Any], *, block_id: str = "revenue-bridge") -> ChartBlock:
    """The waterfall: what carried revenue from one period total to the other.

    The steps float on a transparent base, so each one starts where the last
    finished and the two totals stand on the axis.
    """
    data: list[dict[str, Any]] = [
        {
            "x": bridge["previous_label"],
            "value": bridge["previous_total"],
            "base": 0,
            "span": bridge["previous_total"],
            "kind": "total",
        }
    ]
    running = float(bridge["previous_total"])
    for step in bridge["steps"]:
        delta = float(step["change_abs"])
        if delta >= 0:
            base, span = running, delta
        else:
            base, span = running + delta, -delta
        running += delta
        data.append(
            {
                "x": step["cluster"],
                "value": delta,
                "base": round(base, 2),
                "span": round(span, 2),
                "kind": "delta",
            }
        )
    data.append(
        {
            "x": bridge["current_label"],
            "value": bridge["current_total"],
            "base": 0,
            "span": bridge["current_total"],
            "kind": "total",
        }
    )
    return ChartBlock(
        id=block_id,
        chart="waterfall",
        title=f"Revenue bridge · {bridge['previous_label']} → {bridge['current_label']}",
        x_key="x",
        series=[Series(key="span", name="Change")],
        data=data,
        format="money",
        note="Each step is one cluster's change between the two periods; the end bars are the period totals.",
    )


def switch_chart(block: ChartBlock, chart: ChartKind) -> ChartBlock:
    """Redraw a chart already on screen as a different kind, same data, same scope.

    `draw` means something only on a combo, so it is filled in on the way in and
    dropped on the way out. Everything else is ChartBlock's own validation: a
    chart that cannot carry the new form raises here, where it is an error with
    a reason, rather than in the browser as an empty panel.
    """
    payload = block.model_dump()
    for index, item in enumerate(payload["series"]):
        item["draw"] = ("bar" if index == 0 else "line") if chart == "combo" else None
    payload["chart"] = chart
    if chart != "horizontal-bar":
        payload["stacked"] = False
    return ChartBlock.model_validate(payload)


def pipeline_cards(pipeline: dict[str, Any], block_id: str = "pipeline-cards") -> StatsBlock:
    total = pipeline["total"]
    return StatsBlock(
        id=block_id,
        title=f"{pipeline['status']} pipeline",
        items=[
            StatItem(label="Pipeline value", value=total["value"], format="money", sublabel="unweighted"),
            StatItem(
                label="Weighted pipeline",
                value=total["weighted"],
                format="money",
                sublabel="value × probability — not a forecast",
            ),
            StatItem(label="Distinct deals", value=total["deals"], format="number"),
        ],
    )


def pipeline_chart(
    pipeline: dict[str, Any],
    block_id: str = "pipeline-chart",
    chart: ChartKind = "combo",
) -> ChartBlock:
    """Pipeline per cluster, unweighted against weighted.

    Both are euros, so both sit on one axis and the weighted figure reads as a
    line across the bars it is a share of — "of which, weighted". Two y-scales
    would make the smaller number look as big as the larger one.
    """
    return ChartBlock(
        id=block_id,
        chart=chart,
        title=f"{pipeline['status']} pipeline by cluster",
        series=(
            [
                Series(key="value", name="Unweighted", draw="bar"),
                Series(key="weighted", name="Weighted", draw="line"),
            ]
            if chart == "combo"
            else [Series(key="value", name="Unweighted"), Series(key="weighted", name="Weighted")]
        ),
        data=[{"x": row["cluster"], "value": row["value"], "weighted": row["weighted"]} for row in pipeline["clusters"]],
        format="money",
        note=pipeline["basis_note"],
    )


def deal_table(
    deals: Sequence[Deal],
    *,
    total: int,
    block_id: str = "deal-table",
    title: str = "Opportunities",
    note: str | None = None,
) -> TableBlock:
    return TableBlock(
        id=block_id,
        title=title,
        columns=[
            Column(key="deal", label="Deal"),
            Column(key="name", label="Customer"),
            Column(key="status", label="Status", type="badge"),
            Column(key="clusters", label="Clusters"),
            Column(key="deal_value_eur", label="Deal value", type="money", align="right"),
            Column(key="win_probability_percent", label="Win %", type="percent", align="right"),
            Column(key="weighted_value_eur", label="Weighted", type="money", align="right"),
            Column(key="close_date", label="Close date", type="date"),
        ],
        rows=[
            {
                "deal": d.deal,
                "name": d.name,
                "status": d.status,
                "clusters": ", ".join(d.clusters),
                "deal_value_eur": d.deal_value_eur,
                "win_probability_percent": d.win_probability_percent,
                "weighted_value_eur": round(d.weighted_value_eur, 2),
                "close_date": d.close_date + ("  ⚠ overdue" if d.overdue else ""),
            }
            for d in deals
        ],
        total_rows=total,
        note=note or ("Values are full deal values, not only the matching product lines."),
    )


def comparison_table(rows: Sequence[dict[str, Any]], *, block_id: str = "comparison",
                     title: str = "Period comparison") -> TableBlock:
    return TableBlock(
        id=block_id,
        title=title,
        columns=[
            Column(key="dim", label="Customer / cluster"),
            Column(key="current_value", label="Current", type="money", align="right"),
            Column(key="previous_value", label="Previous", type="money", align="right"),
            Column(key="change_abs", label="Change", type="money", align="right"),
            Column(key="change_percent", label="Change %", type="percent", align="right"),
        ],
        rows=[
            {
                "dim": row.get("label") or str(row["dim"]),
                "current_value": row["current_value"],
                "previous_value": row["previous_value"],
                "change_abs": row["change_abs"],
                # The brief asks for this explicitly: a zero base has no
                # percentage, and printing 0 % or ∞ would be a lie either way.
                "change_percent": "undefined (base 0)" if row["percent_undefined"] else row["change_percent"],
            }
            for row in rows
        ],
        note="A percentage change is undefined where the comparison base is zero.",
    )


def recommendations(items: Sequence[Recommendation], block_id: str = "recommendations") -> FindingsBlock:
    return FindingsBlock(
        id=block_id,
        title="Three Active deals to prioritize",
        items=[
            FindingItem(
                title=f"{r.deal.name} · {r.deal.deal} · €{r.deal.deal_value_eur:,.0f}",
                summary=(
                    f"{r.deal.opportunity_type} at {r.deal.win_probability_percent}% probability, "
                    f"expected close {r.deal.close_date}"
                    + (" — overdue" if r.deal.overdue else "")
                ),
                tone="bad" if r.deal.overdue else "info",
                evidence=r.reasons,
                next_step=(
                    "Chase the decision — the expected close date has passed"
                    if r.deal.overdue
                    else "Confirm the decision date and the remaining open questions"
                ),
            )
            for r in items
        ],
    )


def preview_card(preview: AdvancePreview, intent: str | None = None) -> PreviewBlock:
    """The decision card. `intent` is the decision in the user's own terms, so
    the card leads with what they asked for rather than with a field diff."""
    return PreviewBlock(id=f"preview-{preview.pending_id}", preview=preview, intent=intent)


def limitation(text: str, block_id: str = "limitation") -> CalloutBlock:
    return CalloutBlock(
        id=block_id,
        tone="warn",
        title="Not in the data",
        body=text,
        evidence=["The dataset holds opportunities and monthly revenue only."],
    )
