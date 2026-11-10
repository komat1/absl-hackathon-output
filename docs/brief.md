# Assignment reference — ABSL Hackathon: AI Sales Copilot

Verbatim-faithful reference of the organizers' brief. Source of truth for scope,
field semantics and data rules. Kickoff deck:
https://htmlpreview.github.io/?https://github.com/richardkocian/absl-hackathon/blob/main/presentation.html

The chatbot itself must be **English-language**.

## Scope

**Required**
1. **Analyze and prepare** — help a salesperson prepare for a customer meeting:
   recorded revenue from the account, open opportunities, past Won/Lost proposals;
   comparisons by period, product and cluster. Recommend **three Active deals** to
   prioritize, backed by figures and a rationale.
2. **Update** — preview allowed deal changes, ask for confirmation before saving,
   apply confirmed changes to **all product lines** of the deal via controlled,
   parameterized writes. **Cancellation must perform no write.**

**Optional, in this build order**
3. **Generated UI (first)** — turn natural language into tables, charts and summary
   cards; compose views from predefined components and validated settings, not
   AI-generated code; refine layout/filters/sorting/chart types via follow-up
   prompts; refresh affected components after saved edits without a page reload.
4. **Web research (second)** — public company/industry context (cybersecurity,
   service continuity, technology lifecycle, regulatory risk) with sources and
   dates, turned into discussion topics, discovery questions and next steps.

**Database setup is required**: import both CSVs into a relational database
(e.g. PostgreSQL); the app must query that database and persist confirmed updates
there, not use the CSVs as its runtime store. Setup/import steps must be documented.

Recommended framework: Pydantic AI. Others are allowed.

## Business vocabulary

- **Opportunity** — a potential deal. **Active** = undecided, **Won** = accepted,
  **Lost** = not proceeding. One deal may contain several product lines but counts
  as one opportunity.
- **Renewal** continues an existing arrangement; **upsell** expands its scope.
  **New Business** introduces new scope (not necessarily a new customer).
- **Pipeline** = potential deal value. **Revenue** = money already recorded.
  Winning a deal does not mean its value has already become revenue.
- Context: a telecom sales team selling connectivity, cloud, security and
  workplace tools to business customers.

## Data

**SIMULATION: real company names, invented business data.** The 30 names are
labels for example accounts only. Deals, IDs, prices, outcomes and revenues are
simulated — not actual company figures, and not evidence of a supplier
relationship. This disclaimer must travel with the CSVs.

Volume: 30 company labels, 2,000 deals, 5,102 product lines, 14,400 revenue rows.
Period: **2016-11 to 2026-10**. **Reference date: 2026-10-31.**
Clusters: Connectivity, Cloud Services, Security, Workplace & Communications.

IDs are text, dates are `YYYY-MM-DD`, amounts are net EUR with a decimal point.
An empty `closed_lost_comment` means NULL. All other fields are populated.

### sales_opportunities.csv — one row per product line

All lines of a deal share the deal-level values; only `product_name`, `cluster`
and `total_price_eur` may differ.

| Field | Meaning |
| --- | --- |
| `source_opportunity_number` | Unique deal ID, repeated across its product lines. Use it to identify or count distinct deals. |
| `business_partner_number` | Invented customer/account ID. Join key to revenue. |
| `business_partner_name` | Real company/brand name used as a label for the simulated account. |
| `product_name` | Service on this line (e.g. Business Fiber 500, Email Security). May cover multiple units; quantities already included in the value. |
| `cluster` | Connectivity, Cloud Services, Security, or Workplace & Communications. |
| `total_price_eur` | This line's full net proposal value: 12 months for recurring services, or the full one-off fee. Not a unit or monthly price. |
| `order_entry` | Full net value of the whole deal = sum of `total_price_eur` over all lines with the same `source_opportunity_number`. **Repeated identically on every line.** Populated for Active/Won/Lost. Not revenue. Read-only. |
| `won_lost_active_status` | Active, Won or Lost. Losing a proposal ≠ losing the customer. |
| `phase_label` | Sales stage at the snapshot: Discovery, Solution design, Proposal, Negotiation, Closed won, Closed lost. Read-only; after edits use current status, not this snapshot, to find open deals. |
| `win_probability_percent` | Whole percent. Active 0–99, Won 100, Lost 0. Weighted pipeline = Active value × probability/100 — not a calibrated forecast. |
| `opportunity_created_at` | Date the opportunity was created. Not a service start date. |
| `close_date` | Expected decision date (Active) or simulated decision date (Won/Lost). Won revenue starts the following month. An overdue Active date does not mean Lost. |
| `opportunity_type` | New Business, Renewal or Upsell. |
| `closed_lost_comment` | Simulated loss explanation. Required and nonblank for Lost, NULL for Active/Won. Not a factual statement about the named company. |

