import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

export const api = {
  scanFiles: (roots, perFolder, deep, mediaOnly, skipHidden, detectSymlinks) =>
    invoke("scan_files", { roots, perFolder, deep, mediaOnly, skipHidden, detectSymlinks }),

  scanFolders: (roots, perFolder, mediaOnly, skipHidden, threshold) =>
    invoke("scan_folders", { roots, perFolder, mediaOnly, skipHidden, threshold }),

  scanPhotos: (roots, threshold, requireExif, expandMetadata, expandTime, expandGps, expandCamera, priority) =>
    invoke("scan_photos_cmd", { roots, threshold, requireExif, expandMetadata, expandTime, expandGps, expandCamera, priority }),

  stopScan: () => invoke("stop_scan"),
  trashFiles: (paths) => invoke("trash_files", { paths }),
  deleteSingle: (target, reference, isSymlink, name, size) => invoke("delete_single", { target, reference, isSymlink, name, size }),
  cleanAll: (groups, deleted) => invoke("clean_all_duplicates", { groups, deleted }),
  mergeFolder: (group, rename, mergedName) => invoke("merge_folder", { group, rename, mergedName }),
  safeMerge: (group, dest) => invoke("safe_merge", { group, dest }),
  exportKeepers: (keepers, dest, roots) => invoke("export_keepers", { keepers, dest, roots }),
  deletePhotos: (photos, keeperName) => invoke("delete_photos", { photos, keeperName }),
  undoOp: (trashed, created) => invoke("undo_op", { trashed, created }),
  listLogs: () => invoke("list_logs"),
  readTextFile: (path, maxBytes = 65536) => invoke("read_text_file", { path, maxBytes }),
  validateLicense: (key) => invoke("validate_license", { key }),
  formatBytes: (bytes) => invoke("format_bytes_cmd", { bytes }),
  revealInFinder: (path) => invoke("reveal_in_finder", { path }),
  openFolder: (path) => invoke("open_folder", { path }),
};

export function onProgress(handler) {
  return listen("scan-progress", (e) => handler(e.payload));
}

export async function pickFolders(multiple = true) {
  const result = await open({ directory: true, multiple, canCreateDirectories: true });
  if (!result) return [];
  return Array.isArray(result) ? result : [result];
}

export async function pickDestination() {
  const result = await open({ directory: true, multiple: false, canCreateDirectories: true });
  return result || null;
}

export const fileSrc = convertFileSrc;

// JS mirror of formatBytes for instant UI math (no round-trip).
export function formatBytes(bytes) {
  const kb = bytes / 1024;
  const mb = kb / 1024;
  const gb = mb / 1024;
  const tb = gb / 1024;
  if (tb >= 1) return `${tb.toFixed(2)} TB`;
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  if (mb >= 1) return `${mb.toFixed(2)} MB`;
  return `${kb.toFixed(2)} KB`;
}

// Last path segment — handles both POSIX (/) and Windows (\) separators.
export function baseName(path) {
  const parts = path.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || path;
}

// Join a parent directory and a child name using the parent's own separator,
// so Windows paths stay backslash-style and POSIX paths stay forward-slash.
export function joinPath(parent, name) {
  const sep = parent.includes("\\") && !parent.includes("/") ? "\\" : "/";
  return `${parent.replace(/[/\\]$/, "")}${sep}${name}`;
}

// True when `path` is `root` or lives inside it, for either separator style.
export function isUnder(path, root) {
  return path === root || path.startsWith(root + "/") || path.startsWith(root + "\\");
}
