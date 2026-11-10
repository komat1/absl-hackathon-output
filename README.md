# AI Sales Copilot

A sales copilot for a telecom account team: it answers questions about recorded
revenue and the open pipeline from PostgreSQL, recommends which Active deals to
prioritize, and previews every deal change before anything is saved.

The chat is on the right, the view it builds is in the middle. Cards, charts and
tables are composed from a fixed component registry — the model chooses which
component and with what settings, never what code to run.

```
React + Tailwind (chat + generated blocks)
        │  SSE: text deltas and UI blocks on one stream
FastAPI ├── /api/chat     the agent
        ├── /api/confirm  the confirm / cancel buttons
        └── /api/refresh  rebuild named blocks only
        │
Pydantic AI agent  ──  15 typed tools
        │
SQL layer  ──  one hand-written parameterized query per tool
        │
PostgreSQL 16  (read-only pool for analytics, write pool for updates)
```

## Manual

### What you need

| Tool | Version | Check |
| --- | --- | --- |
| Docker (Desktop or Engine, with Compose) | any recent | `docker compose version` |
| Python | 3.12+ | `python3 --version` |
| Node.js | 20+ | `node --version` |
| An Anthropic API key | — | only the chat and the researcher need it |

Ports used: **5434** (PostgreSQL), **8000** (API), **5173** (web). Free them first.

### Turning it on (first time)

**1. Clone and get the data.** The repo does not carry the CSVs:

```bash
git clone https://github.com/komat1/absl.git && cd absl
```

```bash
mkdir -p data && curl -fsSL -o data/sales_opportunities.csv https://raw.githubusercontent.com/richardkocian/absl-hackathon/main/sales_opportunities.csv && curl -fsSL -o data/customer_revenue_monthly.csv https://raw.githubusercontent.com/richardkocian/absl-hackathon/main/customer_revenue_monthly.csv
```

**2. Create your `.env`** and put your key in it. `.env` is gitignored — never commit it.

```bash
cp .env.example .env
```

```
ANTHROPIC_API_KEY=sk-ant-...
```

**3. Install, start the database, import the data:**

```bash
make install && make up && make seed
```

`make install` creates `api/.venv` and runs `npm install` in `web/`. `make up`
starts PostgreSQL in Docker and, on first run, creates the schema, the indexes,
the two database roles and the deal-level rollup. `make seed` imports both CSVs
with `COPY` (≈5,100 product lines, 2,000 deals, 14,400 revenue rows) and refreshes
the rollup.

**4. Run it** — two terminals, both from the repo root:

```bash
make api
```

```bash
make web
```

**5. Open http://localhost:5173.** Check the backend at http://localhost:8000/api/health.

### Turning it on again (every later time)

```bash
make up
```

Then `make api` and `make web` in two terminals. The data stays in the Docker
volume between runs. `make down` stops the database; `make reset` wipes it and
re-imports the CSVs (restart `make api` afterwards — its connection pools point
at the old database).

### Using it

The screen has three parts:

- **Left sidebar** — the places: the **dashboard**, the **researcher** and
  **my changes** (the audit trail of every confirmed update). Under them is the
  **Active deals** list: search it, and click a row to ask the copilot about that deal.
- **Middle** — the dashboard the copilot builds: stat cards, charts, tables,
  findings and callouts. Each tab in the strip is its own dashboard with its own
  chat; star a tab to keep it first, closed tabs are kept in the history.
- **Right** — the chat. Ask in plain English; the answer streams in and the
  blocks it creates land in the middle.

Try this sequence:

1. *"Give me a briefing on Siemens: revenue trend, open pipeline and closed deals."*
2. *"Show the revenue as an area chart."* — the chart changes form, its data does not.
3. *"Which three Active deals should I prioritise this month, and why?"*
4. *"Push the close date of deal 990600001 to 2026-12-15 and set its win probability to 70%."* — a
   **preview card** appears with old → new values, the number of product lines
   affected and the effect on weighted pipeline. Click **Confirm** to save.
