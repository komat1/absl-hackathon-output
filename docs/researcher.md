# Researcher tab — brief

A third place in the left rail, next to **View** and **Audit**: a web researcher
that puts public context around an account before a meeting, with sources and
dates. This is optional feature **4** of the organizers' brief and section **7**
of `PLAN.md` — the last thing we build and the first thing we cut.

## Where it comes from

| Source | What it says |
| --- | --- |
| `docs/brief.md` → Scope, optional #4 | "public company/industry context (cybersecurity, service continuity, technology lifecycle, regulatory risk) with sources and dates, turned into **discussion topics, discovery questions and next steps**" |
| `docs/brief.md` → Deliverables | the demo, if this is implemented, ends with "research findings with sources and dates" |
| `PLAN.md` §7 | one tool `research_risks(topic, industry)`; output is always **claim · source URL · published date · accessed date · possible impact on the customer · suggested next step**; separate "the source says this" from "we think this" |
| `PLAN.md` §12 | web research is **the first thing to drop** if we are behind |
| `PLAN.md` §13 | the dataset holds no installed equipment, so industry risk is never evidence that *this* customer is exposed |

Judging-wise this is a **Creativity** play (20 pts) and a closing beat for the
**Presentation** (40 pts). It earns nothing if it dents the required path.

## Where it goes in the code

The rail is the app's only set of *places* — everything else is a question.
Adding one means:

| File | Change |
| --- | --- |
| `web/src/components/Rail.tsx` | `ViewKey = "canvas" \| "audit" \| "research"`, one more entry in `PAGES` (icon `fa-sharp fa-regular fa-magnifying-glass-chart` or `fa-binoculars`), label `Research` |
| `web/src/components/Shell.tsx` | `DashboardTabs` already renders only for `canvas`, so the research page gets no tab strip — nothing to change unless it needs one |
| `web/src/App.tsx` | third branch in the view switch |
| `web/src/components/Research.tsx` | the page itself |

`Rail.tsx` carries a comment explaining why the rail holds only two things —
update it, don't leave it contradicting the screen.

### Conversation model

Pick one deliberately and say which in the demo:

- **Recommended:** the research page has **its own session** (same pattern as a
  dashboard tab in `stores/dashboards.ts`), so asking "what's happening in
  automotive manufacturing?" there does not pollute the pipeline conversation,
  and the account picked on the canvas can still be read from `current_context`.
- Cheaper: research is just more tools on the existing agent and the tab is a
  filtered view of research blocks. Less code, muddier demo.

### Block contract

`FindingsBlock` is close but not enough: `FindingsView.tsx` pins a
`fa-database` icon to every evidence line, which is a lie for a web citation.
Either add a `source` variant to `FindingItem` (`url`, `published`, `accessed`,
`publisher`) and branch the icon, or add a `ResearchBlock`. Either way the
change lands in all four coupling points — `api/app/contracts.py`,
`api/app/blocks.py`, `api/app/agent.py`, `web/src/types/blocks.ts` — plus the
component registry in `web/src/components/blocks/BlockView.tsx`.

## What should be possible with it

### 1. Account context before a meeting
Given the selected customer (or a typed name), find public, dated signals in the
four categories the brief names: **cybersecurity**, **service continuity**,
**technology lifecycle**, **regulatory risk**. Each item: what the source says,
who published it, when, and what it might mean for a telecom conversation.

### 2. Industry context
Same for a sector or topic, when the account itself is quiet — "security
incidents in automotive suppliers", "NIS2 deadlines for mid-size manufacturers".
Industry risk is a *topic*, never a claim about the account.

### 3. Turn findings into a meeting
The output a sales person actually uses:
- **discussion topics** — three things worth raising, each tied to a finding;
- **discovery questions** — open questions that *test* whether the risk applies,
  since the data cannot tell us (e.g. "who handles your out-of-hours network
  escalation today?");
- **next steps** — a concrete follow-up per topic.

### 4. Tie research to the pipeline, without faking a link
The strongest demo moment: an Active deal in Security cluster next to a dated
public signal in the same area — labelled as *two separate facts side by side*,
our inference stated as ours. `recommend_deals` output is the natural anchor.

### 5. Prospect research — the "potential clients" extension
Beyond the organizers' wording, and worth it only if the rest is solid. The
dataset has **30 existing accounts and no prospects**, so this cannot pretend to
score a pipeline it has no data for. Honest version: given an existing won
customer as a profile ("mid-size Czech manufacturer buying Security"), find
public companies that resemble it, and present each as **a candidate with its
sources and the reason it matches** — explicitly a research suggestion, with no
figures, no probability and no fake deal record. Never write a prospect into the
database; the only writable path in this app stays `apply_deal_update`.

### 6. Say when it found nothing
A real possibility for simulated accounts. "No dated public source found for
this in the last 24 months" is a valid, point-scoring answer. Never fill the gap
from model memory.

## Hard rules it inherits

1. **Every claim carries a URL and a publication date**, plus the date we
   accessed it. No date, no claim.
2. **Database facts, cited web facts and our recommendations are three visually
   separate things.** Rule 8 of `CLAUDE.md` extends to this tab.
3. **Never assert customer exposure.** The data has no technology inventory, no
   contract expiry, no contacts, no group structure. "This vendor published a
   CVE" is not "your customer is vulnerable" — phrase it as a question to ask.
4. **Numbers from tools only.** A figure in a research answer comes from a tool
   result or a cited source, never from the model.
5. **Research performs no writes** and has no path to the write pool.
6. **The simulation disclaimer stays visible**: real company names, invented
   business data. Research results are real and public; everything next to them
   in this app is simulated. The tab has to say so, or we have mixed real and
   fake data on one screen — the one way this feature could lose us points.
7. **Bounded output.** Tens of findings at most, same as every other tool. The
   model never receives a raw page dump beyond what it needs to quote.
8. **Visible failure.** No key, no network, rate limit → the page says so. It
   must not take the rest of the app down with it.

## Scope discipline

Build it **after** the required path is demo-perfect, on a branch, and judge it
by one question: does the required demo still run untouched? The demo deal
`990600001` and an empty `deal_update_audit` are not negotiable for this
feature's sake.
