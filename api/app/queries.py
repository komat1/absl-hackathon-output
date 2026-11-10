"""Every database question the copilot can ask, as one hand-written query each.

Rules this file keeps, because the agent cannot be trusted to keep them:
  * filtering, joining, sorting and aggregation happen in PostgreSQL;
  * results are bounded and narrow — the model gets tens of rows, never the table;
  * `order_entry` repeats on every product line of a deal, so deal-level money
    is read from `deal_summary` (one row per deal), never summed across lines;
  * revenue is aggregated per customer BEFORE it is joined to opportunities.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any

from . import db
from .config import settings
from .contracts import (
    AccountQuery,
    AdvancePreview,
    AdvanceRequest,
    AppliedChange,
    ComparisonQuery,
    Customer,
    CustomerQuery,
    Deal,
    DealLine,
    EditableField,
    FieldChange,
    OpportunityQuery,
    Period,
    PipelineQuery,
    Recommendation,
    RecommendQuery,
    RevenueQuery,
    Status,
    TopCustomersQuery,
    UpdateRequest,
    UpdateResult,
)

#: The sales phases in the order a deal walks them. A funnel has to come back in
#: this order whatever the alphabet says, and the order lives in SQL so the
#: sorting happens in the database like every other ordering here.
PHASE_ORDER = ["Discovery", "Solution design", "Proposal", "Negotiation", "Closed won", "Closed lost"]

# Sort keys are a whitelist mapped to SQL — never interpolated from input.
_SORT = {
    "deal_value": "deal_value_eur",
    "close_date": "close_date",
    "probability": "win_probability_percent",
    "weighted": "deal_value_eur * win_probability_percent / 100.0",
}


def _period_params(period: Period) -> tuple[int, int, int, int]:
    return period.bounds


# ───────────────────────────── customers ───────────────────────────────


def find_customer(q: CustomerQuery) -> list[Customer]:
    """Name → account id. The agent must resolve a name before anything else;
    30 labels today, but written as a bounded trigram search for scale."""
    return [
        Customer(**row)
        for row in db.rows(
            """
            WITH matched AS (
                SELECT business_partner_number AS partner,
                       min(business_partner_name) AS name,
                       count(*) AS deals
                FROM deal_summary
                WHERE business_partner_name ILIKE %s
                GROUP BY business_partner_number
                ORDER BY count(*) DESC
                LIMIT %s
            )
            SELECT m.partner, m.name, m.deals,
                   COALESCE(r.revenue_total, 0) AS revenue_total
            FROM matched m
            LEFT JOIN (
                SELECT business_partner_number, sum(revenue_monthly) AS revenue_total
                FROM customer_revenue_monthly
                GROUP BY business_partner_number
            ) r ON r.business_partner_number = m.partner
            ORDER BY revenue_total DESC
            """,
            (f"%{q.name}%", q.limit),
        )
    ]


def list_accounts() -> list[Customer]:
    """Every account, richest first — the researcher's picker.

    `find_customer` needs something to match on; this is the plain list, so the
    research page can offer the real names instead of trusting a typed one. The
    rollup already groups per partner, so it stays one bounded scan of 30 rows.
    """
    return [
        Customer(**row)
        for row in db.rows(
            """
            SELECT d.business_partner_number AS partner,
                   min(d.business_partner_name) AS name,
                   count(*) AS deals,
                   COALESCE(max(r.revenue_total), 0) AS revenue_total
            FROM deal_summary d
            LEFT JOIN (
                SELECT business_partner_number, sum(revenue_monthly) AS revenue_total
                FROM customer_revenue_monthly
                GROUP BY business_partner_number
            ) r ON r.business_partner_number = d.business_partner_number
            GROUP BY d.business_partner_number
            ORDER BY 4 DESC, 2
            """
        )
    ]


def account_briefing(q: AccountQuery) -> dict[str, Any]:
    """Meeting prep for one account: recorded revenue in the period, the same
    split by cluster, deal counts by status, and the open pipeline."""
    y1, m1, y2, m2 = _period_params(q.period)

    revenue = db.one(
        """
        SELECT COALESCE(sum(revenue_monthly), 0) AS revenue,
               count(*) FILTER (WHERE revenue_monthly > 0) AS paying_rows
        FROM customer_revenue_monthly
        WHERE business_partner_number = %s
          AND (year, month_num) >= (%s, %s)
          AND (year, month_num) <= (%s, %s)
        """,
        (q.partner, y1, m1, y2, m2),
    ) or {"revenue": 0.0, "paying_rows": 0}

    by_cluster = db.rows(
        """
        SELECT cluster, sum(revenue_monthly) AS revenue
        FROM customer_revenue_monthly
        WHERE business_partner_number = %s
          AND (year, month_num) >= (%s, %s)
          AND (year, month_num) <= (%s, %s)
        GROUP BY cluster
        ORDER BY revenue DESC
        """,
        (q.partner, y1, m1, y2, m2),
    )

    outcomes = db.rows(
        """
        SELECT status,
               count(*)                 AS deals,
               COALESCE(sum(deal_value_eur), 0) AS value
        FROM deal_summary
        WHERE business_partner_number = %s
        GROUP BY status
        """,
        (q.partner,),
    )

    name = db.one(
        "SELECT min(business_partner_name) AS name FROM deal_summary WHERE business_partner_number = %s",
        (q.partner,),
    )

    return {
        "partner": q.partner,
        "name": (name or {}).get("name"),
        "period": q.period.label(),
        "revenue_in_period": revenue["revenue"],
        "revenue_by_cluster": by_cluster,
        "deals_by_status": outcomes,
        "reference_date": settings().reference_date.isoformat(),
    }


def revenue_timeseries(q: RevenueQuery) -> list[dict[str, Any]]:
    """Monthly recorded revenue. Grouped in SQL; one row per month (or per
    month and cluster), which is what a chart needs and all it needs."""
    y1, m1, y2, m2 = _period_params(q.period)
    if q.by_cluster:
        return db.rows(
            """
            SELECT year, month_num, cluster, sum(revenue_monthly) AS revenue
            FROM customer_revenue_monthly
            WHERE (year, month_num) >= (%s, %s)
              AND (year, month_num) <= (%s, %s)
              AND (%s::text IS NULL OR business_partner_number = %s)
            GROUP BY year, month_num, cluster
            ORDER BY year, month_num, cluster
            """,
            (y1, m1, y2, m2, q.partner, q.partner),
        )
    # The three-month average rides along as a window function. It is the second
    # series of a combo chart, and computing it here rather than in the browser
    # keeps the rule: every number on screen was aggregated by PostgreSQL.
    return db.rows(
        """
        WITH monthly AS (
            SELECT year, month_num, sum(revenue_monthly) AS revenue
            FROM customer_revenue_monthly
            WHERE (year, month_num) >= (%s, %s)
              AND (year, month_num) <= (%s, %s)
              AND (%s::text IS NULL OR business_partner_number = %s)
            GROUP BY year, month_num
        )
        SELECT year, month_num, revenue,
               round(avg(revenue) OVER (ORDER BY year, month_num
                                        ROWS BETWEEN 2 PRECEDING AND CURRENT ROW), 2) AS trend_3m,
               round(avg(revenue) OVER (), 2)                                         AS period_avg
        FROM monthly
        ORDER BY year, month_num
        """,
        (y1, m1, y2, m2, q.partner, q.partner),
    )


# ───────────────────────────── pipeline ────────────────────────────────


def pipeline_by_cluster(q: PipelineQuery) -> dict[str, Any]:
    """Pipeline per cluster with both bases, because they answer different
    questions and mixing them up is the classic error here.

    `lines`      — only the product lines in that cluster.
    `full_deals` — the whole value of every deal that contains such a line,
                   so the same deal can appear under two clusters.
    """
    if q.basis == "lines":
        rows = db.rows(
            """
            SELECT cluster,
                   count(DISTINCT source_opportunity_number) AS deals,
                   sum(total_price_eur)                      AS value,
                   sum(total_price_eur * win_probability_percent / 100.0) AS weighted
            FROM sales_opportunities
            WHERE won_lost_active_status = %s
              AND (%s::text IS NULL OR business_partner_number = %s)
            GROUP BY cluster
            ORDER BY value DESC
            """,
            (q.status.value, q.partner, q.partner),
        )
    else:
        rows = db.rows(
            """
            SELECT c.cluster,
                   count(*)                     AS deals,
                   sum(d.deal_value_eur)        AS value,
                   sum(d.deal_value_eur * d.win_probability_percent / 100.0) AS weighted
            FROM deal_summary d
            CROSS JOIN LATERAL unnest(d.clusters) AS c(cluster)
            WHERE d.status = %s
              AND (%s::text IS NULL OR d.business_partner_number = %s)
            GROUP BY c.cluster
            ORDER BY value DESC
            """,
            (q.status.value, q.partner, q.partner),
        )

    total = db.one(
        """
        SELECT count(*) AS deals,
               COALESCE(sum(deal_value_eur), 0) AS value,
               COALESCE(sum(deal_value_eur * win_probability_percent / 100.0), 0) AS weighted
        FROM deal_summary
        WHERE status = %s
          AND (%s::text IS NULL OR business_partner_number = %s)
        """,
        (q.status.value, q.partner, q.partner),
    )
    return {
        "basis": q.basis,
        "basis_note": (
            "Cluster values count only the product lines in that cluster."
            if q.basis == "lines"
            else "Cluster values count the full value of every deal containing a line in that cluster, "
            "so a deal spanning two clusters is counted in both."
        ),
        "status": q.status.value,
        "clusters": rows,
        "total": total,
    }


def pipeline_funnel(partner: str | None, status: Status = Status.active) -> dict[str, Any]:
    """Deals and value per sales phase, in phase order — the funnel.

    `phase_label` is a snapshot taken when the dataset was generated, and an
    edit does not move it, so the phase split is historical colour while the
    status filter is live. The note says so; the caller must keep saying so.

    Deals are grouped before the money is summed: `order_entry` repeats on every
    product line, so summing it across lines would multiply the pipeline.
    """
    # Both drop-offs a sales person asks for — against the stage before and
    # against the top of the funnel — are window functions over the grouped
    # rows, so no part of this arrives unaggregated.
    rows = db.rows(
        """
        WITH per_deal AS (
            SELECT source_opportunity_number,
                   min(phase_label)             AS phase,
                   max(order_entry)             AS value,
                   min(win_probability_percent) AS probability
            FROM sales_opportunities
            WHERE won_lost_active_status = %s
              AND (%s::text IS NULL OR business_partner_number = %s)
            GROUP BY source_opportunity_number
        ), by_phase AS (
            SELECT phase,
                   count(*)                        AS deals,
                   sum(value)                      AS value,
                   sum(value * probability / 100.0) AS weighted
            FROM per_deal
            GROUP BY phase
        )
        SELECT phase, deals, value, weighted,
               round(deals * 100.0 / NULLIF(first_value(deals) OVER w, 0), 1) AS share_of_first,
               round(deals * 100.0 / NULLIF(lag(deals) OVER w, 0), 1)         AS step_retention
        FROM by_phase
        WINDOW w AS (ORDER BY array_position(%s::text[], phase))
        ORDER BY array_position(%s::text[], phase)
        """,
        (status.value, partner, partner, PHASE_ORDER, PHASE_ORDER),
    )
    return {
        "status": status.value,
        "phases": rows,
        "note": (
            "Phase is the snapshot stage from the dataset and does not move when a deal is edited; "
            f"the {status.value} filter reads the live status. Deal value is counted once per deal."
        ),
    }


def deal_risk_map(partner: str | None, limit: int = 60) -> dict[str, Any]:
    """One row per Active deal: value, probability and how urgent it is.

    This is the scatter plot's data — value against probability, which is the
    question "what is big, what is likely, and what is running out of time"
    asked in one picture. Bounded: the model and the chart both get tens of rows.
    """
    reference = settings().reference_date
    rows = db.rows(
        """
        SELECT d.source_opportunity_number AS deal,
               d.business_partner_name     AS name,
               d.deal_value_eur            AS value,
               d.win_probability_percent   AS probability,
               d.deal_value_eur * d.win_probability_percent / 100.0 AS weighted,
               d.close_date::text          AS close_date,
               d.opportunity_type,
               CASE WHEN d.close_date < %s                     THEN 'Overdue'
                    WHEN d.close_date < %s + interval '60 days' THEN 'Closing soon'
                    ELSE 'On track' END   AS urgency
        FROM deal_summary d
        WHERE d.status = 'Active'
          AND (%s::text IS NULL OR d.business_partner_number = %s)
        ORDER BY d.deal_value_eur DESC
        LIMIT %s
        """,
        (reference, reference, partner, partner, min(limit, 120)),
    )
    total = db.one(
        """
        SELECT count(*) AS deals
        FROM deal_summary
        WHERE status = 'Active' AND (%s::text IS NULL OR business_partner_number = %s)
        """,
        (partner, partner),
    )
    return {"deals": rows, "shown": len(rows), "total_active": (total or {}).get("deals", 0)}


def list_opportunities(q: OpportunityQuery) -> dict[str, Any]:
    """Deal-level rows, paginated. The cluster filter is an EXISTS on the lines,
    so the value stays the deal's full value and is not silently prorated."""
    where = ["TRUE"]
    params: list[Any] = []
    if q.status:
        where.append("d.status = %s")
        params.append(q.status.value)
    if q.partner:
        where.append("d.business_partner_number = %s")
        params.append(q.partner)
    if q.opportunity_type:
        where.append("d.opportunity_type = %s")
        params.append(q.opportunity_type.value)
    if q.cluster:
        where.append("%s = ANY(d.clusters)")
        params.append(q.cluster.value)
    if q.closed_between:
        y1, m1, y2, m2 = _period_params(q.closed_between)
        where.append("d.close_date >= make_date(%s, %s, 1)")
        params.extend([y1, m1])
        where.append("d.close_date < (make_date(%s, %s, 1) + interval '1 month')")
        params.extend([y2, m2])

    clause = " AND ".join(where)
    order = f"{_SORT[q.sort]} {'DESC' if q.descending else 'ASC'}"
    reference = settings().reference_date

    rows = db.rows(
        f"""
        SELECT d.source_opportunity_number AS deal,
               d.business_partner_number   AS partner,
               d.business_partner_name     AS name,
               d.status,
               d.opportunity_type,
               d.deal_value_eur,
               d.win_probability_percent,
               d.deal_value_eur * d.win_probability_percent / 100.0 AS weighted_value_eur,
               d.close_date,
               d.line_count,
               d.clusters,
               (d.status = 'Active' AND d.close_date < %s) AS overdue
        FROM deal_summary d
        WHERE {clause}
        ORDER BY {order}
        LIMIT %s OFFSET %s
        """,
        [reference, *params, q.limit, q.offset],
    )
    total = db.one(f"SELECT count(*) AS n FROM deal_summary d WHERE {clause}", params)
    return {"deals": [Deal(**row) for row in rows], "total": (total or {}).get("n", 0)}


