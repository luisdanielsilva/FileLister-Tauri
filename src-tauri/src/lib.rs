mod license;
mod logger;
mod models;
mod ops;
mod photos;
mod scan;

use logger::{entry, LogCluster, LogReport};

use models::*;
use ops::*;
use photos::*;
use scan::*;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};

struct ScanState {
    stop: Arc<AtomicBool>,
}

fn emitter(app: AppHandle) -> impl Fn(ProgressPayload) + Sync {
    move |p: ProgressPayload| {
        let _ = app.emit("scan-progress", p);
    }
}

#[tauri::command]
async fn scan_files(
    app: AppHandle,
    state: State<'_, ScanState>,
    roots: Vec<String>,
    per_folder: bool,
    deep: bool,
    media_only: bool,
    skip_hidden: bool,
    detect_symlinks: bool,
) -> Result<ScanResult, String> {
    let stop = state.stop.clone();
    stop.store(false, Ordering::Relaxed);
    let opts = ScanOptions {
        deep,
        media_only,
        skip_hidden,
        detect_symlinks,
        detect_folders: false,
        folder_threshold: 0.75,
    };
    tauri::async_runtime::spawn_blocking(move || {
        let emit = emitter(app);
        run_scan(roots, per_folder, opts, stop, &emit)
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn scan_folders(
    app: AppHandle,
    state: State<'_, ScanState>,
    roots: Vec<String>,
    per_folder: bool,
    media_only: bool,
    skip_hidden: bool,
    threshold: f64,
) -> Result<ScanResult, String> {
    let stop = state.stop.clone();
    stop.store(false, Ordering::Relaxed);
    let opts = ScanOptions {
        deep: false,
        media_only,
        skip_hidden,
        detect_symlinks: false,
        detect_folders: true,
        folder_threshold: threshold,
    };
    tauri::async_runtime::spawn_blocking(move || {
        let emit = emitter(app);
        run_scan(roots, per_folder, opts, stop, &emit)
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn scan_photos_cmd(
    app: AppHandle,
    state: State<'_, ScanState>,
    roots: Vec<String>,
    threshold: f64,
    require_exif: bool,
    expand_metadata: bool,
    expand_time: bool,
    expand_gps: bool,
    expand_camera: bool,
    priority: Vec<String>,
) -> Result<PhotoScanResult, String> {
    let stop = state.stop.clone();
    stop.store(false, Ordering::Relaxed);
    let opts = PhotoOptions {
        threshold,
        require_exif,
        expand_metadata,
        expand_time,
        expand_gps,
        expand_camera,
        priority,
    };
    tauri::async_runtime::spawn_blocking(move || {
        let emit = emitter(app);
        run_photo_scan(roots, opts, stop, &emit)
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn stop_scan(state: State<'_, ScanState>) {
    state.stop.store(true, Ordering::Relaxed);
}

#[tauri::command]
fn trash_files(paths: Vec<String>) -> Result<(), String> {
    trash_paths(&paths)
}

#[tauri::command]
fn delete_single(target: String, reference: String, is_symlink: bool, name: String, size: u64) -> Result<Option<String>, String> {
    verify_and_trash(&target, &reference, is_symlink)?;
    let folder = Path::new(&target).parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
    let cluster = LogCluster {
        keep_folder: reference.clone(),
        other_folders: vec![],
        result_name: name.clone(),
        result_path: reference,
        entries: vec![entry("TRASHED", &name, &target, &folder, "Trash", "Trash", size, "duplicate of kept · recoverable from Trash")],
    };
    let report = LogReport::new("Duplicate file cleanup", false, vec![cluster]);
    Ok(logger::write(&report))
}

#[derive(serde::Serialize)]
struct CleanResult {
    trashed: Vec<String>,
    skipped: usize,
    bytes: u64,
    log_path: Option<String>,
}

#[tauri::command]
fn clean_all_duplicates(groups: Vec<DuplicateGroup>, deleted: Vec<String>) -> Result<CleanResult, String> {
    let (to_trash, skipped, bytes) = clean_all(&groups, &deleted);
    if to_trash.is_empty() {
        return Ok(CleanResult { trashed: vec![], skipped, bytes: 0, log_path: None });
    }
    trash_paths(&to_trash)?;

    // Build one log cluster per group documenting kept vs trashed copies.
    let trashed_set: std::collections::HashSet<&String> = to_trash.iter().collect();
    let mut clusters = Vec::new();
    for g in &groups {
        let removed: Vec<&FileInfo> = g.files.iter().filter(|f| trashed_set.contains(&f.full_path)).collect();
        if removed.is_empty() {
            continue;
        }
        let kept = g.files.iter().find(|f| !trashed_set.contains(&f.full_path));
        let mut entries = Vec::new();
        if let Some(k) = kept {
            entries.push(entry("KEPT", &k.name, &k.full_path, &k.path, &k.full_path, &k.path, k.size_bytes, "kept original"));
        }
        for r in &removed {
            entries.push(entry("TRASHED", &r.name, &r.full_path, &r.path, "Trash", "Trash", r.size_bytes, "duplicate of kept · recoverable from Trash"));
        }
        let keep_path = kept.map(|k| k.full_path.clone()).unwrap_or_default();
        clusters.push(LogCluster { keep_folder: keep_path.clone(), other_folders: vec![], result_name: g.name.clone(), result_path: keep_path, entries });
    }
    let report = LogReport::new("Duplicate file cleanup", false, clusters);
    let log_path = logger::write(&report);
    Ok(CleanResult { trashed: to_trash, skipped, bytes, log_path })
}

#[derive(serde::Serialize)]
struct MergeResult {
    result_name: String,
    errors: usize,
    trashed: Vec<String>,
    recovered_bytes: u64,
    created: Vec<String>,
    log_path: Option<String>,
}

#[tauri::command]
fn merge_folder(group: FolderDuplicateGroup, rename: bool, merged_name: String) -> Result<MergeResult, String> {
    let outcome = merge_folder_inplace(&group, rename, &merged_name);
    let report = LogReport::new("In-place merge & clean", rename, vec![merge_log_cluster(&group, &outcome.result_name)]);
    let log_path = logger::write(&report);
    Ok(MergeResult {
        result_name: outcome.result_name,
        errors: outcome.errors,
        trashed: outcome.trashed_paths,
        recovered_bytes: outcome.recovered_bytes,
        created: vec![],
        log_path,
    })
}

// Builds a log cluster describing an in-place merge: moved uniques, trashed dups, trashed folders.
fn merge_log_cluster(group: &FolderDuplicateGroup, result_name: &str) -> LogCluster {
    let keep = group.folders[0].clone();
    let mut entries = Vec::new();
    for f in &group.files_to_move {
        entries.push(entry("MOVED", &f.name, &f.full_path, &f.path, &keep, &keep, f.size_bytes, "unique file moved into keep"));
    }
    for mg in &group.matched_groups {
        for f in mg.files.iter().filter(|f| f.path != keep) {
            entries.push(entry("TRASHED", &f.name, &f.full_path, &f.path, "Trash", "Trash", f.size_bytes, "duplicate of kept copy"));
        }
    }
    for other in &group.folders[1..] {
        let oname = Path::new(other).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        entries.push(entry("FOLDER_TRASHED", &oname, other, other, "Trash", "Trash", 0, "folder removed after merge"));
    }
    LogCluster { keep_folder: keep.clone(), other_folders: group.folders[1..].to_vec(), result_name: result_name.into(), result_path: keep, entries }
}

#[derive(serde::Serialize)]
struct SafeMergeResult {
    result_name: String,
    created: String,
    log_path: Option<String>,
}

#[tauri::command]
fn safe_merge(group: FolderDuplicateGroup, dest: String) -> Result<SafeMergeResult, String> {
    let result_name = safe_merge_folder(&group, &dest)?;
    let keep = group.folders[0].clone();
    let mut entries = vec![entry("FOLDER_COPIED", &result_name, &keep, &keep, &dest, &dest, 0, "keep folder copied as the merge base")];
    for f in &group.files_to_move {
        entries.push(entry("COPIED", &f.name, &f.full_path, &f.path, &dest, &dest, f.size_bytes, "unique file copied into merged result"));
    }
    let cluster = LogCluster { keep_folder: keep, other_folders: group.folders[1..].to_vec(), result_name: result_name.clone(), result_path: dest.clone(), entries };
    let report = LogReport::new("Copy to new folder (originals kept)", false, vec![cluster]);
    let log_path = logger::write(&report);
    Ok(SafeMergeResult { result_name, created: dest, log_path })
}

#[derive(serde::Serialize)]
struct ExportResult {
    copied: usize,
    created: Vec<String>,
    log_path: Option<String>,
}

// Copy a group's keeper photos into a destination, replicating folder structure.
#[tauri::command]
fn export_keepers(keepers: Vec<PhotoInfo>, dest: String, roots: Vec<String>) -> Result<ExportResult, String> {
    use std::fs;
    let mut copied = 0;
    let mut created = Vec::new();
    let mut entries = Vec::new();
    for k in &keepers {
        // Path relative to its scanned root, prefixed by the root folder name.
        // Path::starts_with/strip_prefix are component-wise and OS-correct (handles
        // Windows '\' and avoids matching "/foo" against "/foobar").
        let full = Path::new(&k.full_path);
        let best_root: Option<&String> = roots
            .iter()
            .filter(|r| full.starts_with(Path::new(r.as_str())))
            .max_by_key(|r| r.len());
        let rel: std::path::PathBuf = if let Some(root) = best_root {
            let root_name = Path::new(root).file_name().unwrap_or_default();
            let after = full.strip_prefix(root).unwrap_or(Path::new(&k.name));
            Path::new(root_name).join(after)
        } else {
            std::path::PathBuf::from(&k.name)
        };
        let mut target = Path::new(&dest).join(&rel);
        if let Some(parent) = target.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let mut suffix = 2;
        while target.exists() {
            let stem = target.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            let ext = target.extension().map(|e| e.to_string_lossy().to_string());
            let parent = target.parent().unwrap().to_path_buf();
            let name = match &ext {
                Some(e) => format!("{}_{}.{}", stem, suffix, e),
                None => format!("{}_{}", stem, suffix),
            };
            target = parent.join(name);
            suffix += 1;
        }
        if fs::copy(&k.full_path, &target).is_ok() {
            copied += 1;
            let tpath = target.to_string_lossy().to_string();
            created.push(tpath.clone());
            entries.push(entry("COPIED", &k.name, &k.full_path, &k.path, &tpath, &dest, k.size_bytes, "keeper exported · originals untouched"));
        }
    }
    let cluster = LogCluster { keep_folder: dest.clone(), other_folders: vec![], result_name: "Keeper export".into(), result_path: dest.clone(), entries };
    let report = LogReport::new("Photo export (keepers copied, originals kept)", false, vec![cluster]);
    let log_path = logger::write(&report);
    Ok(ExportResult { copied, created, log_path })
}

// Trash photos and write a log. `kept` is the keeper name per group (for the log).
#[tauri::command]
fn delete_photos(photos: Vec<PhotoInfo>, keeper_name: String) -> Result<Option<String>, String> {
    if photos.is_empty() {
        return Ok(None);
    }
    let paths: Vec<String> = photos.iter().map(|p| p.full_path.clone()).collect();
    trash_paths(&paths)?;
    let entries: Vec<_> = photos
        .iter()
        .map(|p| entry("TRASHED", &p.name, &p.full_path, &p.path, "Trash", "Trash", p.size_bytes, "similar photo · recoverable from Trash"))
        .collect();
    let cluster = LogCluster { keep_folder: keeper_name.clone(), other_folders: vec![], result_name: keeper_name, result_path: String::new(), entries };
    let report = LogReport::new("Photo cleanup (similar photos)", false, vec![cluster]);
    Ok(logger::write(&report))
}

// Undo: restore trashed files and remove created files. Returns originals restored.
#[tauri::command]
fn undo_op(trashed: Vec<String>, created: Vec<String>) -> Vec<String> {
    ops::undo(&trashed, &created)
}

#[tauri::command]
fn list_logs() -> Vec<serde_json::Value> {
    logger::list()
        .into_iter()
        .map(|(path, report)| {
            serde_json::json!({ "json_path": path, "report": report })
        })
        .collect()
}

// Read a text file for in-app preview (capped to keep the UI responsive).
#[tauri::command]
fn read_text_file(path: String, max_bytes: usize) -> Result<String, String> {
    use std::io::Read;
    let mut f = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; max_bytes];
    let n = f.read(&mut buf).map_err(|e| e.to_string())?;
    buf.truncate(n);
    Ok(String::from_utf8_lossy(&buf).to_string())
}

#[tauri::command]
fn validate_license(key: String) -> bool {
    license::validate(&key)
}

#[tauri::command]
fn format_bytes_cmd(bytes: u64) -> String {
    format_bytes(bytes)
}

// Reveal a path in the system file manager.
#[tauri::command]
fn reveal_in_finder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg("-R").arg(&path).spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer").arg("/select,").arg(&path).spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        let parent = std::path::Path::new(&path).parent().map(|p| p.to_string_lossy().to_string()).unwrap_or(path.clone());
        std::process::Command::new("xdg-open").arg(parent).spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// Open a folder in the system file manager.
#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let cmd = "open";
    #[cfg(target_os = "windows")]
    let cmd = "explorer";
    #[cfg(target_os = "linux")]
    let cmd = "xdg-open";
    std::process::Command::new(cmd).arg(&path).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            app.manage(ScanState { stop: Arc::new(AtomicBool::new(false)) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            scan_files,
            scan_folders,
            scan_photos_cmd,
            stop_scan,
            trash_files,
            delete_single,
            clean_all_duplicates,
            merge_folder,
            safe_merge,
            export_keepers,
            delete_photos,
            undo_op,
            list_logs,
            read_text_file,
            validate_license,
            format_bytes_cmd,
            reveal_in_finder,
            open_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
