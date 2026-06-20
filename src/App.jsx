import { useState, useEffect, useCallback, useRef } from "react";
import { api, onProgress, pickFolders, pickDestination, formatBytes, baseName } from "./api";
import { Icon } from "./icons";
import { FileGroups } from "./views/FileGroups";
import { FolderGroups, DiffSheet } from "./views/FolderGroups";
import { PhotoGroups } from "./views/PhotoGroups";
import {
  CleanAllSheet, MergeSheet, MergeAllSheet, PhotoDeleteSheet, LicenseSheet, RegisterAlert,
} from "./views/Sheets";
import { HelpWindow } from "./views/Help";
import { SettingsWindow, loadPriority } from "./views/Settings";
import { HistoryWindow } from "./views/History";
import { Preview } from "./views/Preview";
import { computeSections, filePaths, folderPaths } from "./sections";
import "./styles.css";

const MODES = [
  { id: "files", label: "Files", icon: "doc" },
  { id: "folders", label: "Folders", icon: "folderQ" },
  { id: "photos", label: "Photos", icon: "photo" },
];
const TRIAL_LIMIT = 15;

export default function App() {
  const [mode, setMode] = useState("files");
  const [foldersByMode, setFoldersByMode] = useState({ files: [], folders: [], photos: [] });
  const [scanScope, setScanScope] = useState("combined");

  const [fileOpts, setFileOpts] = useState({ deep: false, mediaOnly: false, skipHidden: false, detectSymlinks: false });
  const [folderOpts, setFolderOpts] = useState({ mediaOnly: false, skipHidden: false, threshold: 0.75 });
  const [photoOpts, setPhotoOpts] = useState({ threshold: 0.9, requireExif: false, expandMetadata: false, expandTime: true, expandGps: false, expandCamera: false });
  const [photoPriority, setPhotoPriority] = useState(loadPriority());

  const [fileGroups, setFileGroups] = useState([]);
  const [folderGroups, setFolderGroups] = useState([]);
  const [photoGroups, setPhotoGroups] = useState([]);
  const [searchedModes, setSearchedModes] = useState(new Set());

  const [deletedPaths, setDeletedPaths] = useState(new Set());
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ progress: 0, status: "Ready to start", phase: 0, total_phases: 1 });
  const [status, setStatus] = useState("");

  const [sort, setSort] = useState({ criteria: "name", order: "ascending" });
  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedFilePath, setSelectedFilePath] = useState(null);
  const [selectedFolderId, setSelectedFolderId] = useState(null);
  const [selectedPhotoId, setSelectedPhotoId] = useState(null);

  const [license, setLicense] = useState({ registered: false, name: "Trial Version", trial: 0 });
  const [sizeFilter, setSizeFilter] = useState({ min: "", max: "", unit: "MB" });
  const [potentialSavings, setPotentialSavings] = useState(0);
  const [recovered, setRecovered] = useState(0);
  const [lastLogPath, setLastLogPath] = useState(null);

  const [safeMerge, setSafeMerge] = useState(false);
  const [safeMergeDest, setSafeMergeDest] = useState(null);
  const [renameKept, setRenameKept] = useState(false);

  const [undoStack, setUndoStack] = useState([]);
  const [walk, setWalk] = useState(null); // { queue, index, approved:Set }
  const [previewPath, setPreviewPath] = useState(null);
  const [dialog, setDialog] = useState(null);

  const folders = foldersByMode[mode];
  const setFolders = (list) => setFoldersByMode((m) => ({ ...m, [mode]: list }));

  useEffect(() => {
    const un = onProgress((p) => setProgress(p));
    return () => { un.then((f) => f()); };
  }, []);

  useEffect(() => {
    setLicense({
      registered: localStorage.getItem("FileLister_IsRegistered") === "true",
      name: localStorage.getItem("FileLister_RegisteredName") || "Trial Version",
      trial: parseInt(localStorage.getItem("FileLister_TrialDeletions") || "0", 10),
    });
  }, []);

  useEffect(() => { localStorage.setItem("photoBestCopyPriority", JSON.stringify(photoPriority)); }, [photoPriority]);

  // ── undo ──
  const pushUndo = (op) => setUndoStack((s) => [...s, op]);
  const undoRef = useRef();
  const undoLast = useCallback(async () => {
    setUndoStack((stack) => {
      const op = stack[stack.length - 1];
      if (!op) { setStatus("Nothing to undo."); return stack; }
      api.undoOp(op.trashed || [], op.created || []).then((restored) => {
        setDeletedPaths((d) => { const n = new Set(d); (restored || []).forEach((p) => n.delete(p)); return n; });
        const parts = [];
        if (restored?.length) parts.push(`restored ${restored.length}`);
        if (op.created?.length) parts.push(`removed ${op.created.length} created`);
        setStatus(`Undo "${op.title}": ${parts.join(" · ") || "nothing to do"}`);
      });
      return stack.slice(0, -1);
    });
  }, []);
  undoRef.current = undoLast;

  // ── keyboard: ⌘Z / Ctrl+Z undo, Space preview ──
  useEffect(() => {
    const onKey = (e) => {
      const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !typing) {
        e.preventDefault();
        undoRef.current();
        return;
      }
      if (e.code === "Space" && !typing && !dialog && !walk) {
        let path = null;
        if (mode === "files") path = selectedFilePath;
        else if (mode === "photos" && selectedPhotoId) {
          const p = photoGroups.flatMap((g) => g.photos).find((x) => x.id === selectedPhotoId);
          path = p?.full_path;
        }
        if (path) { e.preventDefault(); setPreviewPath((cur) => (cur ? null : path)); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, selectedFilePath, selectedPhotoId, photoGroups, dialog, walk]);

  const unitBytes = { KB: 1024, MB: 1048576, GB: 1073741824 };
  const sizeActive = sizeFilter.min !== "" || sizeFilter.max !== "";
  const sizeContains = (sz) => {
    const u = unitBytes[sizeFilter.unit];
    const lo = sizeFilter.min ? parseInt(sizeFilter.min, 10) * u : 0;
    const hi = sizeFilter.max ? parseInt(sizeFilter.max, 10) * u : 0;
    return (lo === 0 || sz >= lo) && (hi === 0 || sz <= hi);
  };

  const sortGroups = useCallback((groups, isFolder) => {
    const arr = [...groups];
    arr.sort((a, b) => {
      let r;
      if (isFolder) {
        switch (sort.criteria) {
          case "size": r = a.total_size_bytes - b.total_size_bytes; break;
          case "count": r = a.matched_groups.length - b.matched_groups.length; break;
          case "matchRatio": r = a.match_ratio - b.match_ratio; break;
          default: r = baseName(a.folders[0]).localeCompare(baseName(b.folders[0]));
        }
      } else {
        if (mode === "files" && fileOpts.detectSymlinks && a.is_symlink_group !== b.is_symlink_group) {
          return a.is_symlink_group ? -1 : 1;
        }
        switch (sort.criteria) {
          case "size": r = a.size_bytes - b.size_bytes; break;
          case "count": {
            const ca = a.files.filter((f) => !deletedPaths.has(f.full_path)).length;
            const cb = b.files.filter((f) => !deletedPaths.has(f.full_path)).length;
            r = ca - cb; break;
          }
          case "matchRatio": r = (a.confidence?.overall || 0) - (b.confidence?.overall || 0); break;
          default: r = a.name.localeCompare(b.name);
        }
      }
      return sort.order === "ascending" ? r : -r;
    });
    return arr;
  }, [sort, mode, fileOpts.detectSymlinks, deletedPaths]);

  const toggleSort = (criteria) => {
    setSort((s) => s.criteria === criteria
      ? { criteria, order: s.order === "ascending" ? "descending" : "ascending" }
      : { criteria, order: "descending" });
  };

  let displayedFileGroups = fileGroups;
  if (sizeActive) displayedFileGroups = displayedFileGroups.filter((g) => sizeContains(g.size_bytes));
  displayedFileGroups = sortGroups(displayedFileGroups, false);
  const displayedFolderGroups = sortGroups(folderGroups, true);

  const activeCount = (g) => g.files.filter((f) => !deletedPaths.has(f.full_path)).length;
  const hasRemovable = displayedFileGroups.some((g) => activeCount(g) > 1);
  const cleanComposition = () => {
    let count = 0, bytes = 0;
    for (const g of displayedFileGroups) {
      const a = activeCount(g);
      if (a > 1) { count += a - 1; bytes += g.size_bytes * (a - 1); }
    }
    return { count, bytes };
  };

  const startScanning = async () => {
    if (scanning) { api.stopScan(); return; }
    if (folders.length === 0) return;
    setScanning(true);
    setSearchedModes((s) => new Set(s).add(mode));
    setProgress({ progress: 0, status: "Counting files...", phase: 0, total_phases: 1 });
    try {
      if (mode === "files") {
        const res = await api.scanFiles(folders, scanScope === "perFolder", fileOpts.deep, fileOpts.mediaOnly, fileOpts.skipHidden, fileOpts.detectSymlinks);
        setFileGroups(res.groups);
        setPotentialSavings(res.total_potential_savings);
        setStatus(res.stopped ? "Scan stopped." : `Completed! ${res.groups.length} groups found.`);
      } else if (mode === "folders") {
        const res = await api.scanFolders(folders, scanScope === "perFolder", folderOpts.mediaOnly, folderOpts.skipHidden, folderOpts.threshold);
        setFolderGroups(res.folder_groups);
        setStatus(res.stopped ? "Scan stopped." : `Completed! ${res.folder_groups.length} clusters found.`);
      } else {
        const res = await api.scanPhotos(folders, photoOpts.threshold, photoOpts.requireExif, photoOpts.expandMetadata, photoOpts.expandTime, photoOpts.expandGps, photoOpts.expandCamera, photoPriority);
        setPhotoGroups(res.groups);
        const dupes = res.groups.reduce((s, g) => s + g.photos.length - 1, 0);
        setStatus(res.stopped ? "Scan stopped." : `Found ${res.groups.length} similar group(s) · ${dupes} removable photo(s).`);
      }
    } catch (e) {
      setStatus(`Error: ${e}`);
    } finally {
      setScanning(false);
    }
  };

  const addFolders = async () => {
    const picked = await pickFolders(true);
    if (picked.length) setFolders([...new Set([...folders, ...picked])]);
  };
  const removeFolder = (f) => setFolders(folders.filter((x) => x !== f));

  const recordDeletion = () => {
    if (!license.registered) {
      const n = license.trial + 1;
      localStorage.setItem("FileLister_TrialDeletions", String(n));
      setLicense((l) => ({ ...l, trial: n }));
    }
  };
  const canDelete = () => license.registered || license.trial < TRIAL_LIMIT;

  const selectFile = (file) => { setSelectedFile(file.id); setSelectedFilePath(file.full_path); };

  const deleteFile = async (group, file) => {
    if (!canDelete()) { setDialog({ type: "register" }); return; }
    const ref = group.files.find((f) => f.full_path !== file.full_path && !deletedPaths.has(f.full_path));
    if (!ref) { setStatus("Security Error: No active original file found!"); return; }
    setStatus("Verifying binary identity...");
    try {
      const log = await api.deleteSingle(file.full_path, ref.full_path, file.is_symlink || group.is_symlink_group, file.name, group.size_bytes);
      setDeletedPaths((d) => new Set(d).add(file.full_path));
      setRecovered((r) => r + group.size_bytes);
      recordDeletion();
      pushUndo({ title: `Delete ${file.name}`, trashed: [file.full_path] });
      if (log) setLastLogPath(log);
      setStatus("Security Verified! Moved to Trash.");
    } catch (e) {
      setStatus(String(e));
    }
  };

  const cleanAll = () => {
    if (!license.registered) { setDialog({ type: "register" }); return; }
    setDialog({ type: "cleanAll", ...cleanComposition() });
  };
  const doCleanAll = async () => {
    setDialog(null);
    setStatus("Verifying batch integrity...");
    try {
      const res = await api.cleanAll(displayedFileGroups, [...deletedPaths]);
      if (res.trashed.length === 0) {
        setStatus(res.skipped > 0 ? `Alert: ${res.skipped} files differ and were skipped.` : "No duplicates to clean.");
        return;
      }
      setDeletedPaths((d) => { const n = new Set(d); res.trashed.forEach((p) => n.add(p)); return n; });
      setRecovered((r) => r + res.bytes);
      pushUndo({ title: `Clean ${res.trashed.length} duplicate(s)`, trashed: res.trashed });
      if (res.log_path) setLastLogPath(res.log_path);
      const skip = res.skipped > 0 ? ` (${res.skipped} skipped for safety)` : "";
      setStatus(`Security Verified! ${res.trashed.length} files moved to Trash${skip}.`);
    } catch (e) {
      setStatus(String(e));
    }
  };

  const computeMergedName = (group) => `${baseName(group.folders[0])} merged`;
  const onMergeFolder = (group) => setDialog({ type: "diff", group });
  const confirmMergeFolder = (group) => setDialog({ type: "merge", group });

  const runMerge = async (group) => {
    if (safeMerge) {
      let parent = safeMergeDest;
      if (!parent) { parent = await pickDestination(); if (!parent) return null; setSafeMergeDest(parent); }
      const dest = `${parent}/${computeMergedName(group)}`;
      const res = await api.safeMerge(group, dest);
      if (res.log_path) setLastLogPath(res.log_path);
      pushUndo({ title: `Copy merge → ${res.result_name}`, created: [res.created] });
      setRecovered((r) => r);
      return `Merged copy created → "${res.result_name}". Originals untouched.`;
    }
    const res = await api.mergeFolder(group, renameKept, computeMergedName(group));
    setFolderGroups((gs) => gs.filter((g) => g.id !== group.id));
    setDeletedPaths((d) => { const n = new Set(d); res.trashed.forEach((p) => n.add(p)); return n; });
    setRecovered((r) => r + res.recovered_bytes);
    if (res.log_path) setLastLogPath(res.log_path);
    pushUndo({ title: `Merge ${res.result_name}`, trashed: res.trashed });
    return res.errors === 0 ? `Merge complete → "${res.result_name}".` : `Merge done with ${res.errors} error(s).`;
  };

  const executeMerge = async (group) => {
    setDialog(null);
    try { const msg = await runMerge(group); if (msg) setStatus(msg); }
    catch (e) { setStatus(String(e)); }
  };

  const mergeAll = () => setDialog({ type: "mergeAll", groups: displayedFolderGroups });
  const executeMergeAll = async () => {
    const groups = [...displayedFolderGroups];
    setDialog(null);
    try {
      let n = 0;
      for (const g of groups) { await runMerge(g); n++; }
      setStatus(`Processed ${n} folder cluster(s).`);
    } catch (e) { setStatus(String(e)); }
  };

  const onToggleSafeMerge = async (on) => {
    setSafeMerge(on);
    if (on) { const dest = await pickDestination(); if (dest) setSafeMergeDest(dest); else setSafeMerge(false); }
    else setSafeMergeDest(null);
  };

  // ── Review One-by-One walkthrough ──
  const startWalkthrough = () => {
    if (displayedFolderGroups.length === 0) return;
    setWalk({ queue: [...displayedFolderGroups], index: 0, approved: new Set() });
  };
  const walkAdvance = (approveCurrent) => {
    setWalk((w) => {
      if (!w) return w;
      const approved = new Set(w.approved);
      if (approveCurrent) approved.add(w.queue[w.index].id);
      const next = w.index + 1;
      if (next >= w.queue.length) { finishWalkthrough(w.queue, approved); return null; }
      return { ...w, index: next, approved };
    });
  };
  const finishWalkthrough = async (queue, approved) => {
    const groups = queue.filter((g) => approved.has(g.id));
    if (groups.length === 0) { setStatus("Review finished — nothing approved."); return; }
    try { for (const g of groups) await runMerge(g); setStatus(`Merged ${groups.length} approved cluster(s).`); }
    catch (e) { setStatus(String(e)); }
  };

  const setKeeper = (groupId, photoId) =>
    setPhotoGroups((gs) => gs.map((g) => g.id === groupId
      ? { ...g, keeper_id: photoId, reclaimable_bytes: g.photos.filter((p) => p.id !== photoId).reduce((s, p) => s + p.size_bytes, 0) }
      : g));

  const deletePhotoOthers = (group) => {
    const targets = group.photos.filter((p) => p.id !== group.keeper_id && !deletedPaths.has(p.full_path));
    const bytes = targets.reduce((s, p) => s + p.size_bytes, 0);
    setDialog({ type: "photoDelete", count: targets.length, bytes, all: false, run: () => doDeletePhotos([group]) });
  };
  const deleteAllPhotos = () => {
    const targets = photoGroups.flatMap((g) => g.photos.filter((p) => p.id !== g.keeper_id && !deletedPaths.has(p.full_path)));
    const bytes = targets.reduce((s, p) => s + p.size_bytes, 0);
    setDialog({ type: "photoDelete", count: targets.length, bytes, all: true, run: () => doDeletePhotos(photoGroups) });
  };
  const doDeletePhotos = async (groups) => {
    setDialog(null);
    const targets = groups.flatMap((g) => g.photos.filter((p) => p.id !== g.keeper_id && !deletedPaths.has(p.full_path)));
    if (targets.length === 0) return;
    const keeperName = groups[0]?.photos.find((p) => p.id === groups[0].keeper_id)?.name || "keeper";
    try {
      const log = await api.deletePhotos(targets, keeperName);
      setDeletedPaths((d) => { const n = new Set(d); targets.forEach((p) => n.add(p.full_path)); return n; });
      setRecovered((r) => r + targets.reduce((s, p) => s + p.size_bytes, 0));
      pushUndo({ title: `Delete ${targets.length} photo(s)`, trashed: targets.map((p) => p.full_path) });
      if (log) setLastLogPath(log);
      setStatus(`Moved ${targets.length} photo(s) to Trash.`);
    } catch (e) { setStatus(String(e)); }
  };
  const exportKeepers = async () => {
    const dest = await pickDestination();
    if (!dest) return;
    const keepers = photoGroups.map((g) => g.photos.find((p) => p.id === g.keeper_id)).filter(Boolean);
    try {
      const res = await api.exportKeepers(keepers, dest, folders);
      if (res.log_path) setLastLogPath(res.log_path);
      pushUndo({ title: `Export ${res.copied} keeper(s)`, created: res.created });
      setStatus(`Copied ${res.copied} keeper(s) to "${baseName(dest)}". Originals untouched.`);
    } catch (e) { setStatus(String(e)); }
  };

  const validateLicense = async (key) => {
    const ok = await api.validateLicense(key);
    if (ok) {
      localStorage.setItem("FileLister_IsRegistered", "true");
      localStorage.setItem("FileLister_RegisteredName", "Registered User");
      setLicense((l) => ({ ...l, registered: true, name: "Registered User" }));
      setDialog(null);
    }
    return ok;
  };
  const deactivate = () => {
    localStorage.setItem("FileLister_IsRegistered", "false");
    setLicense((l) => ({ ...l, registered: false, name: "Trial Version" }));
    setDialog(null);
  };

  const barStatus = searchedModes.has(mode) ? status : "";
  const statusColor = scanning ? "var(--green)"
    : barStatus.includes("Error") || barStatus.includes("failed") ? "var(--red)"
    : barStatus.includes("Completed") || barStatus.includes("Trash") ? "var(--blue)" : "var(--gray)";

  const overallProgress = (progress.phase + progress.progress) / Math.max(1, progress.total_phases);
  const showStats = mode !== "photos" && searchedModes.has(mode) && (potentialSavings > 0 || recovered > 0);
  const hasResults = mode === "files" ? fileGroups.length > 0 : mode === "folders" ? folderGroups.length > 0 : photoGroups.length > 0;

  return (
    <div className="app">
      <div className="topbar">
        <div className="segmented">
          {MODES.map((m) => (
            <button key={m.id} className={mode === m.id ? "active" : ""} disabled={scanning}
              onClick={() => { setMode(m.id); setSelectedFolderId(null); setSelectedFile(null); }}>
              <Icon name={m.icon} size={13} /> {m.label}
            </button>
          ))}
        </div>
        <div className="segmented">
          <button className="active"><Icon name="drive" size={13} /> Local</button>
        </div>
        <span className="spacer" />
        <button className="btn-bordered" disabled={undoStack.length === 0} onClick={undoLast} title="Undo last operation (⌘Z)"><Icon name="play" size={12} style={{ transform: "scaleX(-1)" }} /> Undo</button>
        <button className="btn-bordered" onClick={() => setDialog({ type: "history" })} title="Operation History (⌘Y)"><Icon name="reveal" size={12} /></button>
        <button className="btn-bordered" onClick={() => setDialog({ type: "settings" })} title="Settings"><Icon name="filter" size={12} /></button>
        <button className="btn-bordered" onClick={() => setDialog({ type: "help" })} title="Help">?</button>
      </div>

      <div className="searchrow">
        <button className={`search-btn ${scanning ? "stop" : folders.length === 0 ? "disabled" : ""}`}
          onClick={startScanning} disabled={folders.length === 0 && !scanning}>
          <Icon name={scanning ? "stop" : "search"} size={15} />
          {scanning ? "Stop" : "Search for Duplicates"}
        </button>
        <div className="folder-panel">
          {folders.length === 0 ? (
            <span className="empty-folders">No Folders Selected</span>
          ) : (
            <div className="folder-chips">
              {folders.map((f) => (
                <span className="chip" key={f} title={f}>
                  <Icon name="folder" size={9} fill /> {baseName(f)}
                  <span className="x" onClick={() => !scanning && removeFolder(f)}><Icon name="x" size={10} /></span>
                </span>
              ))}
            </div>
          )}
          <span className="spacer" />
          <button className="btn-bordered" onClick={addFolders} disabled={scanning}>Add Folder…</button>
        </div>
        {folders.length >= 2 && (
          <div className="segmented">
            <button className={scanScope === "combined" ? "active" : ""} onClick={() => setScanScope("combined")} disabled={scanning}>Across all</button>
            <button className={scanScope === "perFolder" ? "active" : ""} onClick={() => setScanScope("perFolder")} disabled={scanning}>Within each</button>
          </div>
        )}
      </div>

      <div className="options-wrap">
        <div className="opt-row">
          <span className="row-label">OPTIONS</span>
          {mode === "files" && (
            <>
              <Check label="Deep Scan" icon="shield" checked={fileOpts.deep} disabled={scanning} onChange={(v) => setFileOpts({ ...fileOpts, deep: v })} />
              <Check label="Media" icon="photo" checked={fileOpts.mediaOnly} disabled={scanning} onChange={(v) => setFileOpts({ ...fileOpts, mediaOnly: v })} />
              <Check label="No Hidden" icon="eyeSlash" checked={fileOpts.skipHidden} disabled={scanning} onChange={(v) => setFileOpts({ ...fileOpts, skipHidden: v })} />
              <Check label="Symlinks" icon="link" checked={fileOpts.detectSymlinks} disabled={scanning} onChange={(v) => setFileOpts({ ...fileOpts, detectSymlinks: v })} />
            </>
          )}
          {mode === "folders" && (
            <>
              <Check label="Media" icon="photo" checked={folderOpts.mediaOnly} disabled={scanning} onChange={(v) => setFolderOpts({ ...folderOpts, mediaOnly: v })} />
              <Check label="No Hidden" icon="eyeSlash" checked={folderOpts.skipHidden} disabled={scanning} onChange={(v) => setFolderOpts({ ...folderOpts, skipHidden: v })} />
              <div className="slider-group">
                <span>Match:</span>
                <input type="range" min="0.5" max="1" step="0.05" value={folderOpts.threshold} disabled={scanning}
                  onChange={(e) => setFolderOpts({ ...folderOpts, threshold: parseFloat(e.target.value) })} />
                <span className="slider-val">{Math.round(folderOpts.threshold * 100)}%</span>
              </div>
            </>
          )}
          {mode === "photos" && (
            <>
              <div className="slider-group">
                <span>Similarity:</span>
                <input type="range" min="0.7" max="1" step="0.01" value={photoOpts.threshold} disabled={scanning}
                  onChange={(e) => setPhotoOpts({ ...photoOpts, threshold: parseFloat(e.target.value) })} />
                <span className="slider-val">{Math.round(photoOpts.threshold * 100)}%</span>
              </div>
              <Check label="EXIF corroboration" icon="shield" checked={photoOpts.requireExif} disabled={scanning} onChange={(v) => setPhotoOpts({ ...photoOpts, requireExif: v })} />
              <Check label="Expand by metadata" icon="sparkles" checked={photoOpts.expandMetadata} disabled={scanning} onChange={(v) => setPhotoOpts({ ...photoOpts, expandMetadata: v })} />
              {photoOpts.expandMetadata && (
                <>
                  <Check label="Time" checked={photoOpts.expandTime} disabled={scanning} onChange={(v) => setPhotoOpts({ ...photoOpts, expandTime: v })} />
                  <Check label="GPS" checked={photoOpts.expandGps} disabled={scanning} onChange={(v) => setPhotoOpts({ ...photoOpts, expandGps: v })} />
                  <Check label="Camera" checked={photoOpts.expandCamera} disabled={scanning} onChange={(v) => setPhotoOpts({ ...photoOpts, expandCamera: v })} />
                </>
              )}
            </>
          )}
          {mode !== "photos" && (
            <>
              <div className="divider-v" />
              <div className="sort-btns">
                <SortBtn label="Copies" criteria="count" sort={sort} onClick={toggleSort} />
                <SortBtn label="Size" criteria="size" sort={sort} onClick={toggleSort} />
                <SortBtn label="Match Ratio" criteria="matchRatio" sort={sort} onClick={toggleSort} />
              </div>
            </>
          )}
        </div>

        {!scanning && hasResults && (
          <>
            <div className="divider-h" />
            <div className="opt-row">
              <span className="row-label">ACTIONS</span>
              {mode === "files" && fileGroups.length > 0 && <SizeFilterBar value={sizeFilter} onChange={setSizeFilter} />}
              {mode === "folders" && folderGroups.length > 0 && (
                <>
                  <Check label="Copy to new folder" icon="docDoc" checked={safeMerge} onChange={onToggleSafeMerge} />
                  {safeMerge && safeMergeDest && (
                    <span className="action-btn green" onClick={async () => { const d = await pickDestination(); if (d) setSafeMergeDest(d); }}>→ {baseName(safeMergeDest)}</span>
                  )}
                  {!safeMerge && <Check label="Rename kept folder" checked={renameKept} onChange={setRenameKept} />}
                </>
              )}
              {lastLogPath && (
                <button className="btn-bordered" onClick={() => api.revealInFinder(lastLogPath)} title="Show the most recent log in the file manager"><Icon name="reveal" size={11} /> Reveal Log</button>
              )}
              <span className="spacer" />
              {mode === "folders" && folderGroups.length > 0 && (
                <>
                  <button className="action-btn indigo" onClick={startWalkthrough}><Icon name="play" size={11} /> Review One-by-One</button>
                  <button className="action-btn indigo" onClick={mergeAll}>
                    <Icon name={safeMerge ? "docDoc" : "merge"} size={11} /> {safeMerge ? "Merge All to New" : "Merge All Folders"}
                  </button>
                </>
              )}
              {mode === "photos" && photoGroups.length > 0 && (
                <>
                  <button className="action-btn green" onClick={exportKeepers}><Icon name="upload" size={11} /> Copy keepers to…</button>
                  <button className="action-btn red" onClick={deleteAllPhotos}><Icon name="trash" size={11} /> Delete all non-keepers</button>
                </>
              )}
              {mode === "files" && hasRemovable && (
                <button className="action-btn red" onClick={cleanAll}><Icon name="trash" size={11} /> Clean All Duplicates</button>
              )}
            </div>
          </>
        )}
      </div>

      {scanning && (
        <div className="progress-wrap">
          <div className="progress-bar"><div style={{ width: `${progress.progress * 100}%` }} /></div>
          <div className="progress-pct">{Math.round(overallProgress * 100)}%</div>
          <div style={{ fontSize: 11, color: "var(--secondary)" }}>{progress.status}</div>
        </div>
      )}

      {!scanning && (
        <Results
          mode={mode} hasResults={hasResults} roots={folders}
          displayedFileGroups={displayedFileGroups} displayedFolderGroups={displayedFolderGroups}
          photoGroups={photoGroups} fileGroups={fileGroups} folderGroups={folderGroups} sizeActive={sizeActive}
          deletedPaths={deletedPaths} selectedFile={selectedFile} selectedFolderId={selectedFolderId} selectedPhotoId={selectedPhotoId}
          onSelectFile={selectFile} onDeleteFile={deleteFile} onOpenFolder={(p) => api.openFolder(p)}
          onSelectFolder={setSelectedFolderId} onMergeFolder={onMergeFolder} safeMerge={safeMerge}
          onSelectPhoto={setSelectedPhotoId} onSetKeeper={setKeeper} onDeletePhotoOthers={deletePhotoOthers}
          barStatus={barStatus}
        />
      )}

      <div className="statusbar">
        {barStatus && <><span className="status-dot" style={{ background: statusColor }} /><span>{barStatus}</span></>}
        <span className="spacer" />
        {showStats && (
          <div className="stats">
            <span><Icon name="drive" size={9} /> <b>Potential Savings:</b> {formatBytes(potentialSavings)}</span>
            <div className="divider-v" style={{ height: 10 }} />
            <span style={{ color: "var(--green-text)" }}><Icon name="sparkles" size={9} /> <b>Recoveries:</b> {formatBytes(recovered)}</span>
          </div>
        )}
        {!license.registered ? (
          <div className="trial">
            <Icon name="shield" size={9} /> <b>Trial Mode:</b> {license.trial}/{TRIAL_LIMIT} used
            <button onClick={() => setDialog({ type: "license" })}>(Register App)</button>
          </div>
        ) : (
          <span style={{ fontSize: 9 }}>Licensed to {license.name}</span>
        )}
      </div>

      {dialog?.type === "cleanAll" && <CleanAllSheet count={dialog.count} bytes={dialog.bytes} onClean={doCleanAll} onCancel={() => setDialog(null)} />}
      {dialog?.type === "diff" && <DiffSheet group={dialog.group} safeMerge={safeMerge} onMerge={() => confirmMergeFolder(dialog.group)} onClose={() => setDialog(null)} />}
      {dialog?.type === "merge" && <MergeSheet group={dialog.group} safeMerge={safeMerge} onMerge={() => executeMerge(dialog.group)} onCancel={() => setDialog(null)} />}
      {dialog?.type === "mergeAll" && <MergeAllSheet groups={dialog.groups} safeMerge={safeMerge} onMergeAll={executeMergeAll} onCancel={() => setDialog(null)} />}
      {dialog?.type === "photoDelete" && <PhotoDeleteSheet count={dialog.count} bytes={dialog.bytes} all={dialog.all} onConfirm={dialog.run} onCancel={() => setDialog(null)} />}
      {dialog?.type === "license" && <LicenseSheet onValidate={validateLicense} onClose={() => setDialog(null)} registered={license.registered} registeredName={license.name} onDeactivate={deactivate} />}
      {dialog?.type === "register" && <RegisterAlert onClose={() => setDialog(null)} />}
      {dialog?.type === "help" && <HelpWindow onClose={() => setDialog(null)} />}
      {dialog?.type === "settings" && <SettingsWindow priority={photoPriority} onChange={setPhotoPriority} onClose={() => setDialog(null)} />}
      {dialog?.type === "history" && <HistoryWindow onClose={() => setDialog(null)} />}

      {walk && (
        <DiffSheet
          key={walk.index}
          group={walk.queue[walk.index]}
          safeMerge={safeMerge}
          walkthrough
          progressLabel={`Cluster ${walk.index + 1} of ${walk.queue.length}`}
          onApproveNext={() => walkAdvance(true)}
          onSkip={() => walkAdvance(false)}
          onClose={() => setWalk(null)}
        />
      )}

      {previewPath && <Preview path={previewPath} onClose={() => setPreviewPath(null)} />}
    </div>
  );
}

function Results(props) {
  const { mode, hasResults, displayedFileGroups, displayedFolderGroups, photoGroups, fileGroups, folderGroups, sizeActive, barStatus, roots } = props;
  const [collapsed, setCollapsed] = useState(new Set());

  if (!hasResults) {
    const done = barStatus && barStatus.includes("Completed");
    return (
      <div className="empty">
        <span className="icon"><Icon name={done ? "check" : "folderPlus"} size={46} /></span>
        <span className="title">{done ? "No duplicates found" : "Add folder(s) to begin"}</span>
        <span className="sub">{mode === "photos" ? "Press Search to find visually similar photos." : "Press Search for Duplicates after adding folders."}</span>
      </div>
    );
  }

  const sections = mode === "files"
    ? computeSections(displayedFileGroups, filePaths, roots)
    : mode === "folders"
    ? computeSections(displayedFolderGroups, folderPaths, roots)
    : null;

  const toggle = (key) => setCollapsed((c) => { const n = new Set(c); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const renderGroups = (mode === "files")
    ? (gs) => <FileGroups groups={gs} deletedPaths={props.deletedPaths} selected={props.selectedFile} onSelect={props.onSelectFile} onDelete={props.onDeleteFile} onOpenFolder={props.onOpenFolder} />
    : (gs) => <FolderGroups groups={gs} selected={props.selectedFolderId} onSelect={props.onSelectFolder} onMerge={props.onMergeFolder} safeMerge={props.safeMerge} />;

  return (
    <div className="results">
      <div className="results-header">
        <span className="title">
          {mode === "files" && `Duplicate Groups found (${sizeActive ? `${displayedFileGroups.length} of ${fileGroups.length}` : displayedFileGroups.length}):`}
          {mode === "folders" && `Duplicate folder clusters (${folderGroups.length}):`}
          {mode === "photos" && `Similar photo groups (${photoGroups.length}):`}
        </span>
        <span className="spacer" />
        {mode !== "photos" && <span className="badge-space">Space to preview</span>}
        {mode === "files" && <span className="badge-lock"><Icon name="lock" size={9} /> Safety Lock Active</span>}
      </div>

      {mode === "photos" ? (
        <PhotoGroups groups={photoGroups} deletedPaths={props.deletedPaths} selectedId={props.selectedPhotoId}
          onSelect={props.onSelectPhoto} onSetKeeper={props.onSetKeeper} onDeleteOthers={props.onDeletePhotoOthers} />
      ) : sections ? (
        <div className="group-list">
          {sections.map((sec) => (
            <div key={sec.key}>
              <button className="section-head" onClick={() => toggle(sec.key)}>
                <Icon name={collapsed.has(sec.key) ? "chevRight" : "chevDown"} size={11} />
                <Icon name={sec.isAcross ? "branch" : "folder"} size={12} />
                {sec.label}
                {!sec.isAcross && <span className="mono" style={{ fontSize: 9, color: "var(--secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 280 }}>{sec.path}</span>}
                <span className="spacer" />
                <span className="cnt">{sec.groups.length}</span>
              </button>
              {!collapsed.has(sec.key) && renderGroups(sec.groups)}
            </div>
          ))}
        </div>
      ) : (
        renderGroups(mode === "files" ? displayedFileGroups : displayedFolderGroups)
      )}
    </div>
  );
}

function Check({ label, icon, checked, disabled, onChange }) {
  return (
    <label className={`check ${disabled ? "disabled" : ""}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {icon && <Icon name={icon} size={11} />}
      {label}
    </label>
  );
}

function SortBtn({ label, criteria, sort, onClick }) {
  const active = sort.criteria === criteria;
  return (
    <button className={`sort-btn ${active ? "active" : ""}`} onClick={() => onClick(criteria)}>
      {label}
      {active && <Icon name={sort.order === "ascending" ? "chevUp" : "chevDown"} size={9} />}
    </button>
  );
}

function SizeFilterBar({ value, onChange }) {
  const active = value.min !== "" || value.max !== "";
  return (
    <div className="size-filter">
      <span>Size:</span>
      <input type="text" placeholder="min" value={value.min} onChange={(e) => onChange({ ...value, min: e.target.value.replace(/\D/g, "") })} />
      <span>–</span>
      <input type="text" placeholder="max" value={value.max} onChange={(e) => onChange({ ...value, max: e.target.value.replace(/\D/g, "") })} />
      <select value={value.unit} onChange={(e) => onChange({ ...value, unit: e.target.value })}>
        <option>KB</option><option>MB</option><option>GB</option>
      </select>
      {active && <button className="icon-btn" onClick={() => onChange({ ...value, min: "", max: "" })}><Icon name="x" size={11} /></button>}
    </div>
  );
}
