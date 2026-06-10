use rusqlite::Connection;
use crate::db::providers::{insert_provider, get_provider, Provider};

/// 内置预设定义
pub struct Preset {
    pub id: &'static str,
    pub name: &'static str,
    pub claude_code_config: Option<&'static str>,
    pub codex_cli_config: Option<&'static str>,
}

/// 22 条内置预设（v2）
pub fn builtin_presets() -> Vec<Preset> {
    vec![
        // ── Anthropic（两工具都支持）──────────────────────────────
        Preset {
            id: "anthropic-claude-sonnet-4-5",
            name: "Claude Sonnet 4.5",
            claude_code_config: Some(r#"{"model":"claude-sonnet-4-5"}"#),
            codex_cli_config:   Some(r#"{"model":"claude-sonnet-4-5","provider":"anthropic"}"#),
        },
        Preset {
            id: "anthropic-claude-sonnet-4-6",
            name: "Claude Sonnet 4.6",
            claude_code_config: Some(r#"{"model":"claude-sonnet-4-6"}"#),
            codex_cli_config:   Some(r#"{"model":"claude-sonnet-4-6","provider":"anthropic"}"#),
        },
        Preset {
            id: "anthropic-claude-opus-4",
            name: "Claude Opus 4",
            claude_code_config: Some(r#"{"model":"claude-opus-4"}"#),
            codex_cli_config:   Some(r#"{"model":"claude-opus-4","provider":"anthropic"}"#),
        },
        Preset {
            id: "anthropic-claude-opus-4-8",
            name: "Claude Opus 4.8",
            claude_code_config: Some(r#"{"model":"claude-opus-4-8"}"#),
            codex_cli_config:   Some(r#"{"model":"claude-opus-4-8","provider":"anthropic"}"#),
        },
        Preset {
            id: "anthropic-claude-haiku-4-5",
            name: "Claude Haiku 4.5",
            claude_code_config: Some(r#"{"model":"claude-haiku-4-5"}"#),
            codex_cli_config:   Some(r#"{"model":"claude-haiku-4-5","provider":"anthropic"}"#),
        },
        // ── OpenAI（仅 Codex CLI 支持）────────────────────────────
        Preset {
            id: "openai-gpt-4o",
            name: "GPT-4o",
            claude_code_config: None,
            codex_cli_config:   Some(r#"{"model":"gpt-4o","provider":"openai"}"#),
        },
        Preset {
            id: "openai-gpt-4o-mini",
            name: "GPT-4o mini",
            claude_code_config: None,
            codex_cli_config:   Some(r#"{"model":"gpt-4o-mini","provider":"openai"}"#),
        },
        Preset {
            id: "openai-gpt-4-1",
            name: "GPT-4.1",
            claude_code_config: None,
            codex_cli_config:   Some(r#"{"model":"gpt-4.1","provider":"openai"}"#),
        },
        Preset {
            id: "openai-o3",
            name: "OpenAI o3",
            claude_code_config: None,
            codex_cli_config:   Some(r#"{"model":"o3","provider":"openai"}"#),
        },
        Preset {
            id: "openai-o3-mini",
            name: "OpenAI o3-mini",
            claude_code_config: None,
            codex_cli_config:   Some(r#"{"model":"o3-mini","provider":"openai"}"#),
        },
        // ── Ollama 本地（仅 Codex CLI 支持）──────────────────────
        Preset {
            id: "ollama-llama3",
            name: "Ollama llama3",
            claude_code_config: None,
            codex_cli_config:   Some(r#"{"model":"llama3","provider":"ollama"}"#),
        },
        Preset {
            id: "ollama-mistral",
            name: "Ollama mistral",
            claude_code_config: None,
            codex_cli_config:   Some(r#"{"model":"mistral","provider":"ollama"}"#),
        },
        Preset {
            id: "ollama-qwen",
            name: "Ollama qwen",
            claude_code_config: None,
            codex_cli_config:   Some(r#"{"model":"qwen","provider":"ollama"}"#),
        },
        Preset {
            id: "ollama-qwen2-5-coder",
            name: "Ollama qwen2.5-coder",
            claude_code_config: None,
            codex_cli_config:   Some(r#"{"model":"qwen2.5-coder","provider":"ollama"}"#),
        },
        // ── DeepSeek（仅 Codex CLI 支持）──────────────────────────
        Preset {
            id: "deepseek-v3",
            name: "DeepSeek-V3",
            claude_code_config: None,
            codex_cli_config:   Some(r#"{"model":"deepseek-chat","provider":"deepseek"}"#),
        },
        Preset {
            id: "deepseek-r1",
            name: "DeepSeek-R1",
            claude_code_config: None,
            codex_cli_config:   Some(r#"{"model":"deepseek-r1","provider":"deepseek"}"#),
        },
        // ── Qwen（仅 Codex CLI 支持）──────────────────────────────
        Preset {
            id: "qwen-max",
            name: "Qwen-Max",
            claude_code_config: None,
            codex_cli_config:   Some(r#"{"model":"qwen-max","provider":"qwen"}"#),
        },
        Preset {
            id: "qwen-glm-4-plus",
            name: "GLM-4-Plus",
            claude_code_config: None,
            codex_cli_config:   Some(r#"{"model":"glm-4-plus","provider":"zhipu"}"#),
        },
        Preset {
            id: "moonshot-kimi-k2",
            name: "Kimi K2",
            claude_code_config: None,
            codex_cli_config:   Some(r#"{"model":"kimi-k2","provider":"moonshot"}"#),
        },
        // ── Google（仅 Codex CLI 支持）────────────────────────────
        Preset {
            id: "google-gemini-2-5-pro",
            name: "Gemini 2.5 Pro",
            claude_code_config: None,
            codex_cli_config:   Some(r#"{"model":"gemini-2.5-pro","provider":"google"}"#),
        },
        Preset {
            id: "google-gemini-2-0-flash",
            name: "Gemini 2.0 Flash",
            claude_code_config: None,
            codex_cli_config:   Some(r#"{"model":"gemini-2.0-flash","provider":"google"}"#),
        },
        Preset {
            id: "google-gemini-2-5-flash",
            name: "Gemini 2.5 Flash",
            claude_code_config: None,
            codex_cli_config:   Some(r#"{"model":"gemini-2.5-flash","provider":"google"}"#),
        },
    ]
}

/// 幂等地把内置预设写入 SQLite（is_preset=1，已存在则跳过）
pub fn seed_presets(conn: &Connection) -> Result<(), String> {
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    for p in builtin_presets() {
        // 幂等：已存在则跳过
        if get_provider(conn, p.id)?.is_some() {
            continue;
        }
        insert_provider(
            conn,
            &Provider {
                id: p.id.to_string(),
                name: p.name.to_string(),
                is_preset: true,
                claude_code_config: p.claude_code_config.map(str::to_string),
                codex_cli_config: p.codex_cli_config.map(str::to_string),
                created_at: now,
            },
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrate;

    fn mem() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        migrate(&conn).unwrap();
        conn
    }

    #[test]
    fn builtin_presets_count() {
        let presets = builtin_presets();
        // 至少 20 条，以覆盖规格中所有提及的 Provider 品牌
        assert!(presets.len() >= 20, "expected >= 20 presets, got {}", presets.len());
    }

    #[test]
    fn builtin_presets_unique_ids() {
        let presets = builtin_presets();
        let mut ids = std::collections::HashSet::new();
        for p in &presets {
            assert!(ids.insert(p.id), "duplicate preset id: {}", p.id);
        }
    }

    #[test]
    fn seed_is_idempotent() {
        let conn = mem();
        seed_presets(&conn).unwrap();
        seed_presets(&conn).unwrap(); // 第二次不应报错
        // 数量不变
        let rows = crate::db::providers::list_providers(&conn).unwrap();
        let preset_count = rows.iter().filter(|r| r.is_preset).count();
        assert_eq!(preset_count, builtin_presets().len());
    }

    #[test]
    fn seed_marks_as_preset() {
        let conn = mem();
        seed_presets(&conn).unwrap();
        let presets = builtin_presets();
        let first = get_provider(&conn, presets[0].id).unwrap().unwrap();
        assert!(first.is_preset);
    }

    #[test]
    fn anthropic_claude_sonnet_has_both_configs() {
        let presets = builtin_presets();
        let sonnet = presets.iter().find(|p| p.id == "anthropic-claude-sonnet-4-5")
            .expect("anthropic-claude-sonnet-4-5 preset missing");
        assert!(sonnet.claude_code_config.is_some());
        assert!(sonnet.codex_cli_config.is_some());
    }

    #[test]
    fn gpt4o_has_only_codex_config() {
        // GPT-4o: Claude Code 不支持 OpenAI → claude_code_config 为 None
        let presets = builtin_presets();
        let gpt4o = presets.iter().find(|p| p.id == "openai-gpt-4o")
            .expect("openai-gpt-4o preset missing");
        assert!(gpt4o.claude_code_config.is_none(),
            "GPT-4o should not have claude_code_config");
        assert!(gpt4o.codex_cli_config.is_some());
    }

    #[test]
    fn ollama_presets_have_codex_config_only() {
        let presets = builtin_presets();
        for id in ["ollama-llama3", "ollama-mistral", "ollama-qwen"] {
            let p = presets.iter().find(|p| p.id == id)
                .unwrap_or_else(|| panic!("{} preset missing", id));
            assert!(p.claude_code_config.is_none(),
                "{} should not have claude_code_config", id);
            assert!(p.codex_cli_config.is_some());
        }
    }
}
