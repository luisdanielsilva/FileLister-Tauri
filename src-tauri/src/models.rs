use serde::{Deserialize, Serialize};

// u64 hashes exceed JS's safe integer range, so they cross the bridge as strings.
mod u64_str {
    use serde::{Deserialize, Deserializer, Serializer};
    pub fn serialize<S: Serializer>(v: &u64, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&v.to_string())
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<u64, D::Error> {
        let s = String::deserialize(d)?;
        s.parse().map_err(serde::de::Error::custom)
    }
}

// Mirrors DuplicateFileInfo
#[derive(Clone, Serialize, Deserialize)]
pub struct FileInfo {
    pub id: String,
    pub path: String, // parent folder
    pub name: String,
    pub size: String,       // formatted, e.g. "1.23 MB"
    pub size_bytes: u64,
    pub is_symlink: bool,
    pub modification_date: Option<i64>, // unix seconds
    pub sha256: Option<String>,
    pub full_path: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct ConfidenceSignal {
    pub name: String,
    pub score: f64,
    pub weight: f64,
    pub detail: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Confidence {
    pub overall: f64,
    pub label: String,
    pub signals: Vec<ConfidenceSignal>,
}

// Mirrors DuplicateGroup
#[derive(Clone, Serialize, Deserialize)]
pub struct DuplicateGroup {
    pub id: String,
    pub name: String,
    pub size: String,
    pub size_bytes: u64,
    pub files: Vec<FileInfo>,
    pub is_symlink_group: bool,
    pub confidence: Option<Confidence>,
    pub root_folder: Option<String>,
}

// Mirrors FolderDuplicateGroup
#[derive(Clone, Serialize, Deserialize)]
pub struct FolderDuplicateGroup {
    pub id: String,
    pub folders: Vec<String>,            // [0] = keep
    pub matched_groups: Vec<DuplicateGroup>,
    pub unique_to_keep: Vec<FileInfo>,
    pub files_to_move: Vec<FileInfo>,
    pub match_ratio: f64,
    pub total_size_bytes: u64,
    pub potential_savings: u64,
    pub root_folder: Option<String>,
}

// Mirrors PhotoInfo
#[derive(Clone, Serialize, Deserialize)]
pub struct PhotoInfo {
    pub id: String,
    pub path: String,
    pub name: String,
    pub size_bytes: u64,
    pub pixel_width: u32,
    pub pixel_height: u32,
    pub capture_date: Option<i64>,
    pub camera_model: Option<String>,
    pub gps: Option<(f64, f64)>,
    #[serde(with = "u64_str")]
    pub d_hash: u64,
    #[serde(with = "u64_str")]
    pub p_hash: u64,
    pub full_path: String,
    pub is_raw: bool,
}

// Mirrors PhotoGroup
#[derive(Clone, Serialize, Deserialize)]
pub struct PhotoGroup {
    pub id: String,
    pub photos: Vec<PhotoInfo>,
    pub keeper_id: String,
    pub reclaimable_bytes: u64,
}

#[derive(Clone, Serialize)]
pub struct ScanResult {
    pub groups: Vec<DuplicateGroup>,
    pub folder_groups: Vec<FolderDuplicateGroup>,
    pub total_potential_savings: u64,
    pub stopped: bool,
}

#[derive(Clone, Serialize)]
pub struct ProgressPayload {
    pub progress: f64,
    pub status: String,
    pub phase: usize,
    pub total_phases: usize,
    pub file_progress: f64,
}

pub fn format_size(bytes: u64) -> String {
    let kb = bytes as f64 / 1024.0;
    if kb < 1024.0 {
        format!("{:.2} KB", kb)
    } else {
        format!("{:.2} MB", kb / 1024.0)
    }
}

pub fn format_bytes(bytes: u64) -> String {
    let kb = bytes as f64 / 1024.0;
    let mb = kb / 1024.0;
    let gb = mb / 1024.0;
    let tb = gb / 1024.0;
    if tb >= 1.0 {
        format!("{:.2} TB", tb)
    } else if gb >= 1.0 {
        format!("{:.2} GB", gb)
    } else if mb >= 1.0 {
        format!("{:.2} MB", mb)
    } else {
        format!("{:.2} KB", kb)
    }
}

pub fn uuid() -> String {
    // Lightweight unique id — avoids pulling in the uuid crate.
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let t = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    format!("{:x}-{:x}", t, n)
}
