import { useState, useEffect } from "react";
import { Icon } from "../icons";
import { api, formatBytes } from "../api";

function summarize(report) {
  let moved = 0, removed = 0, bytes = 0, errors = 0;
  for (const c of report.clusters) {
    for (const e of c.entries) {
      if (e.action.startsWith("MOVED") || (e.action.startsWith("COPIED") && e.action !== "FOLDER_COPIED")) moved++;
      if (e.action === "TRASHED") { removed++; bytes += e.size_bytes; }
      if (e.action === "ERROR") errors++;
    }
  }
  return { moved, removed, bytes, errors };
}

function actionColor(a) {
  if (a.startsWith("MOVED")) return "blue";
  if (a.startsWith("COPIED") || a === "FOLDER_COPIED") return "green-text";
  if (a === "TRASHED" || a === "FOLDER_TRASHED") return "red";
  if (a === "ERROR") return "orange";
  return "secondary";
}

export function HistoryWindow({ onClose }) {
  const [records, setRecords] = useState([]);
  const [sel, setSel] = useState(0);

  useEffect(() => {
    api.listLogs().then((r) => setRecords(r || [])).catch(() => setRecords([]));
  }, []);

  const current = records[sel];

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" style={{ width: 880, height: 600, padding: 0, display: "flex", flexDirection: "row" }} onClick={(e) => e.stopPropagation()}>
        {/* sidebar */}
        <div style={{ width: 300, borderRight: "1px solid var(--border)", overflowY: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
            <span style={{ fontWeight: 700, fontSize: 14, flex: 1 }}>Operation History</span>
            <button className="icon-btn" title="Refresh" onClick={() => api.listLogs().then((r) => setRecords(r || []))}><Icon name="chevDown" size={13} /></button>
          </div>
          {records.length === 0 && (
            <div style={{ padding: 30, textAlign: "center", color: "var(--secondary)" }}>
              <Icon name="play" size={32} /><div style={{ marginTop: 8, fontSize: 12 }}>No operation logs yet.</div>
              <div style={{ fontSize: 11 }}>Deletes, merges and exports write a report here.</div>
            </div>
          )}
          {records.map((rec, i) => {
            const s = summarize(rec.report);
            return (
              <div key={rec.json_path} onClick={() => setSel(i)}
                style={{ padding: "8px 14px", cursor: "default", background: i === sel ? "rgba(0,122,255,0.1)" : "transparent", borderBottom: "1px solid var(--border)" }}>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{new Date(rec.report.timestamp).toLocaleString()}</div>
                <div style={{ fontSize: 10, color: "var(--secondary)" }}>{rec.report.mode}</div>
                <div style={{ display: "flex", gap: 6, marginTop: 3 }}>
                  {s.removed > 0 && <span className="tag match-high" style={{ color: "var(--red)", background: "rgba(255,59,48,0.12)" }}>{s.removed} removed</span>}
                  {s.moved > 0 && <span className="tag" style={{ color: "var(--blue)", background: "rgba(0,122,255,0.12)" }}>{s.moved} moved/copied</span>}
                  {s.bytes > 0 && <span className="tag" style={{ color: "var(--green-text)", background: "rgba(40,200,64,0.12)" }}>{formatBytes(s.bytes)}</span>}
                </div>
              </div>
            );
          })}
        </div>
        {/* detail */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          {current ? (
            <>
              <div style={{ padding: 16, borderBottom: "1px solid var(--border)" }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{current.report.mode}</div>
                <div style={{ fontSize: 12, color: "var(--secondary)" }}>{new Date(current.report.timestamp).toLocaleString()} · v{current.report.app_version}</div>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button className="btn-bordered" onClick={() => api.openFolder(current.json_path.replace(/\.json$/, ".html"))}><Icon name="reveal" size={11} /> Open HTML</button>
                  <button className="btn-bordered" onClick={() => api.openFolder(current.json_path.replace(/\.json$/, ".pdf"))}><Icon name="doc" size={11} /> Open PDF</button>
                  <button className="btn-bordered" onClick={() => api.revealInFinder(current.json_path)}><Icon name="folder" size={11} /> Reveal</button>
                  <span style={{ flex: 1 }} />
                  <button className="btn-bordered" onClick={onClose}>Close</button>
                </div>
                <div style={{ fontSize: 11, color: "var(--secondary)", marginTop: 8 }}>
                  To recover deleted items: restore them from the Trash (paths listed below), or press ⌘Z right after an operation.
                </div>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
                {current.report.clusters.map((c, ci) => (
                  <div key={ci} style={{ background: "rgba(120,120,128,0.06)", borderRadius: 6, padding: 10, marginBottom: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>{c.result_name}</div>
                    {c.entries.map((e, ei) => (
                      <div key={ei} style={{ padding: "3px 0", borderBottom: "1px solid var(--border)" }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <span style={{ width: 110, fontSize: 9, fontWeight: 700, color: `var(--${actionColor(e.action)})` }}>{e.action}</span>
                          <span style={{ fontSize: 11, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.file_name}</span>
                          {e.size_bytes > 0 && <span style={{ fontSize: 9, color: "var(--secondary)" }}>{formatBytes(e.size_bytes)}</span>}
                        </div>
                        <div className="mono" style={{ fontSize: 9, color: "var(--secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>from: {e.source_path}</div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="empty"><span className="sub">Select an operation</span></div>
          )}
        </div>
      </div>
    </div>
  );
}
