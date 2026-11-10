"""Database access: two pools, one of which cannot write.

Every query in queries.py goes through `rows()` or `one()`. Both take SQL with
placeholders and a parameter tuple — string interpolation never happens, so a
value coming from the model cannot change the shape of a query.
"""
from __future__ import annotations

from contextlib import contextmanager
from decimal import Decimal
from typing import Any, Iterator, Sequence

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .config import settings

_ro: ConnectionPool | None = None
_rw: ConnectionPool | None = None


def _pool(dsn: str) -> ConnectionPool:
    return ConnectionPool(dsn, min_size=1, max_size=8, open=True, timeout=5.0, kwargs={"row_factory": dict_row})


def ro() -> ConnectionPool:
    global _ro
    if _ro is None:
        _ro = _pool(settings().dsn_ro)
    return _ro


def rw() -> ConnectionPool:
    global _rw
    if _rw is None:
        _rw = _pool(settings().dsn_rw)
    return _rw


def close_pools() -> None:
    for pool in (_ro, _rw):
        if pool is not None:
            pool.close()


@contextmanager
def write_tx() -> Iterator[Any]:
    """One transaction on the write pool. Commits on exit, rolls back on error."""
    with rw().connection() as conn:
        with conn.cursor() as cur:
            yield cur


def rows(sql: str, params: Sequence[Any] = ()) -> list[dict[str, Any]]:
    with ro().connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, tuple(params))
            return [_clean(r) for r in cur.fetchall()]


def one(sql: str, params: Sequence[Any] = ()) -> dict[str, Any] | None:
    found = rows(sql, params)
    return found[0] if found else None


def _clean(row: dict[str, Any]) -> dict[str, Any]:
    """Decimal and date are not JSON — and the model reads JSON."""
    out: dict[str, Any] = {}
    for key, value in row.items():
        if isinstance(value, Decimal):
            out[key] = float(value)
        elif hasattr(value, "isoformat"):
            out[key] = value.isoformat()
        else:
            out[key] = value
    return out


def explain(sql: str, params: Sequence[Any] = ()) -> str:
    """For the presentation: show that the planner uses the indexes."""
    with ro().connection() as conn:
        with conn.cursor() as cur:
            cur.execute("EXPLAIN (ANALYZE, BUFFERS) " + sql, tuple(params))
            return "\n".join(str(r["QUERY PLAN"]) for r in cur.fetchall())
