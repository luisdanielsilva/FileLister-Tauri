use crate::models::*;
use crate::scan::is_content_identical;
use std::fs;
use std::path::{Path, PathBuf};

// ── Undo ────────────────────────────────────────────────────────────────────
// Restores trashed files and removes files/folders we created. Mirrors
// OperationHistory.undoLast. Returns the original paths successfully restored.
pub fn undo(trashed: &[String], created: &[String]) -> Vec<String> {
    // remove things we created (merge copies, keeper exports)
    for c in created {
        let p = Path::new(c);
        if p.is_dir() {
            let _ = fs::remove_dir_all(p);
        } else {
            let _ = fs::remove_file(p);
        }
    }
    restore_from_trash(trashed)
}

#[cfg(not(target_os = "macos"))]
fn restore_from_trash(paths: &[String]) -> Vec<String> {
    use std::collections::HashSet;
    let want: HashSet<PathBuf> = paths.iter().map(PathBuf::from).collect();
    let mut restored = Vec::new();
    if let Ok(items) = trash::os_limited::list() {
        let pick: Vec<_> = items
            .into_iter()
            .filter(|it| want.contains(&it.original_path()))
            .collect();
        for it in &pick {
            restored.push(it.original_path().to_string_lossy().to_string());
        }
        let _ = trash::os_limited::restore_all(pick);
    }
    restored
}

// macOS: the trash crate can't list/restore, so move ~/.Trash/<name> back to its
// original location (best effort — covers the common no-collision case).
#[cfg(target_os = "macos")]
fn restore_from_trash(paths: &[String]) -> Vec<String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let trash_dir = PathBuf::from(&home).join(".Trash");
    let mut restored = Vec::new();
    for p in paths {
        let name = match Path::new(p).file_name() {
            Some(n) => n.to_os_string(),
            None => continue,
        };
        let candidate = trash_dir.join(&name);
        if candidate.exists() {
            if let Some(parent) = Path::new(p).parent() {
                let _ = fs::create_dir_all(parent);
            }
            if fs::rename(&candidate, p).is_ok() {
                restored.push(p.clone());
            }
        }
    }
    restored
}

fn base_name(path: &str) -> String {
    Path::new(path).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| path.to_string())
}

// Mirrors resolveCollisionName.
fn resolve_collision_name(file_name: &str, source_folder_name: &str) -> String {
    let p = Path::new(file_name);
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
    let base = if ext.is_empty() {
        file_name.to_string()
    } else {
        file_name[..file_name.len() - ext.len() - 1].to_string()
    };
    let safe = source_folder_name.replace('/', "_");
    if ext.is_empty() {
        format!("{}_moved_from_{}", base, safe)
    } else {
        format!("{}_moved_from_{}.{}", base, safe, ext)
    }
}

fn unique_dest(dir: &Path, mut name: String) -> PathBuf {
    let mut dest = dir.join(&name);
    let mut suffix = 2;
    while dest.exists() {
        let p = Path::new(&name);
        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_string();
        let base = if ext.is_empty() {
            name.clone()
        } else {
            name[..name.len() - ext.len() - 1].to_string()
        };
        name = if ext.is_empty() {
            format!("{}_{}", base, suffix)
        } else {
            format!("{}_{}.{}", base, suffix, ext)
        };
        dest = dir.join(&name);
        suffix += 1;
    }
    dest
}

// Move files to the OS Trash. Mirrors NSWorkspace.recycle.
pub fn trash_paths(paths: &[String]) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }
    trash::delete_all(paths).map_err(|e| e.to_string())
}

// Single-file delete with mandatory byte verification against a reference copy.
pub fn verify_and_trash(target: &str, reference: &str, is_symlink: bool) -> Result<(), String> {
    if !is_symlink && !is_content_identical(target, reference) {
        return Err("Security Alert: Files differ! Deletion aborted.".into());
    }
    trash::delete(target).map_err(|e| e.to_string())
}

// Batch clean: for each group keep files[0], verify+trash the rest. Returns (trashed_paths, skipped, bytes).
pub fn clean_all(groups: &[DuplicateGroup], deleted: &[String]) -> (Vec<String>, usize, u64) {
    let deleted_set: std::collections::HashSet<&String> = deleted.iter().collect();
    let mut to_trash = Vec::new();
    let mut skipped = 0;
    let mut bytes = 0u64;

    for group in groups {
        let active: Vec<&FileInfo> = group.files.iter().filter(|f| !deleted_set.contains(&f.full_path)).collect();
        if active.len() <= 1 {
            continue;
        }
        if group.is_symlink_group {
            for f in active.iter().skip(1) {
                to_trash.push(f.full_path.clone());
                bytes += group.size_bytes;
            }
        } else {
            let reference = &active[0].full_path;
            for f in active.iter().skip(1) {
                if is_content_identical(&f.full_path, reference) {
                    to_trash.push(f.full_path.clone());
                    bytes += group.size_bytes;
                } else {
                    skipped += 1;
                }
            }
        }
    }
    (to_trash, skipped, bytes)
}