def current_deals(limit: int = 40, sort: str = "close_date", search: str | None = None) -> dict[str, Any]:
    """The open book: every Active deal, with the soonest decision at the top.

    This is the one list in the app that is not an answer to a question — the
    sidebar keeps it on screen, so it is read-only, bounded and model-free. The
    rows are only the `limit` the panel can show; the figures beside them are
    aggregated over the WHOLE matching set in PostgreSQL (`deal_summary`, one
    row per deal), so they never depend on how far the list was scrolled.

    `search` filters in the database, not in the browser — the panel must never
    hold the book in order to search it. It matches the customer name anywhere
    and the opportunity number from the start, which are the two things a sales
    person types. The scope stays Active either way: this list is what is still
    to be won or lost, and a closed deal is a question about a period.

    `order_entry` is never touched here: deal-level money comes from the rollup,
    so a four-line deal is one deal worth its own value and not four.
    """
    order = _SORT[sort]  # whitelist, never the caller's string
    direction = "ASC" if sort == "close_date" else "DESC"
    reference = settings().reference_date

    where = "d.status = 'Active'"
    params: list[Any] = []
    term = (search or "").strip()
    if term:
        where += " AND (d.business_partner_name ILIKE %s OR d.source_opportunity_number LIKE %s)"
        # The % are added here, as a VALUE — the pattern never reaches the SQL text.
        params.extend([f"%{term}%", f"{term}%"])

    rows = db.rows(
        f"""
        SELECT d.source_opportunity_number AS deal,
               d.business_partner_number   AS partner,
               d.business_partner_name     AS name,
               d.status,
               d.opportunity_type,
               d.deal_value_eur,
               d.win_probability_percent,
               d.deal_value_eur * d.win_probability_percent / 100.0 AS weighted_value_eur,
               d.close_date,
               d.line_count,
               d.clusters,
               (d.close_date < %s) AS overdue
        FROM deal_summary d
        WHERE {where}
        ORDER BY {order} {direction}, d.deal_value_eur DESC
        LIMIT %s
        """,
        (reference, *params, limit),
    )

    totals = db.one(
        f"""
        SELECT count(*)                                                      AS total,
               coalesce(sum(d.deal_value_eur), 0)                            AS value_eur,
               coalesce(sum(d.deal_value_eur * d.win_probability_percent / 100.0), 0) AS weighted_eur,
               count(*) FILTER (WHERE d.close_date < %s)                     AS overdue
        FROM deal_summary d
        WHERE {where}
        """,
        (reference, *params),
    ) or {}

    return {
        "deals": [Deal(**row) for row in rows],
        "total": totals.get("total", 0),
        "value_eur": totals.get("value_eur", 0.0),
        "weighted_eur": totals.get("weighted_eur", 0.0),
        "overdue": totals.get("overdue", 0),
        "reference_date": reference.isoformat(),
        "search": term,
    }


