import { useState } from "react";
import { Icon } from "../icons";
import { formatBytes, baseName } from "../api";

function FolderCard({ group, selected, onSelect, onMerge, safeMerge }) {
  const [collapsed, setCollapsed] = useState(false);
  const keepName = baseName(group.folders[0]);
  const others = group.folders.slice(1);

  return (
    <div
      className={`folder-group ${selected === group.id ? "selected" : ""}`}
      onClick={() => onSelect(group.id)}
    >
      <div className="folder-head">
        <button
          className="icon-btn"
          style={{ color: "var(--indigo)" }}
          onClick={(e) => { e.stopPropagation(); setCollapsed(!collapsed); }}
        >
          <Icon name={collapsed ? "chevRight" : "chevDown"} size={11} />
        </button>
        <span style={{ color: "var(--indigo)" }}><Icon name="folderQ" size={13} /></span>
        <div className="folder-col">
          <span className="nm">{keepName}</span>
          <span className="pt">{group.folders[0]}</span>
        </div>
        <span style={{ color: "var(--secondary)" }}>⇄</span>
        <div className="folder-col">
          {others.length === 1 ? (
            <>
              <span className="nm">{baseName(others[0])}</span>
              <span className="pt">{others[0]}</span>
            </>
          ) : (
            <span className="nm" style={{ color: "var(--indigo)" }}>{others.length} other folders</span>
          )}
        </div>
        <span className="spacer" />
        <span className="match-pill" title={`${group.matched_groups.length} shared groups`}>
          {Math.round(group.match_ratio * 100)}% match
        </span>
      </div>
      {!collapsed && (
        <div className="folder-meta">
          <span>{group.matched_groups.length} shared files</span>
          {group.files_to_move.length > 0 && <span>{group.files_to_move.length} unique to merge</span>}
          <span style={{ fontWeight: 500 }}>{formatBytes(group.total_size_bytes)}</span>
          <span className="spacer" />
          <span className="saves-pill">
            <Icon name="drive" size={9} /> Saves {formatBytes(group.potential_savings)}
          </span>
          <button
            className="action-btn indigo"
            onClick={(e) => { e.stopPropagation(); safeMerge ? onMerge(group, true) : onMerge(group, false); }}
          >
            <Icon name={safeMerge ? "docDoc" : "merge"} size={11} />
            {safeMerge ? "Merge to New" : "Merge & Clean"}
          </button>
        </div>
      )}
    </div>
  );
}

export function FolderGroups({ groups, selected, onSelect, onMerge, safeMerge }) {
  return (
    <div className="group-list">
      {groups.map((g) => (
        <FolderCard key={g.id} group={g} selected={selected} onSelect={onSelect} onMerge={onMerge} safeMerge={safeMerge} />
      ))}
    </div>
  );
}

// Computes the DELETE / NO CHANGE / MOVE rows for the diff preview. Mirrors diffRows.
function diffRows(group) {
  const keep = group.folders[0];
  const moveIds = new Set(group.files_to_move.map((f) => f.id));
  const aKeys = new Set();
  const aNames = new Set();
  for (const mg of group.matched_groups) {
    const fA = mg.files.find((f) => f.path === keep);
    if (fA) { aKeys.add(`${fA.name}_${fA.size_bytes}`); aNames.add(fA.name); }
  }
  for (const f of group.unique_to_keep) { aKeys.add(`${f.name}_${f.size_bytes}`); aNames.add(f.name); }

  const rows = [];
  for (const mg of [...group.matched_groups].sort((a, b) => a.name.localeCompare(b.name))) {
    const keepCopy = mg.files.find((f) => f.path === keep);
    const moveRep = mg.files.find((f) => moveIds.has(f.id));
    const kept = keepCopy || moveRep;
    for (const f of mg.files) {
      if (f.path === keep) continue;
      if (moveIds.has(f.id)) continue;
      rows.push({ kind: "matched", a: kept || f, b: f });
    }
  }
  for (const f of [...group.unique_to_keep].sort((a, b) => a.name.localeCompare(b.name))) {
    rows.push({ kind: "uniqueA", f });
  }
  for (const f of [...group.files_to_move].sort((a, b) => a.name.localeCompare(b.name))) {
    const wouldDuplicate = aKeys.has(`${f.name}_${f.size_bytes}`);
    const renamed = !wouldDuplicate && aNames.has(f.name);
    rows.push({ kind: "uniqueB", f, wouldDuplicate, renamed });
  }
  return rows;
}

