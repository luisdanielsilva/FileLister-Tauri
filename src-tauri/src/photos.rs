use crate::models::*;
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use walkdir::WalkDir;

const IMAGE_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "heic", "heif", "tiff", "tif", "gif", "bmp", "webp", "cr2", "cr3", "nef",
    "arw", "dng", "orf", "raf", "rw2",
];
const RAW_EXTENSIONS: &[&str] = &["cr2", "cr3", "nef", "arw", "dng", "orf", "raf", "rw2"];

#[derive(Clone)]
pub struct PhotoOptions {
    pub threshold: f64,
    pub require_exif: bool,
    pub expand_metadata: bool,
    pub expand_time: bool,
    pub expand_gps: bool,
    pub expand_camera: bool,
    pub priority: Vec<String>, // best-copy criteria in order (Settings)
}

fn default_priority() -> Vec<String> {
    ["resolution", "fileSize", "newest", "preferRaw", "hasGPS", "oldest"]
        .iter()
        .map(|s| s.to_string())
        .collect()
}

#[derive(Clone, serde::Serialize)]
pub struct PhotoScanResult {
    pub groups: Vec<PhotoGroup>,
    pub stopped: bool,
}

fn ext_of(name: &str) -> String {
    Path::new(name).extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase()
}

// dHash: 9×8 grayscale, compare adjacent pixels left→right → 64 bits.
fn d_hash(gray9x8: &[f64]) -> u64 {
    let mut hash: u64 = 0;
    let mut bit = 0;
    for row in 0..8 {
        for col in 0..8 {
            if gray9x8[row * 9 + col] < gray9x8[row * 9 + col + 1] {
                hash |= 1u64 << bit;
            }
            bit += 1;
        }
    }
    hash
}

// pHash: 32×32 grayscale → separable DCT → top-left 8×8 → bit = coeff > median(AC).
fn p_hash(gray: &[f64], cos_table: &[[f64; 32]; 8]) -> u64 {
    const N: usize = 32;
    let mut tmp = [[0.0f64; 32]; 8];
    for u in 0..8 {
        for y in 0..N {
            let mut s = 0.0;
            for x in 0..N {
                s += gray[x * N + y] * cos_table[u][x];
            }
            tmp[u][y] = s;
        }
    }
    let mut freqs = [0.0f64; 64];
    for u in 0..8 {
        for v in 0..8 {
            let mut s = 0.0;
            for y in 0..N {
                s += tmp[u][y] * cos_table[v][y];
            }
            freqs[u * 8 + v] = s;
        }
    }
    let mut ac: Vec<f64> = freqs[1..].to_vec();
    ac.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let median = ac[ac.len() / 2];
    let mut hash: u64 = 0;
    for i in 0..64 {
        if freqs[i] > median {
            hash |= 1u64 << i;
        }
    }
    hash
}

fn build_cos_table() -> [[f64; 32]; 8] {
    const N: usize = 32;
    let mut t = [[0.0f64; 32]; 8];
    for k in 0..8 {
        for x in 0..N {
            t[k][x] = (std::f64::consts::PI / N as f64 * (x as f64 + 0.5) * k as f64).cos();
        }
    }
    t
}

fn gray_resized(img: &image::DynamicImage, w: u32, h: u32) -> Vec<f64> {
    let resized = img.resize_exact(w, h, image::imageops::FilterType::Triangle).to_luma8();
    resized.pixels().map(|p| p[0] as f64).collect()
}

struct Exif {
    capture_date: Option<i64>,
    camera: Option<String>,
    gps: Option<(f64, f64)>,
}

