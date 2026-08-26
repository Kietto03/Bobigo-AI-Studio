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
