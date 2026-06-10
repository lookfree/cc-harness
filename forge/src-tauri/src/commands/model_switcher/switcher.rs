use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct SwitchResult {
    pub tool: String,
    pub success: bool,
    pub hot_reload: bool,
    pub error: Option<String>,
}

/// 核心切换函数，接收显式配置路径（便于测试）
pub fn switch_provider_with_paths(
    _claude_code_config: Option<&std::path::Path>,
    _codex_cli_config: Option<&std::path::Path>,
    _claude_code_fragment: Option<&str>,
    _codex_cli_fragment: Option<&str>,
    _targets: &[String],
) -> Vec<SwitchResult> {
    todo!()
}
