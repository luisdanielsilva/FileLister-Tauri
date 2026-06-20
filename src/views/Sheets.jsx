import { useState } from "react";
import { formatBytes } from "../api";

export function CleanAllSheet({ count, bytes, onClean, onCancel }) {
  return (
    <div className="overlay" onClick={onCancel}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2>Clean All Duplicates?</h2>
        <div className="stat-line"><span>Files to move to Trash</span><span className="big-num red">{count}</span></div>
        <div className="stat-line"><span>Space to recover</span><span className="big-num green">{formatBytes(bytes)}</span></div>
        <p>
          One verified copy of every file is preserved. Duplicates are moved to the system Trash
          (recoverable), not permanently deleted. Each file is byte-for-byte verified before removal.
        </p>
        <div className="sheet-row">
          <button className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn-primary danger" onClick={onClean}>Move {count} to Trash</button>
        </div>
      </div>
    </div>
  );
}

export function MergeSheet({ group, safeMerge, onMerge, onCancel }) {
  const removable = group.matched_groups.reduce((s, g) => s + Math.max(0, g.files.length - 1), 0);
  return (
    <div className="overlay" onClick={onCancel}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2>{safeMerge ? "Copy Merged Result to New Folder?" : "Merge & Clean Folder Cluster?"}</h2>
        <div className="stat-line"><span>Unique files moved into keep</span><span className="big-num">{group.files_to_move.length}</span></div>
        <div className="stat-line"><span>Duplicate copies removed</span><span className="big-num red">{removable}</span></div>
        <div className="stat-line"><span>Space recovered</span><span className="big-num green">{formatBytes(group.potential_savings)}</span></div>
        <p>
          {safeMerge
            ? "Originals are left untouched. The merged result is written into the destination folder you chose."
            : "Other folders in the cluster are moved to Trash after their unique files are merged into the keep folder. Recoverable from Trash."}
        </p>
        <div className="sheet-row">
          <button className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn-primary indigo" onClick={onMerge}>{safeMerge ? "Create Merged Copy" : "Merge & Clean"}</button>
        </div>
      </div>
    </div>
  );
}

export function MergeAllSheet({ groups, safeMerge, onMergeAll, onCancel }) {
  const totalSavings = groups.reduce((s, g) => s + g.potential_savings, 0);
  return (
    <div className="overlay" onClick={onCancel}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2>{safeMerge ? "Merge All Clusters to New Folders?" : "Merge All Folder Clusters?"}</h2>
        <div className="stat-line"><span>Clusters to merge</span><span className="big-num">{groups.length}</span></div>
        <div className="stat-line"><span>Total space recovered</span><span className="big-num green">{formatBytes(totalSavings)}</span></div>
        <p>
          {safeMerge
            ? "One merged subfolder is created per cluster in your destination. Originals untouched."
            : "Each cluster's other folders are moved to Trash after merging. Recoverable from Trash."}
        </p>
        <div className="sheet-row">
          <button className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn-primary indigo" onClick={onMergeAll}>Merge {groups.length} Cluster(s)</button>
        </div>
      </div>
    </div>
  );
}

export function PhotoDeleteSheet({ count, bytes, onConfirm, onCancel, all }) {
  return (
    <div className="overlay" onClick={onCancel}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2>{all ? "Delete All Non-Keepers?" : "Delete Other Photos in Group?"}</h2>
        <div className="stat-line"><span>Photos to move to Trash</span><span className="big-num red">{count}</span></div>
        <div className="stat-line"><span>Space to recover</span><span className="big-num green">{formatBytes(bytes)}</span></div>
        <p>The best copy (keeper) in each group is preserved. The rest move to the system Trash, recoverable later.</p>
        <div className="sheet-row">
          <button className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn-primary danger" onClick={onConfirm}>Move {count} to Trash</button>
        </div>
      </div>
    </div>
  );
}

export function LicenseSheet({ onValidate, onClose, registered, registeredName, onDeactivate }) {
  const [key, setKey] = useState("");
  const [error, setError] = useState("");

  async function submit() {
    const ok = await onValidate(key.trim());
    if (!ok) setError("Invalid license key. Check the format: XXXX-XXXX-XXXX-XXXX-XXXX-XXXX");
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2>License Key</h2>
        {registered ? (
          <>
            <p>Licensed to <b>{registeredName}</b>. Thank you for supporting FileLister.</p>
            <div className="sheet-row">
              <button className="btn-secondary" onClick={onDeactivate}>Deactivate</button>
              <button className="btn-primary" onClick={onClose}>Done</button>
            </div>
          </>
        ) : (
          <>
            <p>Enter your license key to unlock unlimited deletions. The trial allows 15 deletions.</p>
            <input
              type="text"
              value={key}
              placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
              onChange={(e) => { setKey(e.target.value.toUpperCase()); setError(""); }}
            />
            {error && <p style={{ color: "var(--red)" }}>{error}</p>}
            <div className="sheet-row">
              <button className="btn-secondary" onClick={onClose}>Cancel</button>
              <button className="btn-primary" onClick={submit}>Register</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function RegisterAlert({ onClose }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2>Registration Required</h2>
        <p>You have reached the trial limit (15 deletions) or attempted a premium action. Register to unlock unlimited access.</p>
        <div className="sheet-row">
          <button className="btn-primary" onClick={onClose}>OK</button>
        </div>
      </div>
    </div>
  );
}
