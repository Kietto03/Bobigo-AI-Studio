"""asyncpg connection pool + schema bootstrap for Bobigo AI Studio."""

from __future__ import annotations

import json
import logging
import os
from typing import Optional

import asyncpg

from backend.config import DATABASE_URL

_SCHEMA_PATH = os.path.join(os.path.dirname(__file__), "schema.sql")

log = logging.getLogger(__name__)


async def _init_conn(con: asyncpg.Connection) -> None:
    # Transparently encode/decode JSON(B) columns to/from Python objects so the
    # repo layer can pass dicts/lists directly and get them back the same way.
    await con.set_type_codec(
        "jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog"
    )
    await con.set_type_codec(
        "json", encoder=json.dumps, decoder=json.loads, schema="pg_catalog"
    )


async def create_pool() -> asyncpg.Pool:
    """Open a connection pool. Raises if Postgres is unreachable."""
    return await asyncpg.create_pool(
        dsn=DATABASE_URL,
        init=_init_conn,
        min_size=1,
        max_size=5,
        command_timeout=30,
    )


async def init_schema(pool: asyncpg.Pool) -> None:
    with open(_SCHEMA_PATH, "r", encoding="utf-8") as fh:
        ddl = fh.read()
    async with pool.acquire() as con:
        await con.execute(ddl)


async def open_database() -> Optional[asyncpg.Pool]:
    """Create the pool and apply the schema; return None if Postgres is down.

    Kept resilient on purpose: the app (and the test suite, which spins up the
    lifespan without a database) must still boot when Postgres is unavailable.
    """
    try:
        pool = await create_pool()
        await init_schema(pool)
        return pool
    except Exception as exc:  # noqa: BLE001 — never block startup on the DB
        log.warning("Database unavailable, persistence disabled: %s", exc)
        return None