fn read_exif(path: &str) -> Exif {
    let mut out = Exif { capture_date: None, camera: None, gps: None };
    let file = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return out,
    };
    let mut reader = std::io::BufReader::new(file);
    let exif = match exif::Reader::new().read_from_container(&mut reader) {
        Ok(e) => e,
        Err(_) => return out,
    };
    use exif::{In, Tag, Value};

    if let Some(f) = exif.get_field(Tag::DateTimeOriginal, In::PRIMARY) {
        let s = f.display_value().to_string();
        // EXIF format "YYYY:MM:DD HH:MM:SS"
        if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(s.trim_matches('"'), "%Y:%m:%d %H:%M:%S") {
            out.capture_date = Some(dt.and_utc().timestamp());
        }
    }
    if let Some(f) = exif.get_field(Tag::Model, In::PRIMARY) {
        out.camera = Some(f.display_value().to_string().trim_matches('"').to_string());
    }
    // GPS
    let lat = exif.get_field(Tag::GPSLatitude, In::PRIMARY);
    let lon = exif.get_field(Tag::GPSLongitude, In::PRIMARY);
    if let (Some(lat), Some(lon)) = (lat, lon) {
        let to_deg = |v: &Value| -> Option<f64> {
            if let Value::Rational(r) = v {
                if r.len() == 3 {
                    return Some(r[0].to_f64() + r[1].to_f64() / 60.0 + r[2].to_f64() / 3600.0);
                }
            }
            None
        };
        if let (Some(mut la), Some(mut lo)) = (to_deg(&lat.value), to_deg(&lon.value)) {
            if let Some(r) = exif.get_field(Tag::GPSLatitudeRef, In::PRIMARY) {
                if r.display_value().to_string().contains('S') {
                    la = -la;
                }
            }
            if let Some(r) = exif.get_field(Tag::GPSLongitudeRef, In::PRIMARY) {
                if r.display_value().to_string().contains('W') {
                    lo = -lo;
                }
            }
            out.gps = Some((la, lo));
        }
    }
    out
}

fn make_photo_info(path: &str, cos_table: &[[f64; 32]; 8]) -> Option<PhotoInfo> {
    let img = image::open(path).ok()?;
    let (pw, ph) = (img.width(), img.height());

    let gray9x8 = gray_resized(&img, 9, 8);
    let gray32 = gray_resized(&img, 32, 32);
    let dh = d_hash(&gray9x8);
    let pp = p_hash(&gray32, cos_table);

    let meta = fs::metadata(path).ok()?;
    let exif = read_exif(path);
    let p = Path::new(path);
    let name = p.file_name()?.to_string_lossy().to_string();
    let parent = p.parent().map(|x| x.to_string_lossy().to_string()).unwrap_or_default();
    let is_raw = RAW_EXTENSIONS.contains(&ext_of(&name).as_str());

    Some(PhotoInfo {
        id: uuid(),
        path: parent,
        name,
        size_bytes: meta.len(),
        pixel_width: pw,
        pixel_height: ph,
        capture_date: exif.capture_date,
        camera_model: exif.camera,
        gps: exif.gps,
        d_hash: dh,
        p_hash: pp,
        full_path: path.to_string(),
        is_raw,
    })
}

// True if `a` is a strictly better keeper than `b` per the configured priority order.
// Mirrors PhotoPreferences.isBetter.
fn is_better(a: &PhotoInfo, b: &PhotoInfo, priority: &[String]) -> bool {
    for c in priority {
        match c.as_str() {
            "resolution" => {
                let pa = a.pixel_width as u64 * a.pixel_height as u64;
                let pb = b.pixel_width as u64 * b.pixel_height as u64;
                if pa != pb {
                    return pa > pb;
                }
            }
            "fileSize" => {
                if a.size_bytes != b.size_bytes {
                    return a.size_bytes > b.size_bytes;
                }
            }
            "newest" => {
                let da = a.capture_date.unwrap_or(i64::MIN);
                let db = b.capture_date.unwrap_or(i64::MIN);
                if da != db {
                    return da > db;
                }
            }
            "oldest" => {
                let da = a.capture_date.unwrap_or(i64::MAX);
                let db = b.capture_date.unwrap_or(i64::MAX);
                if da != db {
                    return da < db;
                }
            }
            "preferRaw" => {
                if a.is_raw != b.is_raw {
                    return a.is_raw;
                }
            }
            "hasGPS" => {
                let ga = a.gps.is_some();
                let gb = b.gps.is_some();
                if ga != gb {
                    return ga;
                }
            }
            _ => {}
        }
    }
    false
}

fn best_copy(photos: &[PhotoInfo], priority: &[String]) -> usize {
    let mut best = 0;
    for i in 1..photos.len() {
        if is_better(&photos[i], &photos[best], priority) {
            best = i;
        }
    }
    best
}

