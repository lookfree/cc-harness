use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Deserialize)]
pub struct DependencyNode {
    pub id: String,
    pub node_type: String,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DependencyEdge {
    pub id: String,
    pub source: String,
    pub target: String,
    pub edge_type: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DependencyGraph {
    pub nodes: Vec<DependencyNode>,
    pub edges: Vec<DependencyEdge>,
}

pub fn get_dependency_graph(base_dir: &Path) -> Result<DependencyGraph, String> {
    let skills = super::skills::get_skills(base_dir)?;
    let agents = super::agents::get_agents(base_dir)?;

    let mut nodes = vec![];
    let mut edges = vec![];

    for s in &skills {
        nodes.push(DependencyNode { id: s.name.clone(), node_type: "skill".into(), name: s.name.clone() });
        if let Some(deps) = &s.dependencies {
            for dep in deps {
                edges.push(DependencyEdge {
                    id: format!("{}->{}", s.name, dep),
                    source: s.name.clone(),
                    target: dep.clone(),
                    edge_type: "depends-on".into(),
                });
            }
        }
    }
    for a in &agents {
        nodes.push(DependencyNode { id: a.name.clone(), node_type: "agent".into(), name: a.name.clone() });
        if let Some(deps) = &a.dependencies {
            for dep in deps {
                edges.push(DependencyEdge {
                    id: format!("{}->{}", a.name, dep),
                    source: a.name.clone(),
                    target: dep.clone(),
                    edge_type: "depends-on".into(),
                });
            }
        }
    }
    Ok(DependencyGraph { nodes, edges })
}

fn resolve_base(b: Option<String>) -> Result<PathBuf, String> {
    match b {
        Some(d) => Ok(PathBuf::from(d)),
        None => dirs::home_dir().map(|h| h.join(".claude")).ok_or_else(|| "no home".into()),
    }
}

#[tauri::command]
pub fn cmd_get_dependency_graph(base_dir: Option<String>) -> Result<DependencyGraph, String> {
    get_dependency_graph(&resolve_base(base_dir)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn empty_dirs_returns_empty_graph() {
        let dir = tempdir().unwrap();
        let g = get_dependency_graph(dir.path()).unwrap();
        assert!(g.nodes.is_empty());
        assert!(g.edges.is_empty());
    }
}
