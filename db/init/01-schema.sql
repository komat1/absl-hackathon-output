-- Sales copilot schema.
-- Trigram search so a partial company name is an index lookup, not a table scan.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Real types, not all-text: dates compare and index, amounts add up exactly.

CREATE TABLE sales_opportunities (
  id                        bigserial PRIMARY KEY,
  source_opportunity_number text          NOT NULL,
  business_partner_number   text          NOT NULL,
  business_partner_name     text          NOT NULL,
  product_name              text          NOT NULL,
  cluster                   text          NOT NULL,
  total_price_eur           numeric(14,2) NOT NULL,
  order_entry               numeric(14,2) NOT NULL,
  won_lost_active_status    text          NOT NULL,
  phase_label               text          NOT NULL,
  win_probability_percent   smallint      NOT NULL,
  opportunity_created_at    date          NOT NULL,
  close_date                date          NOT NULL,
  opportunity_type          text          NOT NULL,
  closed_lost_comment       text,
  CONSTRAINT status_values CHECK (won_lost_active_status IN ('Active','Won','Lost')),
  CONSTRAINT probability_range CHECK (win_probability_percent BETWEEN 0 AND 100)
);

CREATE TABLE customer_revenue_monthly (
  business_partner_number text          NOT NULL,
  year                    smallint      NOT NULL,
  month_num               smallint      NOT NULL,
  cluster                 text          NOT NULL,
  revenue_monthly         numeric(14,2) NOT NULL,
  PRIMARY KEY (business_partner_number, year, month_num, cluster),
  CONSTRAINT month_range CHECK (month_num BETWEEN 1 AND 12)
);

-- Indexes. Every tool query is written to hit one of these; without them the
-- "millions of rows" claim is just a claim.
CREATE INDEX opp_partner_idx      ON sales_opportunities (business_partner_number);
CREATE INDEX opp_deal_idx         ON sales_opportunities (source_opportunity_number);
CREATE INDEX opp_status_clu_idx   ON sales_opportunities (won_lost_active_status, cluster);
CREATE INDEX opp_close_idx        ON sales_opportunities (close_date);
CREATE INDEX opp_name_trgm_idx    ON sales_opportunities USING gin (business_partner_name gin_trgm_ops);
CREATE INDEX rev_partner_per_idx  ON customer_revenue_monthly (business_partner_number, year, month_num);
CREATE INDEX rev_period_idx       ON customer_revenue_monthly (year, month_num);

-- Distinct deals, pre-aggregated: one row per opportunity instead of per product
-- line. `order_entry` repeats on every line of a deal, so a deal-level view is
-- the only safe place to sum it. Refreshed after a confirmed write.
CREATE MATERIALIZED VIEW deal_summary AS
SELECT
  source_opportunity_number,
  min(business_partner_number)  AS business_partner_number,
  min(business_partner_name)    AS business_partner_name,
  max(order_entry)              AS deal_value_eur,
  min(won_lost_active_status)   AS status,
  min(opportunity_type)         AS opportunity_type,
  min(win_probability_percent)  AS win_probability_percent,
  min(close_date)               AS close_date,
  min(opportunity_created_at)   AS opportunity_created_at,
  count(*)                      AS line_count,
  array_agg(DISTINCT cluster ORDER BY cluster) AS clusters
FROM sales_opportunities
GROUP BY source_opportunity_number;

CREATE UNIQUE INDEX deal_summary_pk   ON deal_summary (source_opportunity_number);
CREATE INDEX deal_summary_partner_idx ON deal_summary (business_partner_number);
CREATE INDEX deal_summary_status_idx  ON deal_summary (status, close_date);

-- Every confirmed write leaves a trace. Cancelled previews never reach here.
CREATE TABLE deal_update_audit (
  id            bigserial PRIMARY KEY,
  changed_at    timestamptz NOT NULL DEFAULT now(),
  deal_id       text        NOT NULL,
  field         text        NOT NULL,
  old_value     text,
  new_value     text        NOT NULL,
  rows_affected integer     NOT NULL,
  actor         text        NOT NULL DEFAULT 'copilot'
);

CREATE INDEX audit_deal_idx ON deal_update_audit (deal_id, changed_at DESC);