fn exif_corroborates(a: &PhotoInfo, b: &PhotoInfo) -> bool {
    if let (Some(da), Some(db)) = (a.capture_date, b.capture_date) {
        if (da - db).abs() <= 2 {
            return true;
        }
    }
    if let (Some(ca), Some(cb)) = (&a.camera_model, &b.camera_model) {
        if ca == cb && a.pixel_width == b.pixel_width && a.pixel_height == b.pixel_height {
            return true;
        }
    }
    false
}

fn meters_between(a: (f64, f64), b: (f64, f64)) -> f64 {
    let r = 6_371_000.0;
    let d_lat = (b.0 - a.0).to_radians();
    let d_lon = (b.1 - a.1).to_radians();
    let la1 = a.0.to_radians();
    let la2 = b.0.to_radians();
    let h = (d_lat / 2.0).sin().powi(2) + la1.cos() * la2.cos() * (d_lon / 2.0).sin().powi(2);
    2.0 * r * h.sqrt().min(1.0).asin()
}

fn metadata_matches(a: &PhotoInfo, b: &PhotoInfo, opts: &PhotoOptions) -> bool {
    let mut applied = false;
    if opts.expand_time {
        match (a.capture_date, b.capture_date) {
            (Some(da), Some(db)) if (da - db).abs() <= 2 => applied = true,
            _ => return false,
        }
    }
    if opts.expand_gps {
        match (a.gps, b.gps) {
            (Some(ga), Some(gb)) if meters_between(ga, gb) <= 50.0 => applied = true,
            _ => return false,
        }
    }
    if opts.expand_camera {
        match (&a.camera_model, &b.camera_model) {
            (Some(ca), Some(cb)) if ca == cb => applied = true,
            _ => return false,
        }
    }
    applied
}

pub fn run_photo_scan(
    roots: Vec<String>,
    opts: PhotoOptions,
    stop: Arc<AtomicBool>,
    emit: &(dyn Fn(ProgressPayload) + Sync),
) -> PhotoScanResult {
    let send = |progress: f64, status: String| {
        emit(ProgressPayload { progress, status, phase: 0, total_phases: 1, file_progress: 0.0 });
    };
    let cos_table = build_cos_table();

    // collect image urls
    let mut urls: Vec<String> = Vec::new();
    for root in &roots {
        for entry in WalkDir::new(root).follow_links(false).into_iter().filter_map(|e| e.ok()) {
            if stop.load(Ordering::Relaxed) {
                break;
            }
            if entry.file_type().is_file() {
                let name = entry.file_name().to_string_lossy().to_string();
                if IMAGE_EXTENSIONS.contains(&ext_of(&name).as_str()) {
                    urls.push(entry.path().to_string_lossy().to_string());
                }
            }
        }
    }
    if urls.is_empty() {
        return PhotoScanResult { groups: vec![], stopped: stop.load(Ordering::Relaxed) };
    }

    let total = urls.len();
    let mut photos: Vec<PhotoInfo> = Vec::with_capacity(total);
    for (i, url) in urls.iter().enumerate() {
        if stop.load(Ordering::Relaxed) {
            break;
        }
        if let Some(info) = make_photo_info(url, &cos_table) {
            photos.push(info);
        }
        if i % 5 == 0 {
            let name = Path::new(url).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            send(i as f64 / total as f64, format!("Analyzing {}/{}: {}", i + 1, total, name));
        }
    }

    if stop.load(Ordering::Relaxed) {
        return PhotoScanResult { groups: vec![], stopped: true };
    }

    send(1.0, "Grouping similar photos…".into());
    let groups = group_similar(photos, &opts, &stop);
    PhotoScanResult { groups, stopped: false }
}

