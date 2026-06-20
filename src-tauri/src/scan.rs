use crate::models::*;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::UNIX_EPOCH;
use walkdir::WalkDir;

const MEDIA_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "gif", "heic", "tiff", "bmp", "mp4", "mov", "avi", "mkv", "wmv", "flv",
    "webm",
];

#[derive(Clone)]
pub struct ScanOptions {
    pub deep: bool,
    pub media_only: bool,
    pub skip_hidden: bool,
    pub detect_symlinks: bool,
    pub detect_folders: bool,
    pub folder_threshold: f64,
}

// Reports progress back to the UI. `emit` forwards a ProgressPayload.
pub struct Progress<'a> {
    pub emit: &'a (dyn Fn(ProgressPayload) + Sync),
    pub phase: usize,
    pub total_phases: usize,
}

impl<'a> Progress<'a> {
    fn send(&self, progress: f64, status: impl Into<String>) {
        (self.emit)(ProgressPayload {
            progress,
            status: status.into(),
            phase: self.phase,
            total_phases: self.total_phases,
            file_progress: 0.0,
        });
    }
}

fn ext_of(name: &str) -> String {
    Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase()
}

fn modified_unix(meta: &fs::Metadata) -> Option<i64> {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
}

pub fn calculate_sha256(path: &str) -> Option<String> {
    let mut file = fs::File::open(path).ok()?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = file.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Some(format!("{:x}", hasher.finalize()))
}

// Byte-for-byte comparison used as the mandatory safety check before deletion.
pub fn is_content_identical(p1: &str, p2: &str) -> bool {
    let (m1, m2) = match (fs::metadata(p1), fs::metadata(p2)) {
        (Ok(a), Ok(b)) => (a, b),
        _ => return false,
    };
    if m1.len() != m2.len() {
        return false;
    }
    let (mut f1, mut f2) = match (fs::File::open(p1), fs::File::open(p2)) {
        (Ok(a), Ok(b)) => (a, b),
        _ => return false,
    };
    let mut b1 = [0u8; 65536];
    let mut b2 = [0u8; 65536];
    loop {
        let n1 = match f1.read(&mut b1) {
            Ok(n) => n,
            Err(_) => return false,
        };
        let n2 = match f2.read(&mut b2) {
            Ok(n) => n,
            Err(_) => return false,
        };
        if n1 != n2 || b1[..n1] != b2[..n2] {
            return false;
        }
        if n1 == 0 {
            break;
        }
    }
    true
}