export function DiffSheet({ group, onMerge, onClose, safeMerge, walkthrough, progressLabel, onSkip, onApproveNext }) {
  const keepName = baseName(group.folders[0]);
  const others = group.folders.slice(1);
  const mergeName = others.length === 1 ? baseName(others[0]) : `${others.length} folders`;
  const rows = diffRows(group);

  const fileCell = (name, size, color, strike) => (
    <div className="diff-cell">
      <span className="fn" style={{ color: `var(--${color})` }}>
        <span className={strike ? "strike" : ""}>{name}</span>
      </span>
      <span className="fs" style={{ color: `var(--${color})` }}>{size}</span>
    </div>
  );
  const opCell = (label, color) => (
    <div className="diff-op" style={{ color: `var(--${color})` }}>
      <Icon name={label.includes("MOVE") ? "merge" : "x"} size={13} />
      <span className="lbl">{label}</span>
    </div>
  );

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet wide" onClick={(e) => e.stopPropagation()}>
        {walkthrough && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", background: "rgba(88,86,214,0.08)", borderBottom: "1px solid var(--border)" }}>
            <span style={{ color: "var(--indigo)" }}><Icon name="play" size={13} /></span>
            <span style={{ fontSize: 11, fontWeight: 700 }}>Reviewing folder clusters</span>
            <span className="spacer" />
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--indigo)" }}>{progressLabel}</span>
          </div>
        )}
        <div className="diff-head">
          <div className="side keep">
            <span className="nm" style={{ color: "var(--green-text)" }}>📁 {keepName}</span>
            <span className="lbl" style={{ color: "var(--green-text)" }}>KEEP</span>
          </div>
          <div className="ops">Operations</div>
          <div className="side merge">
            <span className="nm" style={{ color: "var(--red)" }}>📁 {mergeName}</span>
            <span className="lbl" style={{ color: "var(--red)" }}>MERGE &amp; CLEAN</span>
          </div>
        </div>
        <div className="diff-rows">
          {rows.map((r, i) => (
            <div className="diff-row" key={i}>
              {r.kind === "matched" && (
                <>
                  {fileCell(r.a.name, r.a.size, "orange", false)}
                  {opCell("DELETE", "red")}
                  {fileCell(r.b.name, r.b.size, "red", true)}
                </>
              )}
              {r.kind === "uniqueA" && (
                <>
                  {fileCell(r.f.name, r.f.size, "secondary", false)}
                  {opCell("NO CHANGE", "secondary")}
                  <div className="diff-cell" />
                </>
              )}
              {r.kind === "uniqueB" && (
                <>
                  <div className="diff-cell" />
                  {r.wouldDuplicate ? opCell("DELETE", "red") : r.renamed ? opCell("MOVE & RENAME", "orange") : opCell("MOVE", "blue")}
                  {fileCell(r.f.name, r.f.size, r.wouldDuplicate ? "red" : r.renamed ? "orange" : "blue", r.wouldDuplicate)}
                </>
              )}
            </div>
          ))}
        </div>
        <div className="diff-foot">
          <span className="info">
            {group.matched_groups.length} duplicate · {group.files_to_move.length} to move · {group.unique_to_keep.length} unchanged
          </span>
          {walkthrough ? (
            <>
              <button className="btn-secondary" onClick={onClose}>Cancel</button>
              <button className="btn-secondary" onClick={onSkip}><Icon name="chevRight" size={12} /> Skip</button>
              <button className="btn-primary indigo" onClick={onApproveNext}>
                <Icon name="merge" size={13} /> {safeMerge ? "Copy & Next" : "Merge & Next"}
              </button>
            </>
          ) : (
            <>
              <button className="btn-secondary" onClick={onClose}>Close</button>
              <button className="btn-primary indigo" onClick={onMerge}>
                <Icon name="merge" size={13} /> {safeMerge ? "Merge to New" : "Merge & Clean"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
