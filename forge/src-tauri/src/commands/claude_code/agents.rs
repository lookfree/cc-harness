use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Agent {
    pub name: String,
    pub description: String,
    pub content: Option<String>,
    pub file_path: Option<String>,
    pub location: String,
    pub dependencies: Option<Vec<String>>,
}

fn agents_dir(base_dir: &Path) -> PathBuf { base_dir.join("agents") }

pub fn get_agents(base_dir: &Path) -> Result<Vec<Agent>, String> {
    let dir = agents_dir(base_dir);
    if !dir.exists() { return Ok(vec![]); }
    let mut agents = vec![];
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("md") {
            let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
            agents.push(Agent {
                name: path.file_stem().unwrap().to_string_lossy().to_string(),
                description: extract_frontmatter_field(&raw, "description").unwrap_or_default(),
                content: Some(raw),
                file_path: Some(path.to_string_lossy().to_string()),
                location: "user".into(),
                dependencies: None,
            });
        }
    }
    Ok(agents)
}

pub fn get_agent(base_dir: &Path, name: &str) -> Result<Option<Agent>, String> {
    Ok(get_agents(base_dir)?.into_iter().find(|a| a.name == name))
}

pub fn save_agent(base_dir: &Path, agent: &Agent) -> Result<(), String> {
    let dir = agents_dir(base_dir);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let content = agent.content.clone().unwrap_or_else(|| {
        format!("---\nname: {}\ndescription: {}\n---\n", agent.name, agent.description)
    });
    fs::write(dir.join(format!("{}.md", agent.name)), content).map_err(|e| e.to_string())
}

pub fn delete_agent(base_dir: &Path, name: &str) -> Result<(), String> {
    let path = agents_dir(base_dir).join(format!("{}.md", name));
    if path.exists() { fs::remove_file(path).map_err(|e| e.to_string())?; }
    Ok(())
}

fn extract_frontmatter_field(content: &str, field: &str) -> Option<String> {
    let fm = content.strip_prefix("---\n")?.split("\n---").next()?;
    fm.lines()
        .find(|l| l.starts_with(&format!("{}:", field)))
        .map(|l| l[field.len() + 1..].trim().to_string())
}

fn resolve_base(b: Option<String>) -> Result<PathBuf, String> {
    match b {
        Some(d) => Ok(PathBuf::from(d)),
        None => dirs::home_dir().map(|h| h.join(".claude"))
            .ok_or_else(|| "no home dir".into()),
    }
}

#[tauri::command] pub fn cmd_get_agents(base_dir: Option<String>) -> Result<Vec<Agent>, String> { get_agents(&resolve_base(base_dir)?) }
#[tauri::command] pub fn cmd_get_agent(name: String, base_dir: Option<String>) -> Result<Option<Agent>, String> { get_agent(&resolve_base(base_dir)?, &name) }
#[tauri::command] pub fn cmd_save_agent(agent: Agent, base_dir: Option<String>) -> Result<(), String> { save_agent(&resolve_base(base_dir)?, &agent) }
#[tauri::command] pub fn cmd_delete_agent(name: String, base_dir: Option<String>) -> Result<(), String> { delete_agent(&resolve_base(base_dir)?, &name) }

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn agent_roundtrip() {
        let dir = tempdir().unwrap();
        let agent = Agent { name: "ag".into(), description: "d".into(), content: None, file_path: None, location: "user".into(), dependencies: None };
        save_agent(dir.path(), &agent).unwrap();
        assert!(get_agent(dir.path(), "ag").unwrap().is_some());
        delete_agent(dir.path(), "ag").unwrap();
        assert!(get_agent(dir.path(), "ag").unwrap().is_none());
    }
}