// One scan pass over the given roots. Mirrors FileScanner.scanRoots.
pub fn scan_roots(
    roots: &[String],
    opts: &ScanOptions,
    stop: &Arc<AtomicBool>,
    progress: &mut Progress,
) -> (Vec<DuplicateGroup>, Vec<FolderDuplicateGroup>) {
    let mut tracker: HashMap<String, Vec<FileInfo>> = HashMap::new();
    let mut symlink_tracker: HashMap<String, Vec<FileInfo>> = HashMap::new();
    let mut all_files_per_folder: HashMap<String, Vec<FileInfo>> = HashMap::new();

    // Count for progress.
    let total: usize = roots
        .iter()
        .map(|r| WalkDir::new(r).into_iter().filter_map(|e| e.ok()).count())
        .sum();
    let total = total.max(1);
    let mut processed = 0usize;

    for root in roots {
        for entry in WalkDir::new(root).follow_links(false).into_iter().filter_map(|e| e.ok()) {
            if stop.load(Ordering::Relaxed) {
                break;
            }
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();

            if opts.skip_hidden && name.starts_with('.') {
                continue;
            }

            let meta = match entry.path().symlink_metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            let is_symlink = meta.file_type().is_symlink();
            let parent = path.parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
            let ext = ext_of(&name);

            if is_symlink && opts.detect_symlinks {
                let target = fs::canonicalize(path).map(|p| p.to_string_lossy().to_string());
                if let Ok(key) = target {
                    let target_size = fs::metadata(&key).map(|m| m.len()).unwrap_or(0);
                    let full_path = path.to_string_lossy().to_string();
                    let info = FileInfo {
                        id: uuid(),
                        path: parent.clone(),
                        name: name.clone(),
                        size: format_size(target_size),
                        size_bytes: target_size,
                        is_symlink: true,
                        modification_date: modified_unix(&meta),
                        sha256: None,
                        full_path,
                    };
                    symlink_tracker.entry(key).or_default().push(info);
                }
            } else if meta.file_type().is_file() && !is_symlink {
                if opts.media_only && !MEDIA_EXTENSIONS.contains(&ext.as_str()) {
                    processed += 1;
                    continue;
                }
                let size_bytes = meta.len();
                let full_path = path.to_string_lossy().to_string();
                let info = FileInfo {
                    id: uuid(),
                    path: parent.clone(),
                    name: name.clone(),
                    size: format_size(size_bytes),
                    size_bytes,
                    is_symlink: false,
                    modification_date: modified_unix(&meta),
                    sha256: None,
                    full_path,
                };
                let key = format!("{}_{}", name, size_bytes);
                tracker.entry(key).or_default().push(info.clone());
                all_files_per_folder.entry(parent).or_default().push(info);
            }

            processed += 1;
            if processed % 64 == 0 {
                progress.send(processed as f64 / total as f64, format!("Scanning: {}", name));
            }
        }
        if stop.load(Ordering::Relaxed) {
            break;
        }
    }

    // name+size groups with 2+ copies
    let mut groups: Vec<DuplicateGroup> = tracker
        .into_values()
        .filter(|v| v.len() > 1)
        .map(|files| DuplicateGroup {
            id: uuid(),
            name: files[0].name.clone(),
            size: files[0].size.clone(),
            size_bytes: files[0].size_bytes,
            files,
            is_symlink_group: false,
            confidence: None,
            root_folder: None,
        })
        .collect();

    // symlink groups
    for (target, files) in symlink_tracker.into_iter().filter(|(_, v)| v.len() > 1) {
        let target_name = Path::new(&target)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or(target.clone());
        groups.push(DuplicateGroup {
            id: uuid(),
            name: target_name,
            size: files[0].size.clone(),
            size_bytes: files[0].size_bytes,
            files,
            is_symlink_group: true,
            confidence: None,
            root_folder: None,
        });
    }

    // Deep analysis (SHA-256) — verify each candidate group.
    if opts.deep && !stop.load(Ordering::Relaxed) && !groups.is_empty() {
        progress.phase += 1;
        progress.send(0.0, "Deep Analysis (SHA-256)...");
        groups = deep_analysis(groups, stop, progress);
    }

    let mut folder_groups = Vec::new();
    if !stop.load(Ordering::Relaxed) {
        if opts.detect_folders {
            progress.phase += 1;
            folder_groups = detect_folder_duplicates(&all_files_per_folder, &mut groups, opts, stop, progress);
        }
        compute_confidence(&mut groups, &folder_groups);
    }

    (groups, folder_groups)
}

fn deep_analysis(
    candidates: Vec<DuplicateGroup>,
    stop: &Arc<AtomicBool>,
    progress: &mut Progress,
) -> Vec<DuplicateGroup> {
    let mut out = Vec::new();
    let count = candidates.len().max(1);
    for (i, group) in candidates.into_iter().enumerate() {
        if stop.load(Ordering::Relaxed) {
            break;
        }
        progress.send(i as f64 / count as f64, format!("Hashing group {} of {}...", i + 1, count));
        let mut by_hash: HashMap<String, Vec<FileInfo>> = HashMap::new();
        for f in group.files {
            match calculate_sha256(&f.full_path) {
                Some(h) => by_hash.entry(h).or_default().push(f),
                None => {
                    by_hash.entry(format!("failed_{}", f.id)).or_default().push(f);
                }
            }
        }
        for files in by_hash.into_values().filter(|v| v.len() > 1) {
            out.push(DuplicateGroup {
                id: uuid(),
                name: files[0].name.clone(),
                size: files[0].size.clone(),
                size_bytes: files[0].size_bytes,
                files,
                is_symlink_group: false,
                confidence: None,
                root_folder: None,
            });
        }
    }
    out
}

