import { useState } from "react";
import { Icon } from "../icons";

const SECTIONS = [
  { id: "welcome", label: "Welcome to FileLister", icon: "shield" },
  { id: "files", label: "Files at a Glance", icon: "doc" },
  { id: "folders", label: "Folder Duplicates & Merging", icon: "folderQ" },
  { id: "photos", label: "Duplicate Photos", icon: "photo" },
];

function Feature({ icon, color, title, body }) {
  return (
    <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
      <span style={{ color: `var(--${color})`, marginTop: 1 }}><Icon name={icon} size={18} /></span>
      <div>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{title}</div>
        <div style={{ fontSize: 12, color: "var(--secondary)", lineHeight: 1.45 }}>{body}</div>
      </div>
    </div>
  );
}

export function HelpWindow({ onClose }) {
  const [section, setSection] = useState("welcome");

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" style={{ width: 820, height: 600, padding: 0, display: "flex", flexDirection: "row" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ width: 230, borderRight: "1px solid var(--border)", padding: 12, overflowY: "auto" }}>
          <div style={{ fontWeight: 700, fontSize: 14, padding: "4px 8px 10px" }}>Help</div>
          {SECTIONS.map((s) => (
            <button key={s.id} className={`section-head`} style={{ background: section === s.id ? "rgba(0,122,255,0.12)" : "transparent", marginTop: 2 }} onClick={() => setSection(s.id)}>
              <Icon name={s.icon} size={13} /> {s.label}
            </button>
          ))}
        </div>
        <div style={{ flex: 1, padding: 28, overflowY: "auto" }}>
          {section === "welcome" && (
            <>
              <h2 style={{ fontSize: 22 }}>Welcome to FileLister</h2>
              <p style={{ marginBottom: 18 }}>FileLister scans any folder and finds duplicate <b>files</b>, duplicate <b>folders</b>, and visually similar <b>photos</b>. All processing is on-device — nothing leaves your machine. Built with Tauri to run identically on macOS and Windows.</p>
              <Feature icon="shield" color="indigo" title="Deep Scan (SHA-256)" body="Byte-level content comparison ensures zero false positives — matches go beyond filename and size." />
              <Feature icon="trash" color="red" title="Safe deletion" body="Files move to the system Trash, never permanently deleted. One copy per group is always locked." />
              <Feature icon="play" color="green" title="Undo" body="Press ⌘Z (Ctrl+Z on Windows) right after a delete or merge to restore from Trash." />
              <Feature icon="sparkles" color="orange" title="Space recovery tracking" body="The status bar shows potential savings and space actually freed this session." />
            </>
          )}
          {section === "files" && (
            <>
              <h2>Files mode</h2>
              <p style={{ marginBottom: 18 }}>Finds files with identical content. Add one or more folders, then press <b>Search for Duplicates</b>.</p>
              <Feature icon="shield" color="indigo" title="Deep Scan" body="Verifies candidate duplicates with SHA-256 hashing." />
              <Feature icon="photo" color="orange" title="Media / No Hidden / Symlinks" body="Restrict to media files, skip dotfiles, or detect symlinks pointing at the same target." />
              <Feature icon="check" color="green" title="Confidence scoring" body="Each group gets a % score from five signals (folder similarity, naming, timestamps, path proximity, copy count)." />
              <Feature icon="trash" color="red" title="Clean All Duplicates" body="Batch-removes every redundant copy after a byte-for-byte safety re-check. Requires a license." />
            </>
          )}
          {section === "folders" && (
            <>
              <h2>Folder Duplicates & Merging</h2>
              <p style={{ marginBottom: 18 }}>Detects folders whose contents largely overlap and merges them safely.</p>
              <Feature icon="folderQ" color="indigo" title="Match threshold" body="Two folders cluster when their shared-content ratio meets the slider value (default 75%)." />
              <Feature icon="merge" color="indigo" title="Merge & Clean" body="Moves unique files into the keep folder, then trashes the others. Preview the exact plan first." />
              <Feature icon="docDoc" color="green" title="Copy to new folder" body="Non-destructive: writes the merged result into a new folder and leaves all originals untouched." />
              <Feature icon="play" color="indigo" title="Review One-by-One" body="Step through each cluster and approve or skip individually before anything changes." />
            </>
          )}
          {section === "photos" && (
            <>
              <h2>Duplicate Photos</h2>
              <p style={{ marginBottom: 18 }}>Finds visually similar photos using perceptual hashing (dHash + pHash), even across resolutions and re-encodes.</p>
              <Feature icon="photo" color="indigo" title="Similarity slider" body="Lower it to group looser matches; raise it for near-identical only." />
              <Feature icon="shield" color="orange" title="EXIF corroboration" body="Optionally require a metadata match (capture time, or camera + dimensions) before grouping." />
              <Feature icon="check" color="green" title="Best-copy keeper" body="The keeper is chosen by a configurable priority (Settings → Photos). Override per group with “Keep this”." />
              <Feature icon="upload" color="green" title="Export keepers" body="Copy just the keepers to a new folder, preserving the original structure. Originals untouched." />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
