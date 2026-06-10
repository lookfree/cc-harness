CREATE TABLE providers (
    id                  TEXT PRIMARY KEY,
    name                TEXT NOT NULL,
    is_preset           INTEGER NOT NULL DEFAULT 0,
    claude_code_config  TEXT,
    codex_cli_config    TEXT,
    created_at          INTEGER NOT NULL
);

CREATE TABLE active_providers (
    tool        TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL REFERENCES providers(id)
);