// Union-find folder clustering — mirrors detectFolderDuplicatesIfNeeded.
fn detect_folder_duplicates(
    all_files: &HashMap<String, Vec<FileInfo>>,
    groups: &mut Vec<DuplicateGroup>,
    opts: &ScanOptions,
    stop: &Arc<AtomicBool>,
    progress: &mut Progress,
) -> Vec<FolderDuplicateGroup> {
    let all_list: Vec<&FileInfo> = all_files.values().flatten().collect();
    let total = all_list.len();
    if total == 0 {
        return Vec::new();
    }
    progress.send(0.0, "Folder analysis: hashing files...");

    // hash -> files (with sha annotated)
    let mut hash_groups: HashMap<String, Vec<FileInfo>> = HashMap::new();
    for (i, file) in all_list.iter().enumerate() {
        if stop.load(Ordering::Relaxed) {
            return Vec::new();
        }
        if i % 32 == 0 {
            progress.send(i as f64 / total as f64, format!("Folder SHA-256: {}", file.name));
        }
        if let Some(hash) = calculate_sha256(&file.full_path) {
            let mut f = (*file).clone();
            f.sha256 = Some(hash.clone());
            hash_groups.entry(hash).or_default().push(f);
        }
    }
    progress.send(1.0, "Clustering folders...");

    let folder_file_counts: HashMap<String, usize> =
        all_files.iter().map(|(k, v)| (k.clone(), v.len())).collect();

    // pairwise shared hashes
    let mut folder_pair_hashes: HashMap<String, HashSet<String>> = HashMap::new();
    let mut folder_pair_folders: HashMap<String, (String, String)> = HashMap::new();
    for (hash, files) in &hash_groups {
        if files.len() < 2 {
            continue;
        }
        let mut folder_set: Vec<String> =
            files.iter().map(|f| f.path.clone()).collect::<HashSet<_>>().into_iter().collect();
        if folder_set.len() < 2 {
            continue;
        }
        folder_set.sort();
        for i in 0..folder_set.len() {
            for j in (i + 1)..folder_set.len() {
                let key = format!("{}|{}", folder_set[i], folder_set[j]);
                folder_pair_hashes.entry(key.clone()).or_default().insert(hash.clone());
                folder_pair_folders.insert(key, (folder_set[i].clone(), folder_set[j].clone()));
            }
        }
    }

    // union-find
    let mut parent: HashMap<String, String> =
        folder_file_counts.keys().map(|k| (k.clone(), k.clone())).collect();
    fn find(parent: &mut HashMap<String, String>, x: &str) -> String {
        let mut root = x.to_string();
        while let Some(p) = parent.get(&root) {
            if p == &root {
                break;
            }
            root = p.clone();
        }
        let mut cur = x.to_string();
        while let Some(p) = parent.get(&cur).cloned() {
            if p == root {
                break;
            }
            parent.insert(cur.clone(), root.clone());
            cur = p;
        }
        root
    }

    let mut pair_ratio: HashMap<String, f64> = HashMap::new();
    for (key, hashes) in &folder_pair_hashes {
        let (a, b) = match folder_pair_folders.get(key) {
            Some(v) => v,
            None => continue,
        };
        let min_count = folder_file_counts.get(a).copied().unwrap_or(0)
            .min(folder_file_counts.get(b).copied().unwrap_or(0));
        if min_count == 0 {
            continue;
        }
        let ratio = hashes.len() as f64 / min_count as f64;
        pair_ratio.insert(key.clone(), ratio);
        if ratio >= opts.folder_threshold {
            let ra = find(&mut parent, a);
            let rb = find(&mut parent, b);
            if ra != rb {
                parent.insert(ra, rb);
            }
        }
    }

    // collect clusters
    let mut clusters: HashMap<String, Vec<String>> = HashMap::new();
    let folders: Vec<String> = folder_file_counts.keys().cloned().collect();
    for folder in folders {
        let root = find(&mut parent, &folder);
        clusters.entry(root).or_default().push(folder);
    }

    let mut detected: Vec<FolderDuplicateGroup> = Vec::new();
    for (_, cluster_folders) in clusters {
        if cluster_folders.len() < 2 {
            continue;
        }
        let cluster_set: HashSet<&String> = cluster_folders.iter().collect();

        // keep = most files (tie: larger total size)
        let keep = cluster_folders
            .iter()
            .max_by(|a, b| {
                let ca = folder_file_counts.get(*a).copied().unwrap_or(0);
                let cb = folder_file_counts.get(*b).copied().unwrap_or(0);
                if ca != cb {
                    return ca.cmp(&cb);
                }
                let sa: u64 = all_files.get(*a).map(|v| v.iter().map(|f| f.size_bytes).sum()).unwrap_or(0);
                let sb: u64 = all_files.get(*b).map(|v| v.iter().map(|f| f.size_bytes).sum()).unwrap_or(0);
                sa.cmp(&sb)
            })
            .unwrap()
            .clone();
        let mut ordered = vec![keep.clone()];
        let mut others: Vec<String> = cluster_folders.iter().filter(|f| **f != keep).cloned().collect();
        others.sort();
        ordered.extend(others.clone());

        // group cluster files by content
        let mut content_to_files: HashMap<String, Vec<FileInfo>> = HashMap::new();
        for (hash, files) in &hash_groups {
            let in_cluster: Vec<FileInfo> =
                files.iter().filter(|f| cluster_set.contains(&f.path)).cloned().collect();
            if !in_cluster.is_empty() {
                content_to_files.insert(hash.clone(), in_cluster);
            }
        }

        let mut matched_groups = Vec::new();
        let mut unique_to_keep = Vec::new();
        let mut files_to_move = Vec::new();
        for (_hash, files) in &content_to_files {
            let f0 = &files[0];
            if files.len() >= 2 {
                matched_groups.push(DuplicateGroup {
                    id: uuid(),
                    name: f0.name.clone(),
                    size: f0.size.clone(),
                    size_bytes: f0.size_bytes,
                    files: files.clone(),
                    is_symlink_group: false,
                    confidence: None,
                    root_folder: None,
                });
            }
            let in_keep = files.iter().any(|f| f.path == keep);
            if in_keep {
                if files.len() == 1 {
                    unique_to_keep.push(f0.clone());
                }
            } else {
                files_to_move.push(files.iter().find(|f| f.path != keep).cloned().unwrap_or(f0.clone()));
            }
        }

        let mut ratio = opts.folder_threshold;
        for (key, r) in &pair_ratio {
            if let Some((a, b)) = folder_pair_folders.get(key) {
                if cluster_set.contains(a) && cluster_set.contains(b) {
                    ratio = ratio.max(*r);
                }
            }
        }

        let total_size: u64 = matched_groups.iter().map(|g| g.size_bytes).sum::<u64>()
            + files_to_move.iter().map(|f| f.size_bytes).sum::<u64>();
        let potential_savings: u64 = matched_groups
            .iter()
            .map(|g| g.size_bytes * (g.files.len().saturating_sub(1)) as u64)
            .sum();

        detected.push(FolderDuplicateGroup {
            id: uuid(),
            folders: ordered,
            matched_groups,
            unique_to_keep,
            files_to_move,
            match_ratio: ratio.min(1.0),
            total_size_bytes: total_size,
            potential_savings,
            root_folder: None,
        });
    }

    // Remove name+size groups already covered by a detected cluster.
    let detected_folder_sets: Vec<HashSet<String>> =
        detected.iter().map(|fg| fg.folders.iter().cloned().collect()).collect();
    groups.retain(|group| {
        let file_folders: HashSet<String> = group.files.iter().map(|f| f.path.clone()).collect();
        !detected_folder_sets.iter().any(|cf| file_folders.iter().filter(|f| cf.contains(*f)).count() >= 2)
    });

    detected.sort_by(|a, b| b.match_ratio.partial_cmp(&a.match_ratio).unwrap());
    detected
}

