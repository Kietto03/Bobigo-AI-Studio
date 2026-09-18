-- Bobigo AI Studio — relational schema (single-user, no auth).
-- Applied idempotently on startup; safe to re-run.

CREATE TABLE IF NOT EXISTS projects (
    id           TEXT PRIMARY KEY,
    name         TEXT        NOT NULL DEFAULT '',
    description  TEXT        NOT NULL DEFAULT '',
    instructions TEXT        NOT NULL DEFAULT '',
    color        TEXT,
    knowledge    JSONB       NOT NULL DEFAULT '[]',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    position     INT
);

CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,
    title      TEXT        NOT NULL DEFAULT '',
    -- soft reference to projects.id (no FK: session PUT and project PUT are
    -- independent calls, so we don't want ordering to cause FK violations)
    project_id TEXT,
    pinned     BOOLEAN     NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    position   INT
);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);

CREATE TABLE IF NOT EXISTS companions (
    id           TEXT PRIMARY KEY,
    name         TEXT        NOT NULL DEFAULT '',
    emoji        TEXT,
    avatar       TEXT,
    tagline      TEXT        NOT NULL DEFAULT '',
    persona      TEXT        NOT NULL DEFAULT '',
    instructions TEXT        NOT NULL DEFAULT '',
    knowledge    JSONB       NOT NULL DEFAULT '[]',
    language     TEXT        NOT NULL DEFAULT 'vi',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    position     INT
);

-- A message belongs to exactly one parent: a session OR a companion.
CREATE TABLE IF NOT EXISTS messages (
    id           BIGSERIAL PRIMARY KEY,
    session_id   TEXT REFERENCES sessions(id)   ON DELETE CASCADE,
    companion_id TEXT REFERENCES companions(id) ON DELETE CASCADE,
    seq          INT         NOT NULL,
    role         TEXT        NOT NULL DEFAULT 'user',
    content      TEXT,
    text         TEXT,
    reasoning    TEXT,
    pinned       BOOLEAN     NOT NULL DEFAULT false,
    -- everything else on the message (searchResults, toolEvents, attachments,
    -- variants, activeVariant, summary, …) kept losslessly here
    data         JSONB,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT one_parent CHECK ((session_id IS NOT NULL) <> (companion_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_messages_session   ON messages(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_messages_companion ON messages(companion_id, seq);

-- OCR & Document Intelligence audit trail (who processed what, when).
CREATE TABLE IF NOT EXISTS audit_log (
    id              BIGSERIAL PRIMARY KEY,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    filename        TEXT        NOT NULL DEFAULT '',
    sha256          TEXT,
    size            BIGINT,
    mime            TEXT,
    pages           INT,
    method          TEXT,
    ocr_used        BOOLEAN     NOT NULL DEFAULT false,
    pii_types       JSONB       NOT NULL DEFAULT '[]',
    pii_count       INT         NOT NULL DEFAULT 0,
    sensitivity     TEXT,
    redacted        BOOLEAN     NOT NULL DEFAULT false,
    summary_file_id TEXT,
    text_file_id    TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);

-- Authentication (multi-user)
CREATE TABLE IF NOT EXISTS users (
    id            BIGSERIAL PRIMARY KEY,
    username      TEXT        NOT NULL UNIQUE,
    password_hash TEXT        NOT NULL,
    role          TEXT        NOT NULL DEFAULT 'user',   -- 'user' | 'admin'
    disabled      BOOLEAN     NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS auth_sessions (
    token      TEXT PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);

-- API Keys (for developer & third-party trial access)
CREATE TABLE IF NOT EXISTS api_keys (
    id          BIGSERIAL PRIMARY KEY,
    key         TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL DEFAULT 'Trial API Key',
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used   TIMESTAMPTZ,
    disabled    BOOLEAN NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(key);
CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);

-- Per-user ownership (backfilled to the admin on first migration).
ALTER TABLE sessions   ADD COLUMN IF NOT EXISTS user_id BIGINT;
ALTER TABLE companions ADD COLUMN IF NOT EXISTS user_id BIGINT;
ALTER TABLE projects   ADD COLUMN IF NOT EXISTS user_id BIGINT;
ALTER TABLE audit_log  ADD COLUMN IF NOT EXISTS user_id BIGINT;
CREATE INDEX IF NOT EXISTS idx_sessions_user   ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_companions_user ON companions(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_user   ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_user      ON audit_log(user_id);
