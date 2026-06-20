import { Icon } from "../icons";

export const CRITERIA = {
  resolution: { label: "Highest resolution", icon: "photo" },
  fileSize: { label: "Largest file size", icon: "drive" },
  newest: { label: "Newest (capture date)", icon: "sparkles" },
  oldest: { label: "Oldest (capture date)", icon: "sparkles" },
  preferRaw: { label: "Prefer RAW / original", icon: "photo" },
  hasGPS: { label: "Has GPS location", icon: "branch" },
};

export const DEFAULT_PRIORITY = ["resolution", "fileSize", "newest", "preferRaw", "hasGPS", "oldest"];

export function loadPriority() {
  try {
    const saved = JSON.parse(localStorage.getItem("photoBestCopyPriority"));
    if (Array.isArray(saved) && saved.length) {
      const missing = DEFAULT_PRIORITY.filter((c) => !saved.includes(c));
      return [...saved.filter((c) => CRITERIA[c]), ...missing];
    }
  } catch {}
  return DEFAULT_PRIORITY;
}

export function SettingsWindow({ priority, onChange, onClose }) {
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= priority.length) return;
    const next = [...priority];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" style={{ width: 460 }} onClick={(e) => e.stopPropagation()}>
        <h2>Photo Settings</h2>
        <div style={{ fontWeight: 700, fontSize: 13, marginTop: 6 }}>Best-copy priority</div>
        <p>When a group of similar photos is found, the keeper is chosen by these rules in order — the first rule that distinguishes two photos wins. Reorder with the arrows.</p>
        <div style={{ border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", marginTop: 8 }}>
          {priority.map((c, i) => (
            <div key={c} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderBottom: i < priority.length - 1 ? "1px solid var(--border)" : "none" }}>
              <span style={{ fontWeight: 700, color: "var(--secondary)", width: 16, fontSize: 11 }}>{i + 1}</span>
              <span style={{ color: "var(--indigo)" }}><Icon name={CRITERIA[c].icon} size={14} /></span>
              <span style={{ flex: 1, fontSize: 13 }}>{CRITERIA[c].label}</span>
              <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)}><Icon name="chevUp" size={13} /></button>
              <button className="icon-btn" disabled={i === priority.length - 1} onClick={() => move(i, 1)}><Icon name="chevDown" size={13} /></button>
            </div>
          ))}
        </div>
        <p style={{ marginTop: 10 }}>Applies on the next Photos search. Re-run a search to re-pick keepers with the new order.</p>
        <div className="sheet-row">
          <button className="btn-secondary" onClick={() => onChange(DEFAULT_PRIORITY)}>Reset</button>
          <button className="btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