// 5-signal confidence scoring — mirrors computeConfidence.
fn compute_confidence(groups: &mut [DuplicateGroup], folder_groups: &[FolderDuplicateGroup]) {
    let copy_patterns = [
        "copy", "backup", "bak", " old", "_old", "archive", "temp", "(1)", "(2)", "(3)", "- copy",
        "_copy",
    ];

    for group in groups.iter_mut() {
        if group.files.len() < 2 {
            continue;
        }
        let folders: Vec<String> = group.files.iter().map(|f| f.path.clone()).collect();
        let mut signals = Vec::new();

        // 1 — folder similarity (0.35)
        let mut folder_match_score = 0.0;
        let mut folder_match_detail = "No related folder cluster detected".to_string();
        for fg in folder_groups {
            let cf: HashSet<&String> = fg.folders.iter().collect();
            if folders.iter().filter(|f| cf.contains(f)).count() >= 2 && fg.match_ratio > folder_match_score {
                folder_match_score = fg.match_ratio;
                let keep_name = base_name(&fg.folders[0]);
                folder_match_detail = format!(
                    "Part of a {}-folder cluster around \"{}\" ({}% match)",
                    fg.folders.len(),
                    keep_name,
                    (fg.match_ratio * 100.0) as i64
                );
            }
        }
        signals.push(ConfidenceSignal {
            name: "Folder similarity".into(),
            score: folder_match_score,
            weight: 0.35,
            detail: folder_match_detail,
        });

        // 2 — folder name pattern (0.25)
        let mut name_score = 0.0;
        let mut name_detail = "No copy/backup naming detected in parent folders".to_string();
        for folder in &folders {
            let lower = base_name(folder).to_lowercase();
            if copy_patterns.iter().any(|p| lower.contains(p)) {
                name_score = 1.0;
                name_detail = format!("Folder \"{}\" suggests a copy or backup", base_name(folder));
                break;
            }
        }
        signals.push(ConfidenceSignal {
            name: "Folder name pattern".into(),
            score: name_score,
            weight: 0.25,
            detail: name_detail,
        });

        // 3 — timestamp match (0.20)
        let dates: Vec<i64> = group.files.iter().filter_map(|f| f.modification_date).collect();
        let mut ts_score = 0.0;
        let mut ts_detail = "Modification dates unavailable".to_string();
        if dates.len() == group.files.len() && !dates.is_empty() {
            let diff = (dates.iter().max().unwrap() - dates.iter().min().unwrap()) as f64;
            if diff < 1.0 {
                ts_score = 1.0;
                ts_detail = "All copies modified within 1 second (exact copy)".into();
            } else if diff < 60.0 {
                ts_score = 0.8;
                ts_detail = "All copies modified within 1 minute of each other".into();
            } else if diff < 3600.0 {
                ts_score = 0.5;
                ts_detail = format!("Copies modified within {} minute(s) of each other", (diff / 60.0) as i64);
            } else if diff < 86400.0 {
                ts_score = 0.3;
                ts_detail = format!("Copies modified within {} hour(s) of each other", (diff / 3600.0) as i64);
            } else {
                ts_score = 0.1;
                ts_detail = format!("Copies modified {} day(s) apart — may be independently maintained", (diff / 86400.0) as i64);
            }
        }
        signals.push(ConfidenceSignal { name: "Timestamp match".into(), score: ts_score, weight: 0.20, detail: ts_detail });

        // 4 — path proximity (0.10)
        let path_components: Vec<Vec<String>> = folders
            .iter()
            .map(|f| f.split('/').filter(|s| !s.is_empty()).map(|s| s.to_string()).collect())
            .collect();
        let min_depth = path_components.iter().map(|c| c.len()).min().unwrap_or(0);
        let mut common_depth = 0;
        for d in 0..min_depth {
            if path_components.iter().all(|c| c[d] == path_components[0][d]) {
                common_depth = d + 1;
            } else {
                break;
            }
        }
        let max_depth = path_components.iter().map(|c| c.len()).max().unwrap_or(1).max(1);
        let divergence = (max_depth - common_depth) as f64 / max_depth as f64;
        let path_score = (1.0 - divergence).max(0.0);
        let path_detail = if divergence < 0.2 {
            "Files differ only at the last path segment — very close"
        } else if divergence < 0.5 {
            "Files share most of their path (moderate divergence)"
        } else {
            "Files are in very different filesystem locations"
        };
        signals.push(ConfidenceSignal { name: "Path proximity".into(), score: path_score, weight: 0.10, detail: path_detail.into() });

        // 5 — copy count (0.10)
        let count = group.files.len();
        let (copy_score, copy_detail) = if count == 2 {
            (0.4, "2 copies — inconclusive on its own".to_string())
        } else if (3..=5).contains(&count) {
            (0.65, format!("{} copies — moderately suggests accidental duplication", count))
        } else {
            (0.85, format!("{} copies — strongly suggests mass duplication", count))
        };
        signals.push(ConfidenceSignal { name: "Copy count".into(), score: copy_score, weight: 0.10, detail: copy_detail });

        let overall: f64 = signals.iter().map(|s| s.score * s.weight).sum();
        let label = if overall >= 0.75 {
            "Very likely accidental"
        } else if overall >= 0.5 {
            "Probably accidental"
        } else if overall >= 0.3 {
            "Uncertain"
        } else {
            "Possibly intentional"
        };
        group.confidence = Some(Confidence { overall, label: label.into(), signals });
    }
}