5. Ask for another change and click **Cancel** — nothing is written, check it
   under **my changes**.

### How a deal update works

1. You ask for a change. The copilot calls a *preview* tool, which only reads the
   stored values and returns a pending decision with an id. Nothing is written.
2. You click **Confirm** or **Cancel**. The buttons talk to the API directly
   (`/api/confirm`), not to the model.
3. **Confirm** updates *every product line of the deal* in one transaction and
   writes an audit row per changed field. Only status, close date and win
   probability can change; prices and revenue are read-only.
4. **Cancel** drops the pending decision. There is no code path from cancel to
   the database.
5. The blocks whose data changed are rebuilt and streamed back; the page does not reload.

### Troubleshooting

| Symptom | Fix |
| --- | --- |
| `port is already allocated` on `make up` | something holds 5434 — stop it, or change the port in `docker-compose.yml` and `.env` |
| Chat answers `ANTHROPIC_API_KEY is not set` | add the key to `.env` and restart `make api` |
| API errors after `make reset` | restart `make api` |
| `make seed` cannot find a CSV | step 1 did not run — the files must be in `data/` |
| Empty dashboard, no deals in the sidebar | `make seed` has not run against this database |

### Icons

The UI uses Font Awesome Pro *Sharp Regular* glyphs. Only the glyphs the app
renders are vendored, in [web/src/lib/icons.ts](web/src/lib/icons.ts); the full
Pro package is not part of the repo. To use a new icon, copy its definition into
that file from your own licensed `@fortawesome/sharp-regular-svg-icons`.

## Commands

| Command | What it does |
| --- | --- |
| `make up` / `make down` | start / stop PostgreSQL |
| `make seed` | import both CSVs (`COPY`), refresh the rollup, `ANALYZE` |
| `make api` | FastAPI on :8000 |
| `make web` | Vite on :5173 (proxies `/api` to :8000) |
| `make check` | typecheck the frontend, import-check the backend |
| `make psql` | a shell on the database |
| `make reset` | drop the volume and rebuild from scratch |

## How the required workflow is wired

**Database answers.** Every figure comes from one of the tools in
[queries.py](api/app/queries.py). The model picks a tool and fills validated
parameters — it never writes SQL and never sees the dataset, only bounded
aggregated results. `order_entry` repeats on every product line of a deal, so
deal-level money is read from the `deal_summary` rollup (one row per deal) and
distinct deals are counted with `COUNT(DISTINCT source_opportunity_number)`.

**Three recommended deals.** `recommend_active_deals` ranks Active deals by
weighted value with named multipliers for an overdue close date, a renewal and a
decision due within 60 days. The query returns the components of the score, so
the answer explains the ranking instead of asserting it.

**A confirmed update, and moving a deal forward.** `preview_deal_advance` reads
the stored values and returns the decision: a row per field, the number of
affected product lines, what confirming does to the weighted pipeline, and a
`pending_id`. It contains no `UPDATE` and opens no transaction.
`preview_deal_update` is the same path for a single named field.

A decision can carry one, two or three fields, because "move this deal forward"
is rarely one: marking a deal Won also makes it 100% probable. Name the status
and leave the probability out and the preview fills it in — the brief pins Won
to 100 and Lost to 0 — and says on the card that it did, before anything is
written. A contradiction (Won at 40%) is refused by the contract.

The confirm button posts to `/api/confirm` — a human decision, not a model
decision — which applies **every field of the decision to every line of the
deal** in one transaction, so a deal is never left half-advanced. One audit row
is written per field inside that transaction; sharing `changed_at` is what lets
`/api/audit` show them both as separate writes and as the one decision a person
approved. Only status, close date and win probability can change.

**A cancelled update.** Cancel drops the pending object. There is no code path
from cancel to the database, so there is nothing to undo — the stored values were
never touched. Verify it in `make psql`:

```sql
SELECT DISTINCT close_date FROM sales_opportunities WHERE source_opportunity_number = '990600001';
SELECT * FROM deal_update_audit ORDER BY changed_at DESC LIMIT 5;
```

**Generated UI.** The agent emits validated blocks (`stats`, `chart`, `table`,
`findings`, `callout`, `preview`). Blocks are replaced by id, so a follow-up
prompt changes one component and leaves the rest exactly as they were — the
table's filter cannot move the chart's scope. After a saved edit the server
rebuilds only the blocks whose data the write touched and streams them back; the
page does not reload.

**Chart types, and changing them by asking.** Eleven forms, one per job a sales
question actually has — `line`, `area`, `bar`, `stacked-bar`, `horizontal-bar`,
`combo`, `pie`, `funnel`, `scatter`, `waterfall`, `heatmap`. The ones that earn
their place here:

| Form | The question it answers |
| --- | --- |
| `funnel` | Where do deals stop between Discovery and Negotiation? |
| `scatter` | Which deals are big, which are likely, which are out of time? |
| `waterfall` | What carried revenue from last period's total to this one's? |
| `heatmap` | Which cluster earns in which month? |
| `combo` | Pipeline against weighted pipeline — two measures, one axis |
| `horizontal-bar` | A ranking, or anything labelled with company names |

`change_chart_type` redraws a chart already on screen without re-running its
query, so "show that as a funnel" keeps the data, the scope and the filters and
changes only the form. `ChartBlock` validates the spec on the server: a scatter
without a second dimension, a funnel with two series or a combo with no line is
a validation error there rather than an empty panel in the browser. There is no
dual-axis chart anywhere — two measures of different magnitude are two charts.

## Designed for millions of rows

- Filtering, joins, sorting and aggregation happen in PostgreSQL. Nothing loads a
  table into Python, the browser or a prompt.
- Every row-returning tool is bounded (`LIMIT` + `OFFSET`, capped at 100 rows per
  page, 200 rows to the model).
- Indexes on partner, deal id, `(status, cluster)`, `close_date`, a GIN trigram
  index for name search, and `(partner, year, month_num)` on revenue.
- `statement_timeout` is set per role (5 s read, 10 s write), so a pathological
  query fails loudly instead of hanging the chat.
- The analytics pool connects as a role with no write privileges, so a bug in a
  query tool physically cannot change a deal.
- Deal-level aggregates come from a materialized view refreshed
  `CONCURRENTLY` after a confirmed write, not recomputed per question.

Show the planner using them:

```sql
EXPLAIN ANALYZE SELECT * FROM deal_summary WHERE status = 'Active' ORDER BY deal_value_eur DESC LIMIT 20;
```

## Limits we state rather than paper over

The two tables hold opportunities and monthly revenue. They contain no contacts,
account ownership, addresses, site counts, installed equipment, service usage,
real contract expiry dates or group hierarchy. `close_date` is a decision date,
not a contract end. Opportunity history is evidence of proposals, not an
inventory of what a customer runs.

Company names are real; **every figure is simulated hackathon data** and is not
any company's own reported results.

## Layout

```
api/app/contracts.py   tool inputs/outputs + the UI block spec (the shared contract)
api/app/queries.py     one parameterized SQL query per tool
api/app/blocks.py      query results → UI blocks
api/app/agent.py       Pydantic AI agent, 15 tools, conversation state
api/app/main.py        /api/chat (SSE), /api/confirm, /api/refresh, /api/deals
db/init/               schema, indexes, rollup, roles — run on first `make up`
web/src/components/blocks/   the component registry the agent composes views from
web/src/components/assistant/  the docked chat
web/src/components/DealsPanel.tsx  the Active deals list in the sidebar
web/src/types/blocks.ts      TypeScript mirror of contracts.py
```

[PLAN.md](PLAN.md) has the work split and the timeline. [docs/brief.md](docs/brief.md)
is the assignment.
