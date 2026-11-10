# AI Sales Copilot — projektový plán

3-členný tím. Povinný rozsah: analýza DB, odporučenie 3 Active dealov,
bezpečné úpravy dealu s potvrdením a zrušením. Voliteľné (v tomto poradí):
generované UI, potom web research.

Bodovanie: architektúra 20 · usability 20 · kreativita 20 · **prezentácia a demo 40**.
Z toho vyplýva hlavné pravidlo plánu: **radšej menej funkcií, ktoré fungujú a vieme
ich vysvetliť, než veľa polovičných.**

---

## 1. Technologický stack

| Vrstva | Voľba | Prečo |
| --- | --- | --- |
| DB | PostgreSQL 16 v Dockeri | zadanie to vyžaduje, agregácie v SQL |
| Backend | Python 3.12 + FastAPI | rýchle, typované, async |
| Agent | Pydantic AI | doporučené v zadaní, typované tooly |
| Frontend | React + Vite + Recharts | generované komponenty z JSON spec |
| Dev | docker-compose, uv/poetry, Makefile | `make up`, `make seed`, `make dev` |

---

## 2. Architektúra

```
React (chat + komponenty)
        │  HTTP/SSE
FastAPI  ── /chat (stream)  ── /data/<component_id>
        │
Pydantic AI agent  ──  typované tooly (Pydantic modely)
        │
SQL vrstva (ručne písané parametrizované dotazy)
        │
PostgreSQL  (read-only rola pre čítanie, write rola pre úpravy)
```

Kľúčové rozhodnutia, ktoré treba povedať aj v prezentácii:

1. **LLM nikdy nepíše SQL.** Vyberá si tool a vypĺňa validované parametre
   (enumy, dátumy, limity). Žiadny priestor na SQL injection ani na drahý dotaz.
2. **LLM nikdy nevidí celý dataset.** Tooly vracajú agregované, stránkované
   a úzke výsledky (desiatky riadkov, nie tisíce).
3. **Zápisy idú len cez jeden tool, až po explicitnom potvrdení používateľa.**
4. **Komponenty UI si ťahajú dáta samé**, cez vlastný endpoint — agent posiela
   iba konfiguráciu, nie dáta.

---

## 3. Dátový model

Dve tabuľky podľa CSV, ale s reálnymi typmi (nie všetko text):

```sql
CREATE TABLE sales_opportunities (
  id                      bigserial PRIMARY KEY,
  source_opportunity_number text NOT NULL,
  business_partner_number   text NOT NULL,
  business_partner_name     text NOT NULL,
  product_name              text NOT NULL,
  cluster                   text NOT NULL,
  total_price_eur           numeric(14,2) NOT NULL,
  order_entry               numeric(14,2) NOT NULL,
  won_lost_active_status    text NOT NULL,
  phase_label               text NOT NULL,
  win_probability_percent   smallint NOT NULL,
  opportunity_created_at    date NOT NULL,
  close_date                date NOT NULL,
  opportunity_type          text NOT NULL,
  closed_lost_comment       text
);

CREATE TABLE customer_revenue_monthly (
  business_partner_number text NOT NULL,
  year                    smallint NOT NULL,
  month_num               smallint NOT NULL,
  cluster                 text NOT NULL,
  revenue_monthly         numeric(14,2) NOT NULL
);
```