fn base_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("fl-test-{}-{}", name, uuid()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }
    fn noop() -> impl Fn(ProgressPayload) + Sync {
        |_| {}
    }
    fn opts(deep: bool, folders: bool) -> ScanOptions {
        ScanOptions { deep, media_only: false, skip_hidden: false, detect_symlinks: false, detect_folders: folders, folder_threshold: 0.75 }
    }

    #[test]
    fn finds_name_size_duplicate_groups_and_verifies_with_sha256() {
        let root = tmp("files");
        fs::create_dir_all(root.join("sub")).unwrap();
        fs::write(root.join("report.txt"), b"identical content A").unwrap();
        fs::write(root.join("sub/report.txt"), b"identical content A").unwrap(); // dup of report.txt
        fs::write(root.join("data.bin"), b"identical content B").unwrap();
        fs::write(root.join("sub/data.bin"), b"identical content B").unwrap(); // dup of data.bin
        fs::write(root.join("unique.txt"), b"only one of these").unwrap();

        let stop = Arc::new(AtomicBool::new(false));
        let res = run_scan(vec![root.to_string_lossy().to_string()], false, opts(true, false), stop, &noop());

        assert_eq!(res.groups.len(), 2, "expected report.txt and data.bin groups");
        for g in &res.groups {
            assert_eq!(g.files.len(), 2);
            assert!(g.confidence.is_some(), "confidence should be scored");
        }
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn detects_duplicate_folder_cluster() {
        let root = tmp("folders");
        for sub in ["A", "B"] {
            fs::create_dir_all(root.join(sub)).unwrap();
            for i in 1..=4 {
                fs::write(root.join(sub).join(format!("f{}.txt", i)), format!("shared payload {}", i)).unwrap();
            }
        }
        // Each folder has one unique file → the non-keep folder's unique file must be
        // moved into keep (4 shared / 5 = 0.8 ratio, still clustered).
        fs::write(root.join("A/onlyA.txt"), b"only in folder A").unwrap();
        fs::write(root.join("B/onlyB.txt"), b"only in folder B").unwrap();

        let stop = Arc::new(AtomicBool::new(false));
        let res = run_scan(vec![root.to_string_lossy().to_string()], false, opts(false, true), stop, &noop());

        assert_eq!(res.folder_groups.len(), 1, "A and B should form one cluster");
        let fg = &res.folder_groups[0];
        assert_eq!(fg.folders.len(), 2);
        assert!(fg.match_ratio >= 0.75);
        assert_eq!(fg.matched_groups.len(), 4, "f1..f4 are the shared content");
        assert_eq!(fg.files_to_move.len(), 1, "the non-keep folder's unique file moves into keep");
        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn respects_stop_flag() {
        let root = tmp("stop");
        fs::write(root.join("a.txt"), b"x").unwrap();
        let stop = Arc::new(AtomicBool::new(true)); // already stopped
        let res = run_scan(vec![root.to_string_lossy().to_string()], false, opts(false, false), stop, &noop());
        assert!(res.stopped);
        fs::remove_dir_all(&root).ok();
    }
}

// Top-level entry: handles combined vs per-folder scope. Mirrors performScan.
#[allow(clippy::too_many_arguments)]
pub fn run_scan(
    roots: Vec<String>,
    per_folder: bool,
    opts: ScanOptions,
    stop: Arc<AtomicBool>,
    emit: &(dyn Fn(ProgressPayload) + Sync),
) -> ScanResult {
    let base_phases = 1 + if opts.deep { 1 } else { 0 } + if opts.detect_folders { 1 } else { 0 };
    let total_phases = if per_folder { base_phases * roots.len().max(1) } else { base_phases };

    let mut all_groups = Vec::new();
    let mut all_folder_groups = Vec::new();
    let mut progress = Progress { emit, phase: 0, total_phases };

    if !per_folder {
        let (g, fg) = scan_roots(&roots, &opts, &stop, &mut progress);
        all_groups = g;
        all_folder_groups = fg;
    } else {
        for root in &roots {
            if stop.load(Ordering::Relaxed) {
                break;
            }
            let (g, fg) = scan_roots(std::slice::from_ref(root), &opts, &stop, &mut progress);
            for mut group in g {
                group.root_folder = Some(root.clone());
                all_groups.push(group);
            }
            for mut fg in fg {
                fg.root_folder = Some(root.clone());
                all_folder_groups.push(fg);
            }
        }
    }

    let stopped = stop.load(Ordering::Relaxed);
    let total_savings: u64 = all_groups
        .iter()
        .map(|g| g.size_bytes * (g.files.len().saturating_sub(1)) as u64)
        .sum();

    ScanResult {
        groups: all_groups,
        folder_groups: all_folder_groups,
        total_potential_savings: total_savings,
        stopped,
    }
}