### customer_revenue_monthly.csv — one row per customer, month and cluster

All combinations exist, including zero-revenue months.

| Field | Meaning |
| --- | --- |
| `business_partner_number` | Same simulated account ID as in opportunities. |
| `year` | Calendar year. First and last years are partial. |
| `month_num` | 1–12. Combine with `year` when grouping or sorting. |
| `revenue_monthly` | Simulated recorded net EUR revenue for this account, month and cluster, derived from initial Won lines. Zero = no scheduled revenue. |
| `cluster` | Service category. Sum all four for total monthly revenue per customer. |

### How revenue was generated

Revenue matches the **initial** Won opportunities. Service starts the month after
`close_date`. Recurring lines contribute 1/12 of their value per month for 12
months. `Cloud Migration Workshop` and `Security Assessment` contribute their full
fee once, in that first month. Active/Lost contribute nothing. Amounts scheduled
after 2026-10 are future revenue, not historical. No opening contracts, no revenue
noise, no credit adjustments.

Prices and recorded revenue are **read-only**. Confirmed edits to status or close
date do **not** recalculate the supplied historical revenue in this exercise.

## Design for millions of rows

The dataset is small for setup convenience, but the app must be designed as if each
table held millions of rows. A solution that only works because the data fits in
memory is not sufficient.

- Filter, join, sort and aggregate **in PostgreSQL** — not in app memory, the
  browser or an LLM prompt.
- Return only required columns and bounded results. Paginate large tables; send the
  model compact query results, not the dataset.
- Use appropriate indexes and query timeouts. A `LIMIT` alone does not make an
  expensive query safe — consider how much data the DB must process.
- Dashboards fetch and refresh only what affected components need. Handle slow
  queries and failures explicitly instead of freezing the UI or silently returning
  incomplete answers.

## What the data does NOT contain

No contacts, account-manager ownership, addresses, site counts, installed
equipment, service usage, actual contract expiry dates, or corporate group
hierarchy. Do not invent these and do not require extra integrations.
`close_date` is a decision date, not a contract expiry date. Opportunity history
is evidence of proposals, not a verified inventory of installed services. A product
absent from the data is not proof the customer does not use it.

Explain the limitation and offer an answer the data does support.

## Expectations embedded in the sample workflows

- Keep the selected customer, period and filters across follow-up questions; ask
  for clarification when scope is ambiguous.
- Distinguish database facts from recommendations, and from cited external facts.
- Label whether cluster values include only matching product lines or the full
  value of matching deals.
- Explain the prioritization rule; never present weighted pipeline as guaranteed
  revenue.
- Use `close_date` for closed-deal history, not creation date.
- Show an undefined percentage change explicitly when the comparison base is zero.
- Aggregate at customer level before joining revenue to opportunities.
- Loss comments describe simulated outcomes, not verified causes.
- A table filter must not silently change another component's scope. A probability
  saved on a deal must hit every product line, including lines hidden by a filter.

## Cancellation test (explicit in the brief)

1. User: "Move opportunity 990600001's close date to 2026-12-15."
2. Bot: read current date, preview the change including deal ID and number of
   affected product lines, ask "Confirm or cancel?" — **no write yet.**
3. User: "Cancel."
4. Bot: discard the pending change, report "Cancelled. No changes were saved."
   Every line retains its previous close date.

Do not implement cancellation as saving and then restoring. Earlier confirmed edits
must remain intact. Show the stored values unchanged in the demo.

## Deliverables

A working chatbot, setup instructions, and a short demo showing **a database
answer, three recommended Active deals, a confirmed update and a cancelled
update**, presented as one connected sales workflow with a follow-up question that
proves conversational context is kept. If implemented, demo a chat-driven view
change plus refresh after saving, then research findings with sources and dates.

Not required and not expected: email sending, PowerPoint/PDF export, internal
system access. Never copy production conversations, personal details or internal
identifiers into the app or demo.

## Judging

| Area | Points |
| --- | ---: |
| System architecture — clear responsibilities for LLM/backend/DB/UI, sensible choices, error handling, scales to millions of rows | 20 |
| Usability — intuitive chat and dashboard, clear answers, understandable confirmations and errors, smooth sales workflow | 20 |
| Creativity — original, useful ideas, not complexity for its own sake | 20 |
| **Presentation and demo** — clear explanation, working demo, ability to explain decisions, limitations and trade-offs | **40** |

Judging also weighs the team's AI and engineering thinking: architecture design,
safe and efficient database use, confirmation/cancellation handling, stated
limitations, and a useful sales workflow. Make the trade-offs visible.