def deal_state(deal_id: str) -> dict[str, Any] | None:
    """The deal-level values as they stand in the table right now.

    Read from `sales_opportunities`, not from the rollup: this is what answers
    "did that change actually save?", so it must not be able to show a stale
    snapshot.
    """
    return db.one(
        """
        SELECT min(business_partner_name)            AS name,
               min(won_lost_active_status)           AS status,
               min(win_probability_percent)          AS win_probability_percent,
               min(close_date)::text                 AS close_date,
               count(*)                              AS line_count,
               count(DISTINCT won_lost_active_status) AS distinct_statuses
        FROM sales_opportunities WHERE source_opportunity_number = %s
        """,
        (deal_id,),
    )


def deal_lines(deal_id: str) -> list[DealLine]:
    return [
        DealLine(**row)
        for row in db.rows(
            """
            SELECT product_name, cluster, total_price_eur
            FROM sales_opportunities
            WHERE source_opportunity_number = %s
            ORDER BY total_price_eur DESC
            """,
            (deal_id,),
        )
    ]


# ───────────────────────── performance over time ───────────────────────


def compare_periods(q: ComparisonQuery) -> list[dict[str, Any]]:
    """Two periods side by side, per customer (or per cluster for one customer).

    Each period is aggregated on its own and the two are joined afterwards, so a
    customer present in only one of them still shows up — with the percentage
    change left undefined rather than reported as 0 or infinity.
    """
    cy1, cm1, cy2, cm2 = _period_params(q.current)
    py1, pm1, py2, pm2 = _period_params(q.previous)
    dimension = "cluster" if q.by_cluster else "business_partner_number"

    rows = db.rows(
        f"""
        WITH cur AS (
            SELECT {dimension} AS dim, sum(revenue_monthly) AS value
            FROM customer_revenue_monthly
            WHERE (year, month_num) >= (%s, %s) AND (year, month_num) <= (%s, %s)
              AND (%s::text IS NULL OR business_partner_number = %s)
            GROUP BY 1
        ), prev AS (
            SELECT {dimension} AS dim, sum(revenue_monthly) AS value
            FROM customer_revenue_monthly
            WHERE (year, month_num) >= (%s, %s) AND (year, month_num) <= (%s, %s)
              AND (%s::text IS NULL OR business_partner_number = %s)
            GROUP BY 1
        )
        SELECT COALESCE(c.dim, p.dim)                   AS dim,
               COALESCE(c.value, 0)                     AS current_value,
               COALESCE(p.value, 0)                     AS previous_value,
               COALESCE(c.value, 0) - COALESCE(p.value, 0) AS change_abs,
               CASE WHEN COALESCE(p.value, 0) = 0 THEN NULL
                    ELSE round((COALESCE(c.value, 0) - p.value) * 100.0 / p.value, 1)
               END                                      AS change_percent,
               (COALESCE(p.value, 0) = 0)               AS percent_undefined
        FROM cur c
        FULL OUTER JOIN prev p ON p.dim = c.dim
        ORDER BY current_value DESC
        LIMIT %s
        """,
        (
            cy1, cm1, cy2, cm2, q.partner, q.partner,
            py1, pm1, py2, pm2, q.partner, q.partner,
            settings().max_rows,
        ),
    )

    # The dimension is an account id, which means nothing to a sales person.
    # Names are attached in one bounded extra query AFTER the aggregation —
    # joining them before it would carry the name through every grouped row.
    if not q.by_cluster and rows:
        names = {
            row["partner"]: row["name"]
            for row in db.rows(
                """
                SELECT business_partner_number AS partner, min(business_partner_name) AS name
                FROM deal_summary WHERE business_partner_number = ANY(%s) GROUP BY 1
                """,
                ([str(row["dim"]) for row in rows],),
            )
        }
        for row in rows:
            row["label"] = names.get(str(row["dim"]), str(row["dim"]))
    else:
        for row in rows:
            row["label"] = str(row["dim"])
    return rows


