# AI Sales Copilot — ABSL hackathon

Team of 3 students. Build an **English-language** sales copilot chatbot over a
PostgreSQL database of simulated telecom sales data: analyze accounts and pipeline,
recommend three Active deals, and apply deal updates behind an explicit
confirm/cancel step.

## Knowledge base

| File | What it holds |
| --- | --- |
| `docs/brief.md` | The organizers' assignment: scope, dataset field guide, data-generation rules, judging criteria, cancellation test. **Source of truth — follow it over anything inferred.** |
| `PLAN.md` | Our implementation plan (in Slovak): architecture, DDL, tool contract, work split across the 3 people, timeline with checkpoints, demo script. |
| `README.md` | Setup steps and how each required feature is wired. This is what the judges read. |

Read `docs/brief.md` before answering questions about required behaviour, field
meanings or what the data does not contain.

## Status

The skeleton runs end to end. Backend, database and frontend are in place and
verified; what is missing is the data and a key.

- **Data is loaded:** 5,102 product lines, 2,000 distinct deals, 14,400 revenue
  rows, imported with `COPY` from `data/`. The CSVs are gitignored — a fresh
  clone downloads them (README step 1) and runs `make seed`.
- **The agent runs.** The full demo scenario was driven over the live API
  (briefing → follow-up that keeps context → three deals → confirmed update →
  cancelled update) and behaves correctly.
- **Verified:** schema, roles and rollup are created by `make up`; the query layer,
  every tool runs against the real dataset in 1–35 ms; the preview/confirm/cancel
  path and the audit trail were smoke-tested (cancel wrote nothing, a confirmed
  update hit every product line, a pending id could not be replayed). The
  frontend typechecks, builds and renders every block type.
- **The demo deal is untouched:** `990600001` (Siemens, 2 lines, Active, close
  date 2026-11-20, 40%) has never been written to. Keep it that way until the
  demo. `deal_update_audit` is **no longer empty**: testing the multi-field
  advance left one confirmed decision on deal `990601977` (Active → Won, 90 →
  100%, 2 lines, ids 4–5). Ids start at 4 because a rolled-back test consumed
  1–3; sequences do not roll back. Run `make reset` before the demo if the trail
  should start clean on stage — it also puts `990601977` back to Active. If it
  ever needs resetting again: `make reset` (drops the volume, re-imports, and
  the API must be restarted afterwards, since its pools hold dead connections).
- PostgreSQL is on host port **5434** — 5433 is taken by another project on this
  machine.
- The `*.png` / `*.webp` files in the root are event sponsor logos, not project
  assets.

### Where things are

```
api/app/contracts.py   tool inputs/outputs + the UI block spec — the shared contract
                       (ChartKind + CHART_JOBS: the 11 chart forms and what each is for)
api/app/queries.py     one hand-written parameterized query per tool
api/app/blocks.py      query results → UI blocks
api/app/agent.py       Pydantic AI agent, 15 tools, conversation state
api/app/main.py        /api/chat (SSE), /api/confirm, /api/refresh, /api/deals, /api/health
api/scripts/seed.py    COPY import of both CSVs + rollup refresh
db/init/               schema, indexes, deal_summary rollup, the two roles
web/src/components/blocks/      the component registry (stats/chart/table/findings/callout/preview)
web/src/components/blocks/charts/  one component per chart form; ChartView dispatches
web/src/lib/chartColors.ts      which colour a mark wears: categorical, sequential or status
web/src/components/assistant/   the docked chat
web/src/components/Sidebar.tsx   the left panel: the places (dashboard, researcher, my changes)
web/src/components/DealsPanel.tsx  the Active book under them — searched in SQL,
                               refetched when a turn ends; a row asks the copilot
web/src/components/tabs/        the tab strip (favourites first, then open) + the
                               closed-dashboard history, in the chat header
web/src/stores/dashboards.ts    one dashboard per tab: own blocks, own chat, own session
web/src/types/blocks.ts         TypeScript mirror of contracts.py
```

Changing a tool means touching `contracts.py`, `queries.py`, `blocks.py`,
`agent.py` and `web/src/types/blocks.ts`. Keep the Python and TypeScript block
definitions in step — the server validates, the client renders, and a silent
mismatch shows up as a missing component.

## UI provenance

The design system, icons and UI primitives are lifted from the user's own admin
panel at `/Users/matejkolestik/Desktop/fitko_manazment/apps/client`:

- `web/src/styles.css` is that app's design system, copied as-is (flat dark
  system, `--raise` / `--nest` surface ladder, brand red `#c42329`, one hairline
  pinned to a whole device pixel by `lib/hairline.ts`). **Light is the default**
  (`lib/theme.ts`), the way the admin panel looks with the lights on: white page,
  white cards, and the FRAME — sidebar, topbar, tab row — in the opposite theme,
  near-black, because `.theme-frame` carries the dark ladder in both themes.
  `<html class="dark">` turns the page over; the frame stays dark.
- `web/src/components/ui/` are its primitives (Icon, Button, Badge, Panel,
  Metric, Delta, EmptyState, SectionHeader, Skeleton, StatStrip, PillTabs),
  copied with the i18n calls stripped — this app is English-only.
