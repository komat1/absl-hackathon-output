#!/usr/bin/env python3
"""Import both CSVs with COPY, then refresh the deal-level rollup.

COPY, not row-by-row inserts: 5 102 lines go in as one stream, and the same
script would still be the right shape at five million.
"""
from __future__ import annotations

import sys
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.config import settings  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"

#: Columns the import is allowed to fill. The COPY column list is taken from the
#: file's own header and checked against this — so a re-ordered export still
#: imports correctly, and an unexpected column stops the import instead of
#: silently landing in the wrong field.
ALLOWED = {
    "sales_opportunities": {
        "source_opportunity_number", "business_partner_number", "business_partner_name",
        "product_name", "cluster", "total_price_eur", "order_entry", "won_lost_active_status",
        "phase_label", "win_probability_percent", "opportunity_created_at", "close_date",
        "opportunity_type", "closed_lost_comment",
    },
    "customer_revenue_monthly": {
        "business_partner_number", "year", "month_num", "revenue_monthly", "cluster",
    },
}

FILES = {
    "sales_opportunities": DATA / "sales_opportunities.csv",
    "customer_revenue_monthly": DATA / "customer_revenue_monthly.csv",
}


def columns_from_header(table: str, path: Path) -> str:
    header = path.open(encoding="utf-8-sig").readline().strip().split(",")
    names = [name.strip().strip('"') for name in header]
    unknown = set(names) - ALLOWED[table]
    missing = ALLOWED[table] - set(names)
    if unknown or missing:
        raise SystemExit(
            f"{path.name} does not match the {table} schema.\n"
            f"  unexpected columns: {sorted(unknown) or 'none'}\n"
            f"  missing columns:    {sorted(missing) or 'none'}"
        )
    return ", ".join(names)


def main() -> int:
    missing = [str(path) for path in FILES.values() if not path.exists()]
    if missing:
        print("Missing CSV files:\n  " + "\n  ".join(missing))
        print(
            "\nPut both files in data/ first:\n"
            "  curl -fsSL -o data/sales_opportunities.csv "
            "https://raw.githubusercontent.com/richardkocian/absl-hackathon/main/sales_opportunities.csv\n"
            "  curl -fsSL -o data/customer_revenue_monthly.csv "
            "https://raw.githubusercontent.com/richardkocian/absl-hackathon/main/customer_revenue_monthly.csv"
        )
        return 1

    with psycopg.connect(settings().dsn_admin, autocommit=False) as conn:
        for table, path in FILES.items():
            columns = columns_from_header(table, path)
            print(f"→ {table}: {path.name}")
            print(f"  columns: {columns}")
            with conn.cursor() as cur:
                cur.execute(f"TRUNCATE {table}")
                with cur.copy(
                    f"COPY {table} ({columns}) FROM STDIN WITH (FORMAT csv, HEADER true)"
                ) as copy:
                    with path.open("rb") as handle:
                        while chunk := handle.read(1 << 20):
                            copy.write(chunk)
                cur.execute(f"SELECT count(*) FROM {table}")
                print(f"  rows: {cur.fetchone()[0]:,}")
        conn.commit()

    # The rollup is created empty at init time; after an import it has to catch
    # up. Not CONCURRENTLY here — the first refresh of an empty view cannot be.
    with psycopg.connect(settings().dsn_admin, autocommit=True) as conn:
        conn.execute("REFRESH MATERIALIZED VIEW deal_summary")
        conn.execute("ANALYZE sales_opportunities")
        conn.execute("ANALYZE customer_revenue_monthly")
        deals = conn.execute("SELECT count(*) FROM deal_summary").fetchone()[0]
        print(f"→ deal_summary: {deals:,} distinct deals")

    print("\nDone. Start the API with `make api`.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
