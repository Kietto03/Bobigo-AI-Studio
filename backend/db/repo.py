"""Data access for sessions, companions and projects.

The frontend keeps whole collections in memory and persists them as an array
(debounced). Each ``replace_*`` reconciles that array into the relational tables
inside a single transaction: rows whose id disappeared are deleted, present rows
are upserted, and messages are rewritten per parent. This keeps a real schema on
disk while letting the client stay with its simple "save the whole list" model.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

import asyncpg

# Message fields promoted to their own columns; everything else rides in `data`.
_CORE_MSG_KEYS = {"role", "content", "text", "reasoning", "pinned"}


def _parse_ts(value: Any) -> Optional[datetime]:
    if not value or not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _split_message(msg: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any] | None]:
    """Split a client message into (core columns, extra JSONB data)."""
    core: dict[str, Any] = {
        "role": msg.get("role") or "user",
        "content": msg.get("content"),
        "text": msg.get("text"),
        "reasoning": msg.get("reasoning"),
        "pinned": bool(msg.get("pinned")),
    }
    data = {k: v for k, v in msg.items() if k not in _CORE_MSG_KEYS and v is not None}
    return core, (data or None)


def _merge_message(row: asyncpg.Record) -> dict[str, Any]:
    """Rebuild a client-shaped message from a row (columns + JSONB extras)."""
    msg: dict[str, Any] = dict(row["data"] or {})
    msg["role"] = row["role"]
    if row["content"] is not None:
        msg["content"] = row["content"]
    if row["text"] is not None:
        msg["text"] = row["text"]
    if row["reasoning"] is not None:
        msg["reasoning"] = row["reasoning"]
    if row["pinned"]:
        msg["pinned"] = True
    return msg


# --------------------------------------------------------------------------- #
# Sessions
# --------------------------------------------------------------------------- #
async def get_sessions(pool: asyncpg.Pool) -> list[dict[str, Any]]:
    async with pool.acquire() as con:
        srows = await con.fetch(
            "SELECT id, title, project_id, pinned, created_at "
            "FROM sessions ORDER BY position NULLS LAST, created_at DESC"
        )
        mrows = await con.fetch(
            "SELECT session_id, role, content, text, reasoning, pinned, data "
            "FROM messages WHERE session_id IS NOT NULL ORDER BY session_id, seq"
        )
    by_session: dict[str, list[dict[str, Any]]] = {}
    for m in mrows:
        by_session.setdefault(m["session_id"], []).append(_merge_message(m))
    out = []
    for s in srows:
        item: dict[str, Any] = {
            "id": s["id"],
            "title": s["title"],
            "messages": by_session.get(s["id"], []),
        }
        if s["project_id"]:
            item["projectId"] = s["project_id"]
        if s["pinned"]:
            item["pinned"] = True
        if s["created_at"]:
            item["createdAt"] = s["created_at"].isoformat()
        out.append(item)
    return out


async def replace_sessions(pool: asyncpg.Pool, sessions: list[dict[str, Any]]) -> None:
    ids = [s.get("id") for s in sessions if s.get("id")]
    async with pool.acquire() as con:
        async with con.transaction():
            await con.execute(
                "DELETE FROM sessions WHERE NOT (id = ANY($1::text[]))", ids
            )
            for pos, s in enumerate(sessions):
                sid = s.get("id")
                if not sid:
                    continue
                await con.execute(
                    """INSERT INTO sessions (id, title, project_id, pinned, created_at, updated_at, position)
                       VALUES ($1, $2, $3, $4, COALESCE($5, now()), now(), $6)
                       ON CONFLICT (id) DO UPDATE SET
                         title = EXCLUDED.title,
                         project_id = EXCLUDED.project_id,
                         pinned = EXCLUDED.pinned,
                         updated_at = now(),
                         position = EXCLUDED.position""",
                    sid, s.get("title") or "", s.get("projectId"),
                    bool(s.get("pinned")), _parse_ts(s.get("createdAt")), pos,
                )
                await con.execute("DELETE FROM messages WHERE session_id = $1", sid)
                rows = []
                for i, m in enumerate(s.get("messages") or []):
                    core, data = _split_message(m)
                    rows.append((sid, None, i, core["role"], core["content"],
                                 core["text"], core["reasoning"], core["pinned"], data))
                if rows:
                    await con.executemany(
                        """INSERT INTO messages
                           (session_id, companion_id, seq, role, content, text, reasoning, pinned, data)
                           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)""",
                        rows,
                    )


async def append_session_message(pool: asyncpg.Pool, session_id: str, message: dict[str, Any]) -> int:
    """Append one message to a session WITHOUT rewriting the whole thread.

    Foundation for incremental persistence: unlike ``replace_sessions`` (which
    deletes and re-inserts every message of every touched parent), this only
    writes the new row and bumps the session's ``updated_at``.
    Returns the seq index assigned to the new message.
    """
    core, data = _split_message(message)
    async with pool.acquire() as con:
        async with con.transaction():
            seq = await con.fetchval(
                "SELECT COALESCE(MAX(seq) + 1, 0) FROM messages WHERE session_id = $1",
                session_id,
            )
            await con.execute(
                """INSERT INTO messages
                   (session_id, companion_id, seq, role, content, text, reasoning, pinned, data)
                   VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8)""",
                session_id, seq, core["role"], core["content"], core["text"],
                core["reasoning"], core["pinned"], data,
            )
            await con.execute(
                "UPDATE sessions SET updated_at = now() WHERE id = $1", session_id
            )
    return int(seq)


async def delete_session(pool: asyncpg.Pool, session_id: str) -> bool:
    """Remove one session and its messages. True if the session existed."""
    async with pool.acquire() as con:
        async with con.transaction():
            await con.execute("DELETE FROM messages WHERE session_id = $1", session_id)
            status = await con.execute("DELETE FROM sessions WHERE id = $1", session_id)
    return str(status).strip() in {"DELETE 1"}


# --------------------------------------------------------------------------- #
# Companions (each carries a single continuous chat)
# --------------------------------------------------------------------------- #
async def get_companions(pool: asyncpg.Pool) -> list[dict[str, Any]]:
    async with pool.acquire() as con:
        crows = await con.fetch(
            "SELECT id, name, emoji, avatar, tagline, persona, instructions, "
            "knowledge, language, created_at "
            "FROM companions ORDER BY position NULLS LAST, created_at DESC"
        )
        mrows = await con.fetch(
            "SELECT companion_id, role, content, text, reasoning, pinned, data "
            "FROM messages WHERE companion_id IS NOT NULL ORDER BY companion_id, seq"
        )
    by_comp: dict[str, list[dict[str, Any]]] = {}
    for m in mrows:
        by_comp.setdefault(m["companion_id"], []).append(_merge_message(m))
    out = []
    for c in crows:
        out.append({
            "id": c["id"],
            "name": c["name"],
            "emoji": c["emoji"],
            "avatar": c["avatar"],
            "tagline": c["tagline"],
            "persona": c["persona"],
            "instructions": c["instructions"],
            "knowledge": c["knowledge"] or [],
            "language": c["language"],
            "createdAt": c["created_at"].isoformat() if c["created_at"] else None,
            "messages": by_comp.get(c["id"], []),
        })
    return out


async def replace_companions(pool: asyncpg.Pool, companions: list[dict[str, Any]]) -> None:
    ids = [c.get("id") for c in companions if c.get("id")]
    async with pool.acquire() as con:
        async with con.transaction():
            await con.execute(
                "DELETE FROM companions WHERE NOT (id = ANY($1::text[]))", ids
            )
            for pos, c in enumerate(companions):
                cid = c.get("id")
                if not cid:
                    continue
                await con.execute(
                    """INSERT INTO companions
                       (id, name, emoji, avatar, tagline, persona, instructions,
                        knowledge, language, created_at, updated_at, position)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, COALESCE($10, now()), now(), $11)
                       ON CONFLICT (id) DO UPDATE SET
                         name = EXCLUDED.name, emoji = EXCLUDED.emoji, avatar = EXCLUDED.avatar,
                         tagline = EXCLUDED.tagline, persona = EXCLUDED.persona,
                         instructions = EXCLUDED.instructions, knowledge = EXCLUDED.knowledge,
                         language = EXCLUDED.language, updated_at = now(), position = EXCLUDED.position""",
                    cid, c.get("name") or "", c.get("emoji"), c.get("avatar"),
                    c.get("tagline") or "", c.get("persona") or "", c.get("instructions") or "",
                    c.get("knowledge") or [], c.get("language") or "vi",
                    _parse_ts(c.get("createdAt")), pos,
                )
                await con.execute("DELETE FROM messages WHERE companion_id = $1", cid)
                rows = []
                for i, m in enumerate(c.get("messages") or []):
                    core, data = _split_message(m)
                    rows.append((None, cid, i, core["role"], core["content"],
                                 core["text"], core["reasoning"], core["pinned"], data))
                if rows:
                    await con.executemany(
                        """INSERT INTO messages
                           (session_id, companion_id, seq, role, content, text, reasoning, pinned, data)
                           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)""",
                        rows,
                    )


# --------------------------------------------------------------------------- #
# Projects
# --------------------------------------------------------------------------- #
async def get_projects(pool: asyncpg.Pool) -> list[dict[str, Any]]:
    async with pool.acquire() as con:
        rows = await con.fetch(
            "SELECT id, name, description, instructions, color, knowledge, created_at "
            "FROM projects ORDER BY position NULLS LAST, created_at DESC"
        )
    return [{
        "id": r["id"],
        "name": r["name"],
        "description": r["description"],
        "instructions": r["instructions"],
        "color": r["color"],
        "knowledge": r["knowledge"] or [],
        "createdAt": r["created_at"].isoformat() if r["created_at"] else None,
    } for r in rows]


async def replace_projects(pool: asyncpg.Pool, projects: list[dict[str, Any]]) -> None:
    ids = [p.get("id") for p in projects if p.get("id")]
    async with pool.acquire() as con:
        async with con.transaction():
            await con.execute(
                "DELETE FROM projects WHERE NOT (id = ANY($1::text[]))", ids
            )
            for pos, p in enumerate(projects):
                pid = p.get("id")
                if not pid:
                    continue
                await con.execute(
                    """INSERT INTO projects
                       (id, name, description, instructions, color, knowledge, created_at, updated_at, position)
                       VALUES ($1,$2,$3,$4,$5,$6, COALESCE($7, now()), now(), $8)
                       ON CONFLICT (id) DO UPDATE SET
                         name = EXCLUDED.name, description = EXCLUDED.description,
                         instructions = EXCLUDED.instructions, color = EXCLUDED.color,
                         knowledge = EXCLUDED.knowledge, updated_at = now(), position = EXCLUDED.position""",
                    pid, p.get("name") or "", p.get("description") or "",
                    p.get("instructions") or "", p.get("color"),
                    p.get("knowledge") or [], _parse_ts(p.get("createdAt")), pos,
                )