def revenue_bridge(q: ComparisonQuery) -> dict[str, Any]:
    """What carried revenue from one period to the next, per cluster.

    The waterfall's data. Both period totals come back as window sums over the
    same grouped rows, so the opening and closing figures of the bridge are the
    database's own and cannot drift from the steps between them.
    """
    cy1, cm1, cy2, cm2 = _period_params(q.current)
    py1, pm1, py2, pm2 = _period_params(q.previous)
    rows = db.rows(
        """
        WITH cur AS (
            SELECT cluster, sum(revenue_monthly) AS value
            FROM customer_revenue_monthly
            WHERE (year, month_num) >= (%s, %s) AND (year, month_num) <= (%s, %s)
              AND (%s::text IS NULL OR business_partner_number = %s)
            GROUP BY cluster
        ), prev AS (
            SELECT cluster, sum(revenue_monthly) AS value
            FROM customer_revenue_monthly
            WHERE (year, month_num) >= (%s, %s) AND (year, month_num) <= (%s, %s)
              AND (%s::text IS NULL OR business_partner_number = %s)
            GROUP BY cluster
        ), joined AS (
            SELECT cluster,
                   COALESCE(c.value, 0) AS current_value,
                   COALESCE(p.value, 0) AS previous_value
            FROM cur c FULL OUTER JOIN prev p USING (cluster)
        )
        SELECT cluster,
               current_value,
               previous_value,
               current_value - previous_value AS change_abs,
               sum(previous_value) OVER ()    AS previous_total,
               sum(current_value)  OVER ()    AS current_total
        FROM joined
        ORDER BY change_abs DESC
        """,
        (
            cy1, cm1, cy2, cm2, q.partner, q.partner,
            py1, pm1, py2, pm2, q.partner, q.partner,
        ),
    )
    totals = rows[0] if rows else {"previous_total": 0.0, "current_total": 0.0}
    return {
        "steps": rows,
        "previous_total": totals["previous_total"],
        "current_total": totals["current_total"],
        "previous_label": q.previous.label(),
        "current_label": q.current.label(),
    }


