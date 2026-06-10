use std::path::{Component, Path, PathBuf};

/// Safely join a user-supplied relative path segment onto `base`.
///
/// Returns `Err` if:
/// - `rel` is absolute (starts with `/` or a Windows drive letter)
/// - `rel` contains any component that is not a normal file/dir name
///   (i.e. rejects `..`, `.`, root, prefix)
///
/// This prevents path-traversal attacks where a caller passes `"../../etc/passwd"`.
pub(crate) fn safe_join(base: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel_path = Path::new(rel);
    if rel_path.is_absolute() {
        return Err("absolute paths not allowed".into());
    }
    for comp in rel_path.components() {
        match comp {
            Component::Normal(_) => {}
            _ => return Err(format!("invalid path component in '{rel}'")),
        }
    }
    Ok(base.join(rel_path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn safe_join_normal_component_ok() {
        let dir = tempdir().unwrap();
        let result = safe_join(dir.path(), "hello.md");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), dir.path().join("hello.md"));
    }

    #[test]
    fn safe_join_nested_normal_path_ok() {
        let dir = tempdir().unwrap();
        let result = safe_join(dir.path(), "sub/hello.md");
        assert!(result.is_ok());
    }

    #[test]
    fn safe_join_parent_traversal_rejected() {
        let dir = tempdir().unwrap();
        let result = safe_join(dir.path(), "../evil");
        assert!(result.is_err(), "expected Err for '../evil'");
    }

    #[test]
    fn safe_join_double_parent_traversal_rejected() {
        let dir = tempdir().unwrap();
        let result = safe_join(dir.path(), "../../etc/passwd");
        assert!(result.is_err(), "expected Err for '../../etc/passwd'");
    }

    #[test]
    fn safe_join_absolute_path_rejected() {
        let dir = tempdir().unwrap();
        let result = safe_join(dir.path(), "/absolute/path");
        assert!(result.is_err(), "expected Err for '/absolute/path'");
    }

    #[test]
    fn safe_join_dot_component_rejected() {
        let dir = tempdir().unwrap();
        let result = safe_join(dir.path(), "./foo");
        assert!(result.is_err(), "expected Err for './foo'");
    }
}
