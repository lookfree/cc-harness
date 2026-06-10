CREATE TABLE sessions (
    id            TEXT PRIMARY KEY,
    tool          TEXT NOT NULL,
    working_dir   TEXT NOT NULL,
    started_at    INTEGER NOT NULL,
    ended_at      INTEGER,
    duration_sec  INTEGER,
    model         TEXT,
    input_tokens  INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    cost_usd      REAL DEFAULT 0.0,
    raw_source    TEXT
);

CREATE TABLE projects (
    id             TEXT PRIMARY KEY,
    tool           TEXT NOT NULL,
    directory      TEXT NOT NULL,
    pinned         INTEGER NOT NULL DEFAULT 0,
    last_used_at   INTEGER,
    session_count  INTEGER DEFAULT 0,
    total_tokens   INTEGER DEFAULT 0,
    total_cost_usd REAL DEFAULT 0.0,
    UNIQUE(tool, directory)
);

CREATE TABLE env_vars (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX idx_sessions_tool_started ON sessions(tool, started_at DESC);
CREATE INDEX idx_projects_tool_pinned  ON projects(tool, pinned DESC, last_used_at DESC);