def top_customers_by_revenue(q: TopCustomersQuery) -> dict[str, Any]:
    """Top N by recorded revenue in a period, plus their cluster split — the
    split is fetched only for those N accounts, not for all of them."""
    y1, m1, y2, m2 = _period_params(q.period)
    top = db.rows(
        """
        SELECT r.business_partner_number AS partner,
               sum(r.revenue_monthly)    AS revenue
        FROM customer_revenue_monthly r
        WHERE (r.year, r.month_num) >= (%s, %s) AND (r.year, r.month_num) <= (%s, %s)
        GROUP BY r.business_partner_number
        ORDER BY revenue DESC
        LIMIT %s
        """,
        (y1, m1, y2, m2, q.limit),
    )
    partners = [row["partner"] for row in top]
    if not partners:
        return {"customers": [], "by_cluster": []}

    names = {
        row["partner"]: row["name"]
        for row in db.rows(
            """
            SELECT business_partner_number AS partner, min(business_partner_name) AS name
            FROM deal_summary WHERE business_partner_number = ANY(%s) GROUP BY 1
            """,
            (partners,),
        )
    }
    for row in top:
        row["name"] = names.get(row["partner"], row["partner"])

    by_cluster = (
        db.rows(
            """
            SELECT business_partner_number AS partner, cluster, sum(revenue_monthly) AS revenue
            FROM customer_revenue_monthly
            WHERE business_partner_number = ANY(%s)
              AND (year, month_num) >= (%s, %s) AND (year, month_num) <= (%s, %s)
            GROUP BY 1, 2
            ORDER BY 1, revenue DESC
            """,
            (partners, y1, m1, y2, m2),
        )
        if q.by_cluster
        else []
    )
    return {"period": q.period.label(), "customers": top, "by_cluster": by_cluster}


# ───────────────────────── prioritization ──────────────────────────────


