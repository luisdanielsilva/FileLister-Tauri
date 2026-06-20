// Mirrors MergeLog.swift: every destructive/merge operation writes a JSON + HTML
// report into ~/Documents/FileLister Logs/. The Operation History viewer reads them back.
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

pub const APP_VERSION: &str = "1.21.0";

#[derive(Serialize, Deserialize, Clone)]
pub struct LogEntry {
    pub action: String,
    pub file_name: String,
    pub source_path: String,
    pub source_folder: String,
    pub destination_path: String,
    pub destination_folder: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub note: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct LogCluster {
    pub keep_folder: String,
    pub other_folders: Vec<String>,
    pub result_name: String,
    pub result_path: String,
    pub entries: Vec<LogEntry>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct LogReport {
    pub timestamp: String, // ISO-8601
    pub app_version: String,
    pub mode: String,
    pub rename_kept_folder: bool,
    pub clusters: Vec<LogCluster>,
}

impl LogReport {
    pub fn new(mode: &str, rename_kept: bool, clusters: Vec<LogCluster>) -> Self {
        LogReport {
            timestamp: chrono::Local::now().to_rfc3339(),
            app_version: APP_VERSION.to_string(),
            mode: mode.to_string(),
            rename_kept_folder: rename_kept,
            clusters,
        }
    }
}

pub fn entry(action: &str, name: &str, src: &str, src_folder: &str, dest: &str, dest_folder: &str, size: u64, note: &str) -> LogEntry {
    LogEntry {
        action: action.into(),
        file_name: name.into(),
        source_path: src.into(),
        source_folder: src_folder.into(),
        destination_path: dest.into(),
        destination_folder: dest_folder.into(),
        size_bytes: size,
        sha256: String::new(),
        note: note.into(),
    }
}

pub fn default_log_dir() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok().or_else(|| std::env::var("USERPROFILE").ok())?;
    Some(PathBuf::from(home).join("Documents").join("FileLister Logs"))
}

// Writes <base>.json and <base>.html, returns the json path. Mirrors MergeLogWriter.write.
pub fn write(report: &LogReport) -> Option<String> {
    write_to(report, &default_log_dir()?)
}

pub fn write_to(report: &LogReport, dir: &std::path::Path) -> Option<String> {
    fs::create_dir_all(dir).ok()?;
    // Microsecond stamp keeps rapid successive writes from colliding.
    let stamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S-%6f").to_string();
    let base = format!("FileLister-merge-{}", stamp);

    let json = serde_json::to_string_pretty(report).ok()?;
    let json_path = dir.join(format!("{}.json", base));
    fs::write(&json_path, json).ok()?;

    let html_path = dir.join(format!("{}.html", base));
    fs::write(&html_path, render_html(report)).ok();

    Some(json_path.to_string_lossy().to_string())
}

pub fn list() -> Vec<(String, LogReport)> {
    match default_log_dir() {
        Some(d) => list_in(&d),
        None => vec![],
    }
}

pub fn list_in(dir: &std::path::Path) -> Vec<(String, LogReport)> {
    let mut out = Vec::new();
    if let Ok(rd) = fs::read_dir(&dir) {
        for e in rd.flatten() {
            let p = e.path();
            let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            if name.starts_with("FileLister-merge-") && name.ends_with(".json") {
                if let Ok(text) = fs::read_to_string(&p) {
                    if let Ok(report) = serde_json::from_str::<LogReport>(&text) {
                        out.push((p.to_string_lossy().to_string(), report));
                    }
                }
            }
        }
    }
    out.sort_by(|a, b| b.1.timestamp.cmp(&a.1.timestamp));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_and_reads_back_a_report() {
        let dir = std::env::temp_dir().join(format!("fl-logs-{}", chrono::Local::now().timestamp_nanos_opt().unwrap()));
        let cluster = LogCluster {
            keep_folder: "/a".into(),
            other_folders: vec!["/b".into()],
            result_name: "merged".into(),
            result_path: "/a".into(),
            entries: vec![
                entry("MOVED", "x.txt", "/b/x.txt", "/b", "/a", "/a", 100, "moved"),
                entry("TRASHED", "y.txt", "/b/y.txt", "/b", "Trash", "Trash", 200, "dup"),
            ],
        };
        let report = LogReport::new("In-place merge & clean", false, vec![cluster]);
        let json_path = write_to(&report, &dir).expect("write");
        assert!(json_path.ends_with(".json"));
        assert!(std::path::Path::new(&json_path.replace(".json", ".html")).exists(), "HTML log written");

        let listed = list_in(&dir);
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].1.mode, "In-place merge & clean");
        assert_eq!(listed[0].1.clusters[0].entries.len(), 2);
        std::fs::remove_dir_all(&dir).ok();
    }
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn byte_string(bytes: u64) -> String {
    let kb = bytes as f64 / 1024.0;
    let mb = kb / 1024.0;
    let gb = mb / 1024.0;
    if gb >= 1.0 { format!("{:.2} GB", gb) }
    else if mb >= 1.0 { format!("{:.2} MB", mb) }
    else if kb >= 1.0 { format!("{:.1} KB", kb) }
    else { format!("{} B", bytes) }
}