fn group_similar(photos: Vec<PhotoInfo>, opts: &PhotoOptions, stop: &Arc<AtomicBool>) -> Vec<PhotoGroup> {
    let n = photos.len();
    if n < 2 {
        return vec![];
    }
    let max_ham = ((1.0 - opts.threshold) * 64.0) as u32;

    let mut parent: Vec<usize> = (0..n).collect();
    fn find(parent: &mut [usize], x: usize) -> usize {
        let mut r = x;
        while parent[r] != r {
            parent[r] = parent[parent[r]];
            r = parent[r];
        }
        r
    }
    fn union(parent: &mut [usize], a: usize, b: usize) {
        let ra = find(parent, a);
        let rb = find(parent, b);
        if ra != rb {
            parent[ra] = rb;
        }
    }

    for i in 0..n {
        if stop.load(Ordering::Relaxed) {
            break;
        }
        for j in (i + 1)..n {
            let dd = (photos[i].d_hash ^ photos[j].d_hash).count_ones();
            if dd > max_ham + 12 {
                continue;
            }
            let pd = (photos[i].p_hash ^ photos[j].p_hash).count_ones();
            if pd <= max_ham {
                if opts.require_exif && !exif_corroborates(&photos[i], &photos[j]) {
                    continue;
                }
                union(&mut parent, i, j);
            }
        }
    }

    if opts.expand_metadata && (opts.expand_time || opts.expand_gps || opts.expand_camera) {
        for i in 0..n {
            if stop.load(Ordering::Relaxed) {
                break;
            }
            for j in (i + 1)..n {
                if find(&mut parent, i) != find(&mut parent, j) && metadata_matches(&photos[i], &photos[j], opts) {
                    union(&mut parent, i, j);
                }
            }
        }
    }

    let mut buckets: HashMap<usize, Vec<PhotoInfo>> = HashMap::new();
    for i in 0..n {
        let r = find(&mut parent, i);
        buckets.entry(r).or_default().push(photos[i].clone());
    }

    let mut groups: Vec<PhotoGroup> = buckets
        .into_values()
        .filter(|m| m.len() > 1)
        .map(|members| {
            let prio = if opts.priority.is_empty() { default_priority() } else { opts.priority.clone() };
            let keeper_idx = best_copy(&members, &prio);
            let keeper_id = members[keeper_idx].id.clone();
            let reclaimable: u64 = members.iter().filter(|p| p.id != keeper_id).map(|p| p.size_bytes).sum();
            PhotoGroup { id: uuid(), photos: members, keeper_id, reclaimable_bytes: reclaimable }
        })
        .collect();

    groups.sort_by(|a, b| b.reclaimable_bytes.cmp(&a.reclaimable_bytes));
    groups
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    // A structured image (colored blocks in a grid) — stable under downscaling,
    // unlike a smooth gradient whose DCT bits flip near the median.
    fn blocks(w: u32, h: u32, seed: u32) -> image::RgbImage {
        image::RgbImage::from_fn(w, h, |x, y| {
            let bx = (x * 4 / w) as u32;
            let by = (y * 4 / h) as u32;
            let v = (bx * 13 + by * 7 + seed) % 3;
            match v {
                0 => image::Rgb([20, 20, 20]),
                1 => image::Rgb([230, 60, 60]),
                _ => image::Rgb([240, 240, 240]),
            }
        })
    }

    #[test]
    fn groups_visually_similar_photos_and_excludes_distinct_ones() {
        let root = std::env::temp_dir().join(format!("fl-photos-{}", uuid()));
        fs::create_dir_all(&root).unwrap();

        // Same structured pattern at two resolutions → should group.
        let pic = blocks(400, 300, 0);
        pic.save(root.join("pattern_big.png")).unwrap();
        image::DynamicImage::ImageRgb8(pic).resize_exact(200, 150, image::imageops::FilterType::Triangle)
            .save(root.join("pattern_small.png")).unwrap();

        // A different pattern (different block layout) → should NOT group.
        blocks(300, 300, 1).save(root.join("other.png")).unwrap();

        // The two resolutions hash to ~81% pHash similarity (hard block edges shift
        // slightly on downscale); the distinct pattern sits at ~53%. A 0.78 threshold
        // cleanly separates them — the same user-tunable similarity slider as the app.
        let opts = PhotoOptions { threshold: 0.78, require_exif: false, expand_metadata: false, expand_time: false, expand_gps: false, expand_camera: false, priority: vec![] };
        let stop = Arc::new(AtomicBool::new(false));
        let res = run_photo_scan(vec![root.to_string_lossy().to_string()], opts, stop, &|_| {});

        assert_eq!(res.groups.len(), 1, "the two sunsets should form exactly one group");
        assert_eq!(res.groups[0].photos.len(), 2);
        // keeper is the higher-resolution copy
        let keeper = res.groups[0].photos.iter().find(|p| p.id == res.groups[0].keeper_id).unwrap();
        assert_eq!((keeper.pixel_width, keeper.pixel_height), (400, 300));
        fs::remove_dir_all(&root).ok();
    }
}