def recommend_active_deals(q: RecommendQuery) -> list[Recommendation]:
    """Three deals to focus on, ranked by an explainable score.

    weighted value  — the expected money, the base of the ranking
    × 1.25 overdue  — the decision date has passed; it needs a push either way
    × 1.10 renewal  — losing it means losing revenue we already have
    × 1.10 close    — decision lands within 60 days of the reference date

    The score is a prioritization rule, not a forecast, and every multiplier
    that fired is returned so the agent can say why instead of asserting it.
    """
    reference = settings().reference_date
    rows = db.rows(
        """
        SELECT d.source_opportunity_number AS deal,
               d.business_partner_number   AS partner,
               d.business_partner_name     AS name,
               d.status,
               d.opportunity_type,
               d.deal_value_eur,
               d.win_probability_percent,
               d.deal_value_eur * d.win_probability_percent / 100.0 AS weighted_value_eur,
               d.close_date,
               d.line_count,
               d.clusters,
               (d.close_date < %s) AS overdue,
               (d.close_date >= %s AND d.close_date < %s) AS closing_soon,
               d.deal_value_eur * d.win_probability_percent / 100.0
                 * CASE WHEN d.close_date < %s THEN 1.25 ELSE 1 END
                 * CASE WHEN d.opportunity_type = 'Renewal' THEN 1.10 ELSE 1 END
                 * CASE WHEN d.close_date >= %s AND d.close_date < %s THEN 1.10 ELSE 1 END
                 AS score
        FROM deal_summary d
        WHERE d.status = 'Active'
          AND (%s::text IS NULL OR d.business_partner_number = %s)
        ORDER BY score DESC
        LIMIT %s
        """,
        (
            reference, reference, reference + timedelta(days=60),
            reference, reference, reference + timedelta(days=60),
            q.partner, q.partner, q.limit,
        ),
    )

    out: list[Recommendation] = []
    for row in rows:
        score = row.pop("score")
        overdue = row["overdue"]
        closing_soon = row.pop("closing_soon")
        reasons = [
            f"Weighted value €{row['weighted_value_eur']:,.0f} "
            f"(€{row['deal_value_eur']:,.0f} × {row['win_probability_percent']}%)"
        ]
        if overdue:
            reasons.append(f"Expected close {row['close_date']} is past the reference date {reference} — overdue")
        if closing_soon:
            reasons.append(f"Decision expected within 60 days ({row['close_date']})")
        if row["opportunity_type"] == "Renewal":
            reasons.append("Renewal — this is revenue we already have")
        reasons.append(f"{row['line_count']} product lines across {', '.join(row['clusters'])}")
        out.append(Recommendation(deal=Deal(**row), score=round(score, 2), reasons=reasons))
    return out


# ──────────────────────── the write path ───────────────────────────────

#: Pending previews, keyed by an opaque id. In-process on purpose: a preview is
#: a UI state, not a reservation, and nothing about it may outlive the session.
#: One row per preview, dropped on confirm, on cancel, and on expiry.
_PENDING: dict[str, dict[str, Any]] = {}
PENDING_TTL = timedelta(minutes=10)


def preview_deal_update(request: UpdateRequest) -> AdvancePreview:
    """One field of one deal. Sugar over `preview_deal_advance`: a single-field
    edit and a multi-field advance travel the same guarded path."""
    return preview_deal_advance(request.as_advance())


def preview_deal_advance(request: AdvanceRequest) -> AdvancePreview:
    """Read what is stored and describe what the decision WOULD do. NO WRITE.

    There is no UPDATE in this function and no transaction is opened. The only
    way to reach the write is the `pending_id` it returns — and that id is handed
    to a human, never to a tool the model can call on its own.

    One query answers the whole card: the stored values per field, how many
    lines carry them, and what confirming does to the weighted pipeline.
    """
    changes = request.changes()

    head = db.one(
        """
        SELECT min(business_partner_name)   AS name,
               count(*)                     AS lines,
               max(order_entry)             AS deal_value_eur,
               min(won_lost_active_status)  AS status,
               min(win_probability_percent) AS win_probability_percent,
               min(close_date)::text        AS close_date,
               array_agg(DISTINCT won_lost_active_status)        AS status_values,
               array_agg(DISTINCT win_probability_percent::text) AS probability_values,
               array_agg(DISTINCT close_date::text)              AS close_date_values,
               -- Weighted pipeline is an Active-pipeline figure, so a deal that
               -- is not Active weighs nothing on either side of the decision.
               CASE WHEN min(won_lost_active_status) = 'Active'
                    THEN max(order_entry) * min(win_probability_percent) / 100.0
                    ELSE 0 END AS weighted_before,
               CASE WHEN COALESCE(%s::text, min(won_lost_active_status)) = 'Active'
                    THEN max(order_entry)
                         * COALESCE(%s::numeric, min(win_probability_percent)) / 100.0
                    ELSE 0 END AS weighted_after,
               (min(won_lost_active_status) = 'Active'
                AND COALESCE(%s::text, min(won_lost_active_status)) <> 'Active') AS leaves_active
        FROM sales_opportunities
        WHERE source_opportunity_number = %s
        """,
        (
            request.status.value if request.status else None,
            request.win_probability_percent,
            request.status.value if request.status else None,
            request.deal,
        ),
    )
    if not head or not head["lines"]:
        raise LookupError(f"No opportunity {request.deal}")

    stored = {
        EditableField.status: head["status_values"] or [],
        EditableField.win_probability: head["probability_values"] or [],
        EditableField.close_date: head["close_date_values"] or [],
    }
    field_changes = [
        FieldChange(
            field=field,
            old_values=sorted(stored[field]),
            new_value=value,
            unchanged=sorted(stored[field]) == [value],
        )
        for field, value in changes.items()
    ]

    pending_id = uuid.uuid4().hex[:12]
    expires = datetime.now(timezone.utc) + PENDING_TTL
    _PENDING[pending_id] = {"deal": request.deal, "changes": changes, "expires": expires}
    _expire_pending()

    return AdvancePreview(
        pending_id=pending_id,
        deal=request.deal,
        name=head["name"],
        changes=field_changes,
        affected_lines=head["lines"],
        expires_at=expires.isoformat(timespec="seconds"),
        stored_now={
            "status": head["status"],
            "win_probability_percent": head["win_probability_percent"],
            "close_date": head["close_date"],
        },
        deal_value_eur=head["deal_value_eur"],
        weighted_before_eur=head["weighted_before"],
        weighted_after_eur=head["weighted_after"],
        leaves_active_pipeline=head["leaves_active"],
        derived_note=(
            f"Win probability is set to {request.win_probability_percent}% because a "
            f"{request.status.value if request.status else ''} deal carries that figure."
            if request.probability_derived
            else None
        ),
    )


