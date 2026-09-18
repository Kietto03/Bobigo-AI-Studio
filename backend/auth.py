"""Authentication: users, password hashing (PBKDF2, stdlib), cookie sessions.

Single shared Postgres, now scoped per user. The first run bootstraps an admin
and assigns any pre-existing (shared) data to it.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import asyncpg

COOKIE_NAME = "bobigo_session"
SESSION_TTL_DAYS = 30
_ITERATIONS = 200_000


# --------------------------------------------------------------------------- #
# Passwords
# --------------------------------------------------------------------------- #
def hash_password(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), _ITERATIONS)
    return f"pbkdf2${_ITERATIONS}${salt}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _algo, iters, salt, digest = stored.split("$")
        dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), int(iters))
        return hmac.compare_digest(dk.hex(), digest)
    except Exception:  # noqa: BLE001
        return False


def _pub(row: Optional[dict]) -> Optional[dict]:
    """Public-safe user dict (no password hash)."""
    if not row:
        return None
    return {
        "id": row["id"],
        "username": row["username"],
        "role": row["role"],
        "disabled": row["disabled"],
        "created_at": row["created_at"].isoformat() if row.get("created_at") else None,
        "last_login": row["last_login"].isoformat() if row.get("last_login") else None,
    }


# --------------------------------------------------------------------------- #
# Users
# --------------------------------------------------------------------------- #
async def create_user(pool: asyncpg.Pool, username: str, password: str, role: str = "user") -> dict:
    username = (username or "").strip()
    if not username or not password:
        raise ValueError("Thiếu tên đăng nhập hoặc mật khẩu")
    if len(password) < 4:
        raise ValueError("Mật khẩu quá ngắn (tối thiểu 4 ký tự)")
    async with pool.acquire() as con:
        try:
            row = await con.fetchrow(
                "INSERT INTO users (username, password_hash, role) VALUES ($1,$2,$3) "
                "RETURNING id, username, role, disabled, created_at, last_login",
                username, hash_password(password), "admin" if role == "admin" else "user",
            )
        except asyncpg.UniqueViolationError as exc:
            raise ValueError("Tên đăng nhập đã tồn tại") from exc
    return _pub(dict(row))


async def get_user_by_username(pool: asyncpg.Pool, username: str) -> Optional[dict]:
    async with pool.acquire() as con:
        r = await con.fetchrow("SELECT * FROM users WHERE lower(username)=lower($1)", (username or "").strip())
    return dict(r) if r else None


async def list_users(pool: asyncpg.Pool) -> list[dict]:
    async with pool.acquire() as con:
        rows = await con.fetch(
            "SELECT u.id, u.username, u.role, u.disabled, u.created_at, u.last_login, "
            "(SELECT count(*) FROM sessions s WHERE s.user_id = u.id) AS chats "
            "FROM users u ORDER BY u.created_at"
        )
    return [{**_pub(dict(r)), "chats": r["chats"]} for r in rows]


async def set_password(pool: asyncpg.Pool, user_id: int, password: str) -> None:
    if len(password or "") < 4:
        raise ValueError("Mật khẩu quá ngắn")
    async with pool.acquire() as con:
        await con.execute("UPDATE users SET password_hash=$1 WHERE id=$2", hash_password(password), user_id)
        await con.execute("DELETE FROM auth_sessions WHERE user_id=$1", user_id)  # force re-login


async def set_disabled(pool: asyncpg.Pool, user_id: int, disabled: bool) -> None:
    async with pool.acquire() as con:
        await con.execute("UPDATE users SET disabled=$1 WHERE id=$2", disabled, user_id)
        if disabled:
            await con.execute("DELETE FROM auth_sessions WHERE user_id=$1", user_id)


async def delete_user(pool: asyncpg.Pool, user_id: int) -> None:
    async with pool.acquire() as con:
        await con.execute("DELETE FROM users WHERE id=$1", user_id)


# --------------------------------------------------------------------------- #
# Sessions (auth tokens)
# --------------------------------------------------------------------------- #
async def login(pool: asyncpg.Pool, username: str, password: str) -> Optional[tuple[str, dict]]:
    user = await get_user_by_username(pool, username)
    if not user or user["disabled"] or not verify_password(password, user["password_hash"]):
        return None
    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(days=SESSION_TTL_DAYS)
    async with pool.acquire() as con:
        await con.execute(
            "INSERT INTO auth_sessions (token, user_id, expires_at) VALUES ($1,$2,$3)",
            token, user["id"], expires,
        )
        await con.execute("UPDATE users SET last_login=now() WHERE id=$1", user["id"])
    return token, _pub(user)


async def resolve_token(pool: asyncpg.Pool, token: str | None) -> Optional[dict]:
    if not token:
        return None
    async with pool.acquire() as con:
        r = await con.fetchrow(
            "SELECT u.* FROM auth_sessions a JOIN users u ON u.id = a.user_id "
            "WHERE a.token=$1 AND a.expires_at > now() AND NOT u.disabled",
            token,
        )
    return dict(r) if r else None


async def logout(pool: asyncpg.Pool, token: str | None) -> None:
    if not token:
        return
    async with pool.acquire() as con:
        await con.execute("DELETE FROM auth_sessions WHERE token=$1", token)


# --------------------------------------------------------------------------- #
# API Keys (Bearer sk-bobigo-...)
# --------------------------------------------------------------------------- #
async def create_api_key(
    pool: asyncpg.Pool,
    user_id: int,
    name: str = "Trial API Key",
    custom_key: str | None = None,
) -> dict:
    key = custom_key or f"sk-bobigo-{secrets.token_hex(16)}"
    async with pool.acquire() as con:
        r = await con.fetchrow(
            "INSERT INTO api_keys (key, name, user_id) VALUES ($1,$2,$3) "
            "RETURNING id, key, name, user_id, created_at, last_used, disabled",
            key, name.strip() or "API Key", user_id,
        )
    return dict(r)


async def list_api_keys(pool: asyncpg.Pool, user_id: int | None = None) -> list[dict]:
    async with pool.acquire() as con:
        if user_id:
            rows = await con.fetch(
                "SELECT k.id, k.key, k.name, k.user_id, u.username, k.created_at, k.last_used, k.disabled "
                "FROM api_keys k JOIN users u ON u.id = k.user_id WHERE k.user_id=$1 ORDER BY k.created_at DESC",
                user_id,
            )
        else:
            rows = await con.fetch(
                "SELECT k.id, k.key, k.name, k.user_id, u.username, k.created_at, k.last_used, k.disabled "
                "FROM api_keys k JOIN users u ON u.id = k.user_id ORDER BY k.created_at DESC"
            )
    return [dict(r) for r in rows]


async def delete_api_key(pool: asyncpg.Pool, key_id: int) -> None:
    async with pool.acquire() as con:
        await con.execute("DELETE FROM api_keys WHERE id=$1", key_id)


async def resolve_api_key(pool: asyncpg.Pool, key: str | None) -> Optional[dict]:
    if not key:
        return None
    async with pool.acquire() as con:
        r = await con.fetchrow(
            "SELECT u.*, k.id AS api_key_id FROM api_keys k JOIN users u ON u.id = k.user_id "
            "WHERE k.key=$1 AND NOT k.disabled AND NOT u.disabled",
            key.strip(),
        )
        if r:
            await con.execute("UPDATE api_keys SET last_used=now() WHERE id=$1", r["api_key_id"])
            return dict(r)
    return None


async def resolve_token_or_key(pool: asyncpg.Pool, raw_credential: str | None) -> Optional[dict]:
    """Resolve user from either a session cookie token OR an API key."""
    if not raw_credential:
        return None
    cred = raw_credential.strip()
    if cred.startswith("Bearer "):
        cred = cred[7:].strip()
    if cred.startswith("sk-") or len(cred) > 36:
        # Check API key first
        user = await resolve_api_key(pool, cred)
        if user:
            return user
    # Check session cookie token
    return await resolve_token(pool, cred)


# --------------------------------------------------------------------------- #
# Bootstrap
# --------------------------------------------------------------------------- #
async def bootstrap_admin(pool: asyncpg.Pool) -> None:
    """Create initial admin and default trial API key if needed."""
    async with pool.acquire() as con:
        count = await con.fetchval("SELECT count(*) FROM users")
    if count:
        # Check if default API key exists
        async with pool.acquire() as con:
            key_count = await con.fetchval("SELECT count(*) FROM api_keys")
            if not key_count:
                admin_id = await con.fetchval("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1")
                if admin_id:
                    await create_api_key(pool, admin_id, name="Public Trial Key", custom_key="sk-bobigo-trial-2026")
        return

    username = os.environ.get("ADMIN_USERNAME", "admin")
    password = os.environ.get("ADMIN_PASSWORD", "admin123")
    admin = await create_user(pool, username, password, role="admin")
    async with pool.acquire() as con:
        for table in ("sessions", "companions", "projects", "audit_log"):
            await con.execute(f"UPDATE {table} SET user_id=$1 WHERE user_id IS NULL", admin["id"])
        await create_api_key(pool, admin["id"], name="Public Trial Key", custom_key="sk-bobigo-trial-2026")
    print(
        f"👤 Đã tạo admin '{username}' (mật khẩu: 'admin123'). Dữ liệu cũ đã gán cho admin."
    )
    print("🔑 Đã tạo API Key dùng thử: 'sk-bobigo-trial-2026'")