fn css_class(action: &str) -> &'static str {
    if action.starts_with("MOVED") { "move" }
    else if action.starts_with("COPIED") || action == "FOLDER_COPIED" { "copy" }
    else if action == "TRASHED" || action == "FOLDER_TRASHED" { "del" }
    else if action == "ERROR" { "err" }
    else { "keep" }
}

fn render_html(report: &LogReport) -> String {
    let moved: usize = report.clusters.iter().map(|c| c.entries.iter().filter(|e| e.action.starts_with("MOVED") || (e.action.starts_with("COPIED") && e.action != "FOLDER_COPIED")).count()).sum();
    let removed: usize = report.clusters.iter().map(|c| c.entries.iter().filter(|e| e.action == "TRASHED").count()).sum();
    let bytes: u64 = report.clusters.iter().map(|c| c.entries.iter().filter(|e| e.action == "TRASHED").map(|e| e.size_bytes).sum::<u64>()).sum();
    let errors: usize = report.clusters.iter().map(|c| c.entries.iter().filter(|e| e.action == "ERROR").count()).sum();

    let mut rows = String::new();
    for cluster in &report.clusters {
        let others: String = cluster.other_folders.iter().map(|o| format!("<div class='path'>{}</div>", esc(o))).collect();
        rows.push_str(&format!(
            "<section class=\"cluster\"><h2>{}</h2><div class=\"meta\">\
             <div><span class=\"lbl\">Keep</span><div class=\"path\">{}</div></div>\
             <div><span class=\"lbl\">Merged &amp; cleaned</span>{}</div>\
             <div><span class=\"lbl\">Result</span><div class=\"path\">{}</div></div></div>\
             <table><thead><tr><th>Action</th><th>File</th><th>Size</th><th>From</th><th>To</th><th>Note</th></tr></thead><tbody>",
            esc(&cluster.result_name), esc(&cluster.keep_folder), others, esc(&cluster.result_path)
        ));
        for e in &cluster.entries {
            rows.push_str(&format!(
                "<tr class=\"{}\"><td class=\"action\">{}</td><td>{}</td><td class=\"num\">{}</td><td class=\"path\">{}</td><td class=\"path\">{}</td><td>{}</td></tr>",
                css_class(&e.action), esc(&e.action), esc(&e.file_name), byte_string(e.size_bytes), esc(&e.source_path), esc(&e.destination_path), esc(&e.note)
            ));
        }
        rows.push_str("</tbody></table></section>");
    }

    format!(
        "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>FileLister Operation Log</title><style>\
         :root{{color-scheme:light dark;}} body{{font:13px -apple-system,system-ui,sans-serif;margin:24px;color:#1d1d1f;}}\
         h1{{font-size:20px;margin:0 0 4px;}} .sub{{color:#6e6e73;margin-bottom:16px;}}\
         .summary{{display:flex;gap:24px;flex-wrap:wrap;background:#f5f5f7;padding:14px 18px;border-radius:10px;margin-bottom:22px;}}\
         .summary div b{{display:block;font-size:18px;}} .summary div span{{color:#6e6e73;font-size:11px;}}\
         section.cluster{{border:1px solid #e2e2e6;border-radius:10px;padding:14px 16px;margin-bottom:18px;}} h2{{font-size:15px;margin:0 0 10px;}}\
         .meta{{display:flex;gap:24px;flex-wrap:wrap;margin-bottom:12px;}} .meta .lbl{{display:block;font-size:10px;text-transform:uppercase;color:#8e8e93;}}\
         .path{{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#3a3a3c;word-break:break-all;}}\
         table{{width:100%;border-collapse:collapse;}} th,td{{text-align:left;padding:5px 8px;border-bottom:1px solid #ececf0;vertical-align:top;}}\
         th{{font-size:10px;text-transform:uppercase;color:#8e8e93;}} td.action{{font-weight:700;font-size:11px;white-space:nowrap;}}\
         tr.move td.action{{color:#0a84ff;}} tr.del td.action{{color:#ff3b30;}} tr.keep td.action{{color:#8e8e93;}} tr.copy td.action{{color:#34c759;}} tr.err td.action{{color:#ff9500;}}\
         @media(prefers-color-scheme:dark){{body{{color:#f5f5f7;}} .summary{{background:#1c1c1e;}} section.cluster{{border-color:#3a3a3c;}} .path{{color:#aeaeb2;}} th,td{{border-color:#2c2c2e;}}}}\
         </style></head><body><h1>FileLister — Operation Log</h1>\
         <div class=\"sub\">{} · {} · v{}</div>\
         <div class=\"summary\"><div><b>{}</b><span>cluster(s)</span></div><div><b>{}</b><span>files moved/copied</span></div>\
         <div><b>{}</b><span>removed</span></div><div><b>{}</b><span>space reclaimed</span></div><div><b>{}</b><span>error(s)</span></div></div>{}</body></html>",
        esc(&report.timestamp), esc(&report.mode), esc(&report.app_version),
        report.clusters.len(), moved, removed, byte_string(bytes), errors, rows
    )
}