- Icons are FontAwesome **sharp-regular**; only the glyphs the app uses are vendored, in
  `web/src/lib/icons.ts` (the Pro package and the kit are not in the repo). They are
  registered by name in `main.tsx`, so components pass strings like
  `"fa-sharp fa-regular fa-chart-line"`. Use that style, not imported glyphs.
- The chat is the admin's docked assistant pattern (`.dock-panel` in
  `components/ui/dockPanel.css`, right column `.ai-dock`); the generated blocks
  follow its AI analyst block pattern.

When styling something new, reach for an existing recipe in `styles.css`
(`.panel`, `.metric-card`, `.badge`, `.primary-button`, `.delta`, `.icon-button`,
`.analyst-lift`, `.animate-block-in`) before writing new CSS.

## Hard rules

These come from the brief and from our own architecture decisions. Do not relax
them without the team deciding to.

1. **The LLM never writes SQL.** It picks a typed tool and fills validated
   parameters. Every query is hand-written and parameterized.
2. **The LLM never receives the dataset.** Tools return aggregated, bounded,
   narrow result sets — tens of rows, not thousands.
3. **Aggregate in PostgreSQL**, never in Python, the browser or a prompt. Indexes
   and `statement_timeout` on every pool. Design for millions of rows.
4. **Writes only via `apply_deal_update`**, keyed by a `pending_id` produced by
   `preview_deal_advance` (or `preview_deal_update`, which is the one-field
   wrapper over it), after an explicit human confirmation. Writable fields:
   `won_lost_active_status`, `close_date`, `win_probability_percent`. Nothing else.
   Prices and revenue are read-only. **A decision may carry one, two or three of
   those fields** — "move this deal forward" is usually status *and* probability
   — and there is exactly one write function, not one per field.
5. **One update = all product lines of the deal**, in one transaction
   (`WHERE source_opportunity_number = $1`), including lines hidden by a UI filter.
   Every field of the decision moves in that same `UPDATE`, so a deal is never
   left half-advanced (Won with a stale 40%). One audit row is written per field
   inside that transaction; they share `changed_at`, which is what groups them
   back into the single decision a human confirmed — `audit_decisions()` and
   `/api/audit` read them both ways.
6. **Cancel performs no write.** It discards the pending object. There must be no
   code path from cancel to the database, and no save-then-restore.
7. **Generated UI renders predefined components from a validated JSON spec.** No
   AI-generated code is executed. Each component fetches its own data so one
   filter cannot silently change another component's scope.
8. **Separate database facts from recommendations** (and from cited web facts).
   Numbers in an answer come only from a tool result, never from model memory.
9. When the data cannot answer something (contacts, installed equipment, contract
   expiry, group structure), say so and offer what the data does support. Never
   invent it.
10. **Confirm and cancel happen outside the model.** The buttons post to
   `/api/confirm`; the agent has no tool that the UI's decision routes through.
   Because of that, `record()` in `main.py` appends a `[system note …]` turn to
   the agent's history saying what the click did — otherwise the next answer
   contradicts the screen ("that change is still waiting"). The note is phrased
   as a record and the system prompt tells the agent never to call a tool
   because of one; both halves are load-bearing, and loosening either made the
   agent try to re-apply a change that was already saved. `deal_detail` returns
   `stored_now` straight from `sales_opportunities` so it can verify a save.

## Dataset traps

- `order_entry` is repeated on **every line** of a deal → `SUM(order_entry)`
  multiplies deal value. Use `COUNT(DISTINCT source_opportunity_number)`, and
  per-deal `max()` or a sum of `total_price_eur`.
- Always label whether a cluster figure covers only matching product lines or the
  full value of deals containing such a line.
- Percentage change against a zero base is **undefined** — state it, don't print 0.
- Closed-deal history filters on `close_date`, not `opportunity_created_at`.
- `phase_label` is a snapshot; after edits use `won_lost_active_status`. The
  funnel (`pipeline_funnel`) groups by it, so its note has to say that the phase
  split is historical while the status filter is live.
- Weighted pipeline = Active value × probability/100. Never call it forecast or
  guaranteed revenue.
- Reference date is **2026-10-31**; revenue after 2026-10 is future, not historical.
- Company names are real, **all business data is simulated.** Keep that disclaimer
  visible in the app and the demo.

## Stack

PostgreSQL 16 in Docker (host port 5434) · Python 3.13 + FastAPI + psycopg 3 ·
Pydantic AI · React 19 + Vite + Tailwind v4 + Recharts + zustand.
`make up` / `make seed` / `make api` / `make web` / `make check`.

## Conventions

- Tool inputs and outputs are Pydantic models in `app/contracts.py` — the single
  coupling point between the three people. Change it deliberately.
- Amounts are `numeric`, dates are `date`. Don't store everything as text.
- Two DB roles: read-only for analytics, write for updates. Audit every write to
  `deal_update_audit`.
- Keep conversation state (selected customer, period, filters) in a typed
  dependency object, not in the prompt.