def cancel_deal_update(pending_id: str) -> bool:
    """Drop the pending decision. Nothing else happens — there is no database
    call in this function, which is the point: a cancelled edit cannot write,
    not now and not by a later restore."""
    return _PENDING.pop(pending_id, None) is not None


def apply_deal_update(pending_id: str) -> UpdateResult:
    """Apply a previewed decision to EVERY product line of the deal.

    One transaction, one UPDATE: every field of the decision moves together, so
    a deal is never left half-advanced with a Won status and a stale
    probability. The audit rows are written inside that same transaction and so
    share its `changed_at` — which is what groups them back into the single
    decision a human confirmed.
    """
    pending = _PENDING.get(pending_id)
    if pending is None:
        raise LookupError("No pending change with that id — it expired, was cancelled, or was already applied")
    if pending["expires"] < datetime.now(timezone.utc):
        _PENDING.pop(pending_id, None)
        raise LookupError("That preview expired. Ask for the change again.")

    deal: str = pending["deal"]
    changes: dict[EditableField, str] = pending["changes"]

    # Column names come from the EditableField enum, never from free text; every
    # value is a bound parameter.
    cast = {
        EditableField.status: "%s::text",
        EditableField.close_date: "%s::date",
        EditableField.win_probability: "%s::smallint",
    }
    assignments = ", ".join(f"{field.value} = {cast[field]}" for field in changes)

    applied: list[AppliedChange] = []
    audit_ids: list[int] = []
    with db.write_tx() as cur:
        cur.execute(
            """
            SELECT array_agg(DISTINCT won_lost_active_status)        AS won_lost_active_status,
                   array_agg(DISTINCT win_probability_percent::text) AS win_probability_percent,
                   array_agg(DISTINCT close_date::text)              AS close_date
            FROM sales_opportunities WHERE source_opportunity_number = %s
            """,
            (deal,),
        )
        before = cur.fetchone() or {}

        cur.execute(
            f"UPDATE sales_opportunities SET {assignments} WHERE source_opportunity_number = %s",
            (*changes.values(), deal),
        )
        affected = cur.rowcount

        for field, value in changes.items():
            old = ", ".join(sorted(before.get(field.value) or [])) or None
            cur.execute(
                """
                INSERT INTO deal_update_audit (deal_id, field, old_value, new_value, rows_affected)
                VALUES (%s, %s, %s, %s, %s) RETURNING id
                """,
                (deal, field.value, old, value, affected),
            )
            audit_ids.append(cur.fetchone()["id"])
            applied.append(AppliedChange(field=field, old_value=old, new_value=value))

    _PENDING.pop(pending_id, None)
    _refresh_rollup()
    return UpdateResult(deal=deal, applied=applied, rows_affected=affected, audit_ids=audit_ids)


def pending_count() -> int:
    _expire_pending()
    return len(_PENDING)


def _expire_pending() -> None:
    now = datetime.now(timezone.utc)
    for key in [k for k, v in _PENDING.items() if v["expires"] < now]:
        _PENDING.pop(key, None)


def _refresh_rollup() -> None:
    """Keep the deal-level rollup in step with the write.

    CONCURRENTLY so readers are never blocked; it needs its own autocommit
    connection because it cannot run inside a transaction block.
    """
    import psycopg

    with psycopg.connect(settings().dsn_rw, autocommit=True) as conn:
        conn.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY deal_summary")


def audit_trail(limit: int = 20) -> list[dict[str, Any]]:
    """The raw trail: one row per field, newest first."""
    return db.rows(
        """
        SELECT id, changed_at, deal_id, field, old_value, new_value, rows_affected
        FROM deal_update_audit ORDER BY changed_at DESC, id DESC LIMIT %s
        """,
        (limit,),
    )


