-- Two roles, two connection pools. The analytics pool physically cannot write,
-- so a bug in a query tool cannot change a deal.

CREATE ROLE copilot_ro LOGIN PASSWORD 'copilot_ro';
CREATE ROLE copilot_rw LOGIN PASSWORD 'copilot_rw';

GRANT CONNECT ON DATABASE copilot TO copilot_ro, copilot_rw;
GRANT USAGE  ON SCHEMA public     TO copilot_ro, copilot_rw;

GRANT SELECT ON ALL TABLES IN SCHEMA public TO copilot_ro;
GRANT SELECT ON deal_summary                TO copilot_ro;

GRANT SELECT, UPDATE ON sales_opportunities              TO copilot_rw;
GRANT SELECT, INSERT ON deal_update_audit                TO copilot_rw;
GRANT USAGE  ON SEQUENCE deal_update_audit_id_seq        TO copilot_rw;
GRANT SELECT ON deal_summary, customer_revenue_monthly   TO copilot_rw;

-- The write role owns the deal-level rollup so it can refresh it right after a
-- confirmed update. REFRESH ... CONCURRENTLY needs the unique index above and
-- must run outside a transaction, so apply_deal_update does it on its own
-- autocommit connection once the write has committed.
ALTER MATERIALIZED VIEW deal_summary OWNER TO copilot_rw;

-- A tool call that takes longer than this is a bug, not a slow day.
ALTER ROLE copilot_ro SET statement_timeout = '5s';
ALTER ROLE copilot_rw SET statement_timeout = '10s';
-- Seeding uses the superuser, so the import is not affected by these.

-- New deals: the researcher's "create deal" path inserts one Active line,
-- behind the same preview → confirm step as an update.
GRANT INSERT ON sales_opportunities                  TO copilot_rw;
GRANT USAGE  ON SEQUENCE sales_opportunities_id_seq  TO copilot_rw;