pub struct MergeOutcome {
    pub result_name: String,
    pub errors: usize,
    pub trashed_paths: Vec<String>,
    pub recovered_bytes: u64,
}

// In-place merge & clean: move unique files into keep, trash other folders, optionally rename keep.
pub fn merge_folder_inplace(group: &FolderDuplicateGroup, rename: bool, merged_name: &str) -> MergeOutcome {
    let keep = &group.folders[0];
    let keep_path = Path::new(keep);
    let mut errors = 0;

    // 1. move unique files into keep
    for file in &group.files_to_move {
        let src = PathBuf::from(&file.full_path);
        let source_folder_name = base_name(&file.path);
        let dest = if keep_path.join(&file.name).exists() {
            unique_dest(keep_path, resolve_collision_name(&file.name, &source_folder_name))
        } else {
            keep_path.join(&file.name)
        };
        if fs::rename(&src, &dest).is_err() {
            // cross-device fallback: copy then remove
            if fs::copy(&src, &dest).and_then(|_| fs::remove_file(&src)).is_err() {
                errors += 1;
            }
        }
    }

    // 2. trash the other folders (their remaining files are all duplicates of keep)
    let mut trashed_paths = Vec::new();
    let others = &group.folders[1..];
    if !others.is_empty() {
        let _ = trash::delete_all(others);
        for o in others {
            trashed_paths.push(o.clone());
        }
    }
    // mark the duplicate copies as deleted for the UI
    for mg in &group.matched_groups {
        for f in &mg.files {
            if &f.path != keep {
                trashed_paths.push(f.full_path.clone());
            }
        }
    }

    // 3. optional rename of keep
    let mut result_path = keep.clone();
    if rename {
        if let Some(parent) = keep_path.parent() {
            let mut dest = parent.join(merged_name);
            let mut suffix = 2;
            while dest.exists() {
                dest = parent.join(format!("{}_{}", merged_name, suffix));
                suffix += 1;
            }
            if fs::rename(keep_path, &dest).is_ok() {
                result_path = dest.to_string_lossy().to_string();
            }
        }
    }

    MergeOutcome {
        result_name: base_name(&result_path),
        errors,
        trashed_paths,
        recovered_bytes: group.total_size_bytes,
    }
}

// Safe merge: copy keep's tree to dest, then add other folders' unique files (rename on collision).
pub fn safe_merge_folder(group: &FolderDuplicateGroup, dest: &str) -> Result<String, String> {
    let keep = &group.folders[0];
    let dest_path = PathBuf::from(dest);
    if dest_path.exists() {
        fs::remove_dir_all(&dest_path).map_err(|e| e.to_string())?;
    }
    copy_dir_recursive(Path::new(keep), &dest_path).map_err(|e| e.to_string())?;

    for file in &group.files_to_move {
        let src = PathBuf::from(&file.full_path);
        let source_folder_name = base_name(&file.path);
        let target = if dest_path.join(&file.name).exists() {
            unique_dest(&dest_path, resolve_collision_name(&file.name, &source_folder_name))
        } else {
            dest_path.join(&file.name)
        };
        let _ = fs::copy(&src, &target);
    }
    Ok(base_name(dest))
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let target = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_recursive(&entry.path(), &target)?;
        } else if ty.is_file() {
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn undo_removes_created_files() {
        let dir = std::env::temp_dir().join(format!("fl-undo-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let f1 = dir.join("export1.jpg");
        let f2 = dir.join("export2.jpg");
        fs::write(&f1, b"a").unwrap();
        fs::write(&f2, b"b").unwrap();
        assert!(f1.exists() && f2.exists());

        // Undo with no trashed items just removes the created ones.
        let restored = undo(&[], &[f1.to_string_lossy().to_string(), f2.to_string_lossy().to_string()]);
        assert!(restored.is_empty());
        assert!(!f1.exists() && !f2.exists(), "created files should be gone after undo");
        fs::remove_dir_all(&dir).ok();
    }
}