def audit_decisions(limit: int = 20) -> list[dict[str, Any]]:
    """The same trail read as decisions: the rows written by one confirmed
    advance share their transaction timestamp, so grouping on it recovers the
    multi-field change a human actually approved."""
    return db.rows(
        """
        SELECT d.*, ds.business_partner_name AS customer_name
        FROM (
            SELECT min(id)             AS id,
                   changed_at,
                   deal_id,
                   max(rows_affected)  AS rows_affected,
                   count(*)            AS fields_changed,
                   json_agg(json_build_object(
                       'field', field, 'old_value', old_value, 'new_value', new_value
                   ) ORDER BY id)      AS changes
            FROM deal_update_audit
            GROUP BY changed_at, deal_id
            ORDER BY changed_at DESC
            LIMIT %s
        ) d
        LEFT JOIN deal_summary ds ON ds.source_opportunity_number = d.deal_id
        ORDER BY d.changed_at DESC
        """,
        (limit,),
    )


# ── New deals ────────────────────────────────────────────────────────────────
# Creating a deal follows the same two-step shape as an update: a preview that
# validates and parks the draft under a pending id, and a separate confirm that
# writes it. Cancel only drops the draft — no database call.

_NEW_DEALS: dict[str, dict[str, Any]] = {}


def product_catalog() -> list[dict[str, Any]]:
    """Product → cluster, as the dataset knows it. Twenty-odd rows."""
    return db.rows(
        "SELECT product_name AS product, min(cluster) AS cluster FROM sales_opportunities "
        "GROUP BY product_name ORDER BY min(cluster), product_name LIMIT 200"
    )


def preview_new_deal(draft: dict[str, Any]) -> dict[str, Any]:
    product = db.one(
        "SELECT product_name, min(cluster) AS cluster FROM sales_opportunities WHERE product_name = %s GROUP BY 1",
        (draft["product"],),
    )
    if product is None:
        raise ValueError("Unknown product — pick one from the catalog.")
    account = db.one(
        "SELECT business_partner_number AS partner, business_partner_name AS name FROM sales_opportunities "
        "WHERE lower(business_partner_name) = lower(%s) LIMIT 1",
        (draft["customer"].strip(),),
    )
    pending_id = uuid.uuid4().hex[:12]
    item = {
        **draft,
        "customer": account["name"] if account else draft["customer"].strip(),
        "partner": account["partner"] if account else None,
        "existing_account": account is not None,
        "cluster": product["cluster"],
        "expires": datetime.now(timezone.utc) + PENDING_TTL,
    }
    _NEW_DEALS[pending_id] = item
    for key in [k for k, v in _NEW_DEALS.items() if v["expires"] < datetime.now(timezone.utc)]:
        _NEW_DEALS.pop(key, None)
    return {"pending_id": pending_id, **{k: v for k, v in item.items() if k != "expires"}}


def cancel_new_deal(pending_id: str) -> bool:
    """No database call, on purpose."""
    return _NEW_DEALS.pop(pending_id, None) is not None


def apply_new_deal(pending_id: str) -> dict[str, Any]:
    item = _NEW_DEALS.get(pending_id)
    if item is None or item["expires"] < datetime.now(timezone.utc):
        _NEW_DEALS.pop(pending_id, None)
        raise LookupError("No pending new deal with that id — it expired, was cancelled, or was already created")

    with db.write_tx() as cur:
        # Serialise number allocation: two confirms at once must not share a deal number.
        cur.execute("SELECT pg_advisory_xact_lock(990600000)")
        cur.execute("SELECT (max(source_opportunity_number::bigint) + 1)::text AS n FROM sales_opportunities")
        deal = cur.fetchone()["n"]
        partner = item["partner"]
        if partner is None:
            cur.execute("SELECT (max(business_partner_number::bigint) + 1)::text AS n FROM sales_opportunities")
            partner = cur.fetchone()["n"]
        cur.execute(
            """
            INSERT INTO sales_opportunities (
              source_opportunity_number, business_partner_number, business_partner_name,
              product_name, cluster, total_price_eur, order_entry, won_lost_active_status,
              phase_label, win_probability_percent, opportunity_created_at, close_date, opportunity_type)
            VALUES (%s, %s, %s, %s, %s, %s, %s, 'Active', 'Discovery', %s, %s, %s, %s)
            """,
            (
                deal, partner, item["customer"], item["product"], item["cluster"],
                item["price_eur"], item["price_eur"], item["win_probability_percent"],
                settings().reference_date, item["close_date"], item["opportunity_type"],
            ),
        )
        summary = (
            f"{item['customer']} · {item['product']} · EUR {item['price_eur']:,.2f} · "
            f"{item['win_probability_percent']}% · close {item['close_date']}"
        )
        cur.execute(
            "INSERT INTO deal_update_audit (deal_id, field, old_value, new_value, rows_affected) "
            "VALUES (%s, 'created', NULL, %s, 1) RETURNING id",
            (deal, summary),
        )
        audit_id = cur.fetchone()["id"]

    _NEW_DEALS.pop(pending_id, None)
    _refresh_rollup()
    return {"deal": deal, "partner": partner, "customer": item["customer"], "summary": summary, "audit_id": audit_id}