Indexy (bez nich sa „milióny riadkov" nedajú obhájiť):

```sql
CREATE INDEX ON sales_opportunities (business_partner_number);
CREATE INDEX ON sales_opportunities (source_opportunity_number);
CREATE INDEX ON sales_opportunities (won_lost_active_status, cluster);
CREATE INDEX ON sales_opportunities (close_date);
CREATE INDEX ON customer_revenue_monthly (business_partner_number, year, month_num);
```

Import: `COPY ... FROM STDIN WITH (FORMAT csv, HEADER true)` — nie insert po riadkoch.
Prázdny `closed_lost_comment` → NULL. Skript `scripts/seed.py`, príkaz `make seed`.

Audit tabuľka pre zápisy (lacná, ale v hodnotení pomôže):

```sql
CREATE TABLE deal_update_audit (
  id bigserial PRIMARY KEY, changed_at timestamptz DEFAULT now(),
  source_opportunity_number text, field text,
  old_value text, new_value text, rows_affected int
);
```

### Pasti v datasete

- `order_entry` je **zopakované na každom riadku** dealu → `SUM(order_entry)`
  hodnotu násobí. Používať `COUNT(DISTINCT source_opportunity_number)` a pri
  hodnote dealu `max()` per deal, alebo sumu `total_price_eur`.
- Pri cluster pohľade vždy napísať, či ide o **hodnotu zodpovedajúcich riadkov**
  alebo o **celú hodnotu dealov**, ktoré taký riadok obsahujú.
- Zmena percentuálna pri nulovej báze = „nedefinované", nie 0 % ani ∞.
- Uzavreté dealy filtrovať podľa `close_date`, nie `opportunity_created_at`.
- `phase_label` je snapshot — po editácii sa riadiť `won_lost_active_status`.
- Vážený pipeline = Active hodnota × pravdepodobnosť/100, **nie prognóza**.

---

## 4. Zoznam toolov (kontrakt medzi ľuďmi)

Toto je jediné miesto, kde sa tím prepája. Napísať ako Pydantic modely v
`app/contracts.py` **v prvej hodine**, potom každý pracuje proti typom.

| Tool | Vstup | Výstup |
| --- | --- | --- |
| `find_customer` | názov (fulltext) | kandidáti s `business_partner_number` |
| `get_account_briefing` | partner, obdobie | príjmy, počty dealov, Won/Lost sumár |
| `get_revenue_timeseries` | partner?, obdobie, group_by cluster? | mesačné body |
| `get_pipeline_by_cluster` | obdobie?, partner? | nevážená + vážená hodnota, počet dealov |
| `list_opportunities` | status, cluster?, partner?, sort, limit, offset | stránkované riadky |
| `compare_periods` | obdobie A, B, dimenzia | hodnoty, Δ absolútne a % |
| `top_customers_by_revenue` | rok/obdobie, limit | zákazníci + rozpad podľa clustera |
| `recommend_active_deals` | partner?, limit=3 | dealy + skóre + komponenty skóre |
| `preview_deal_update` | deal_id, pole, nová hodnota | staré hodnoty, počet riadkov, `pending_id` |
| `apply_deal_update` | `pending_id` | počet zmenených riadkov |

Povolené polia na zápis: `won_lost_active_status`, `close_date`,
`win_probability_percent`. Nič iné. Ceny a príjmy sú read-only.

Odporúčanie 3 dealov — vysvetliteľné skóre, nie čierna skrinka:

```
skóre = (hodnota_dealu × pravdepodobnosť/100)
        × (1.2 ak close_date < dnes)        -- po termíne, treba konať
        × (1.1 ak typ = Renewal)            -- riziko odchodu zákazníka
```

Tool vracia aj jednotlivé zložky, aby agent vedel povedať **prečo**.

---

## 5. Potvrdenie a zrušenie (najdôležitejšia povinná časť)

```
používateľ: "nastav 990600001 pravdepodobnosť na 60 %"
   → preview_deal_update:  SELECT starých hodnôt, diff, počet riadkov
                           uloží pending zmenu do pamäte session
                           ŽIADNY ZÁPIS
   → agent zobrazí: deal ID, pole, staré → nové, počet dotknutých
                    produktových riadkov, otázku "Potvrdiť alebo zrušiť?"
používateľ: "potvrdzujem"
   → apply_deal_update(pending_id): jedna transakcia,
     UPDATE ... WHERE source_opportunity_number = $1  (teda VŠETKY riadky dealu)
     + zápis do audit tabuľky
používateľ: "zruš"
   → zmaže pending objekt. Koniec. Žiadny rollback, lebo nebolo čo vracať.
```

Pravidlá implementácie:
- `apply_deal_update` sa **nedá** zavolať bez `pending_id` z preview.
- Potvrdenie musí prísť od používateľa (správa alebo tlačidlo), nie z rozhodnutia
  modelu — inak si to agent potvrdí sám.
- Cancel nesmie mať v kóde žiadnu cestu k databáze.
- Pending zmeny majú timeout (napr. 10 min) a sú viazané na session.

---

## 6. Generované UI (prvé rozšírenie, voliteľné)

Agent neposiela kód ani dáta — posiela **validovaný JSON spec** zo pevnej sady
komponentov. React má registry `{ summary_card, timeseries_chart, data_table }`.

```json
{ "layout": [
  { "id": "c1", "type": "summary_card",
    "query": "pipeline_by_cluster", "params": { "status": "Active" },
    "metric": "weighted_value", "title": "Vážený pipeline" },
  { "id": "c2", "type": "timeseries_chart",
    "query": "revenue_timeseries", "params": { "from": "2026-01", "to": "2026-10" },
    "chart": "line" },
  { "id": "c3", "type": "data_table",
    "query": "list_opportunities", "params": { "status": "Active", "cluster": "Security" },
    "sort": "order_entry desc", "page_size": 20 }
] }
```

- Follow-up prompt **patchuje spec** (zmena typu grafu, skrytie karty, filter),
  neregeneruje dashboard od nuly → používateľ nestratí kontext.
- Každý komponent si ťahá dáta z `/data/{id}` s vlastnými parametrami →
  filter v tabuľke nemôže potichu zmeniť rozsah grafu.
- Po uloženej editácii dealu backend vráti zoznam dotknutých `component_id`
  a frontend refetchne **iba tie**, bez reloadu stránky.
- Každý komponent má vlastný loading a error stav. Pomalý dotaz = viditeľná
  správa, nie zamrznuté UI.

## 7. Web research (druhé rozšírenie, iba ak zbytok funguje)

Jeden tool `research_risks(topic, industry)` → hľadanie + extrakcia. Výstup vždy
ako: **tvrdenie · zdroj URL · dátum publikovania · dátum prístupu · možný dopad
na zákazníka · navrhovaný ďalší krok.** Oddeliť „toto hovorí zdroj" od „toto si
myslíme my". Odvetvové riziko nie je dôkaz, že daný zákazník je zasiahnutý — a
v datasete nie je žiadna inventúra technológií, takže netvrdiť expozíciu.

---

## 8. Rozdelenie práce

### Osoba A — databáza a SQL vrstva
- docker-compose, schéma, indexy, COPY import, `make seed`
- read-only a write rola, `statement_timeout` na oboch pooloch
- každý tool = jeden ručne napísaný parametrizovaný dotaz
- transakčný update všetkých riadkov dealu + audit log
- skórovací dotaz pre 3 odporúčané dealy
- `EXPLAIN ANALYZE` na 3 najdrahších dotazoch → do prezentácie ako dôkaz

### Osoba B — agent a konverzácia
- Pydantic AI agent, systémový prompt, registrácia toolov
- stav konverzácie: vybraný zákazník, obdobie, filtre prežijú follow-up otázky
- preview / confirm / cancel stavový automat (celá sekcia 5 je jeho)
- oddeľovanie faktov z DB od odporúčaní; slušné odmietnutie pri dátach,
  ktoré dataset neobsahuje (kontakty, inventár, expirácia zmlúv)
- generovanie UI spec-u a jeho patchovanie podľa follow-up promptov
- v prvej hodine si tooly odstubuje fixnými dictami → nečaká na A

### Osoba C — frontend, UX a demo
- chat UI so streamovaním, loading a chybovými stavmi
- registry komponentov, render z JSON spec, refetch dotknutých komponentov
- čitateľné potvrdzovacie dialógy (deal ID, staré → nové, počet riadkov)
- **vlastník dema**: scenár, stav databázy pred demom, dve generálky
- README so setup krokmi (zadanie to vyžaduje)
- v prvej hodine si napíše spec JSON ručne → nečaká na B

---

## 9. Časový plán (model 24 h, prispôsobte dĺžke)

| Čas | Spolu / A / B / C |
| --- | --- |
| H+0 – H+0:45 | **Spolu:** stiahnuť CSV, docker Postgres, repo, `contracts.py` |
| H+0:45 – H+4 | A: schéma + import + 3 dotazy · B: agent + 2 tooly na stuboch · C: chat UI |
| H+4 | **Checkpoint 1:** jedna reálna otázka prejde celou cestou chat → SQL → odpoveď |
| H+4 – H+9 | A: ostatné dotazy + skórovanie · B: stav konverzácie + preview/confirm · C: tabuľka + karty |
| H+9 | **Checkpoint 2:** 3 odporúčané dealy + potvrdená aj zrušená úprava, overené v psql |
| H+9 – H+14 | voliteľné: generované UI (A: /data endpointy · B: spec + patch · C: registry, refetch) |
| H+14 | **Checkpoint 3:** zmena view cez chat + refresh po uložení |
| H+14 – H+17 | web research, iba ak checkpoint 3 sedí; inak dolaďovanie a chybové stavy |
| H+17 | **Feature freeze.** Žiadny nový kód. |
| H+17 – H+20 | README, prezentácia, rozdelenie rečí, dve generálky |
| H+20 – H+22 | rezerva na to, čo sa pokazí (vždy sa niečo pokazí) |

Pravidlo: **čo nie je hotové do checkpointu, ide z plánu von**, nie do noci.

---

## 10. Demo scenár (jeden spojený workflow, ~5 min)

1. „Priprav ma na schôdzku so Siemensom — naše príjmy z účtu za 1–10/2026,
   mesačný trend a otvorené príležitosti." → fakty z DB
2. „Rozdeľ ten príjem podľa clustera." → **dokazuje, že kontext sa drží**
3. „Na ktoré tri Active dealy sa mám zamerať a prečo?" → čísla + pravidlo
   prioritizácie + upozornenie na termíny po dátume
4. „Nastav príležitosti 990600001 pravdepodobnosť na 60 %." → preview →
   **potvrdiť** → `SELECT` v psql ukáže zmenu na všetkých riadkoch
5. „Presuň close date príležitosti 990600001 na 2026-12-15." → preview →
   **zrušiť** → `SELECT` ukáže nezmenené dátumy a zachovanú zmenu z bodu 4

Ak je dashboard hotový: body 1–3 vyrenderovať ako komponenty, medzi 3 a 4
ukázať „v tabuľke nechaj len Security a zmeň graf na líniový", a po bode 4
refresh dotknutých komponentov bez reloadu.

Rozdelenie rečí: každý hovorí o svojej vrstve ~1,5 min. Porota sa pýta
„prečo takto" — má odpovedať ten, kto to robil.

---

## 11. Riziká a čo s nimi

| Riziko | Opatrenie |
| --- | --- |
| Integrácia na konci nefunguje | 3 pevné checkpointy, stuby od prvej hodiny |
| Agent si potvrdí zmenu sám | potvrdenie len z používateľskej správy / tlačidla |
| Model halucinuje čísla | čísla do odpovede iba z výstupu toolu, nikdy z pamäte |
| Rate limit / výpadok LLM | záložný API kľúč alebo druhý model v configu |
| Demo spadne naživo | nahrať video záložne, mať pripravený čistý stav DB |
| Dataset je malý → riešenie „funguje len v pamäti" | agregácie v SQL, indexy, limity, `EXPLAIN` do slajdu |

## 12. Čo škrtnúť, keď zaostávate

Najprv web research, potom doladenie generovaného UI, potom grafy (tabuľky
stačia). Povinný rozsah — analýza, 3 dealy, potvrdená a zrušená úprava —
musí byť bezchybný.

## 13. Hranice dát (povedať nahlas, získava to body)

Dataset neobsahuje kontakty, vlastníka účtu, adresy, počty lokalít,
nainštalovanú techniku, spotrebu služieb, skutočnú expiráciu zmlúv ani
skupinovú štruktúru firiem. `close_date` je dátum rozhodnutia o deale, nie
koniec zmluvy. História príležitostí je dôkaz o ponukách, nie inventúra toho,
čo zákazník naozaj používa. Mená firiem sú reálne, **dáta sú simulované.**

## 14. Setup (musí byť v README)

```
docker compose up -d        # Postgres
make install                # python deps
make seed                   # schéma + COPY import oboch CSV
make dev                    # FastAPI + Vite
```
