use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skill {
    pub name: String,
    pub description: String,
    pub content: Option<String>,
    pub file_path: Option<String>,
    pub location: String,
    pub dependencies: Option<Vec<String>>,
}

fn skills_dir(base_dir: &Path) -> PathBuf {
    base_dir.join("skills")
}

pub fn get_skills(base_dir: &Path) -> Result<Vec<Skill>, String> {
    let dir = skills_dir(base_dir);
    if !dir.exists() { return Ok(vec![]); }
    let mut skills = vec![];
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("md") {
            let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
            let name = path.file_stem().unwrap().to_string_lossy().to_string();
            skills.push(Skill {
                name,
                description: extract_frontmatter_field(&raw, "description")
                    .unwrap_or_default(),
                content: Some(raw),
                file_path: Some(path.to_string_lossy().to_string()),
                location: "user".into(),
                dependencies: None,
            });
        }
    }
    Ok(skills)
}

pub fn get_skill(base_dir: &Path, name: &str) -> Result<Option<Skill>, String> {
    Ok(get_skills(base_dir)?.into_iter().find(|s| s.name == name))
}

pub fn save_skill(base_dir: &Path, skill: &Skill) -> Result<(), String> {
    let dir = skills_dir(base_dir);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{}.md", skill.name));
    let content = skill.content.clone().unwrap_or_else(|| {
        format!("---\nname: {}\ndescription: {}\n---\n", skill.name, skill.description)
    });
    fs::write(path, content).map_err(|e| e.to_string())
}

pub fn delete_skill(base_dir: &Path, name: &str) -> Result<(), String> {
    let path = skills_dir(base_dir).join(format!("{}.md", name));
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn extract_frontmatter_field(content: &str, field: &str) -> Option<String> {
    let fm = content.strip_prefix("---\n")?.split("\n---").next()?;
    fm.lines()
        .find(|l| l.starts_with(&format!("{}:", field)))
        .map(|l| l[field.len() + 1..].trim().to_string())
}

fn resolve_base(base_dir: Option<String>) -> Result<PathBuf, String> {
    match base_dir {
        Some(d) => Ok(PathBuf::from(d)),
        None => dirs::home_dir()
            .map(|h| h.join(".claude"))
            .ok_or_else(|| "cannot determine home dir".into()),
    }
}

#[tauri::command]
pub fn cmd_get_skills(base_dir: Option<String>) -> Result<Vec<Skill>, String> {
    get_skills(&resolve_base(base_dir)?)
}
#[tauri::command]
pub fn cmd_get_skill(name: String, base_dir: Option<String>) -> Result<Option<Skill>, String> {
    get_skill(&resolve_base(base_dir)?, &name)
}
#[tauri::command]
pub fn cmd_save_skill(skill: Skill, base_dir: Option<String>) -> Result<(), String> {
    save_skill(&resolve_base(base_dir)?, &skill)
}
#[tauri::command]
pub fn cmd_delete_skill(name: String, base_dir: Option<String>) -> Result<(), String> {
    delete_skill(&resolve_base(base_dir)?, &name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn get_skills_empty_dir() {
        let dir = tempdir().unwrap();
        let base = dir.path().to_path_buf();
        let skills = get_skills(&base).unwrap();
        assert!(skills.is_empty());
    }

    #[test]
    fn save_and_get_skill_roundtrip() {
        let dir = tempdir().unwrap();
        let base = dir.path().to_path_buf();
        let skill = Skill {
            name: "test-skill".into(),
            description: "A test".into(),
            content: Some("---\ndescription: A test\n---\n# test".into()),
            file_path: None,
            location: "user".into(),
            dependencies: None,
        };
        save_skill(&base, &skill).unwrap();
        let loaded = get_skill(&base, "test-skill").unwrap().unwrap();
        assert_eq!(loaded.description, "A test");
    }

    #[test]
    fn delete_skill_removes_file() {
        let dir = tempdir().unwrap();
        let base = dir.path().to_path_buf();
        let skill = Skill {
            name: "to-delete".into(),
            description: "del".into(),
            content: None,
            file_path: None,
            location: "user".into(),
            dependencies: None,
        };
        save_skill(&base, &skill).unwrap();
        delete_skill(&base, "to-delete").unwrap();
        assert!(get_skill(&base, "to-delete").unwrap().is_none());
    }
}
