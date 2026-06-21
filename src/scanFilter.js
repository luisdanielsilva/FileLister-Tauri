// Global include/exclude rules applied to search results (Files & Photos). Mirrors
// the Swift ScanFilters: an excluded folder removes matching files; an excluded
// extension always wins; if an include list is set, only those extensions pass.
// Pure module (no Tauri/DOM) so it's unit-testable.

function parseNames(s) {
  // Folder names: split on commas only (names may contain spaces).
  return new Set(s.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean));
}

function parseExts(s) {
  // Extensions: split on commas/space/semicolon; tolerate a leading dot.
  return new Set(
    s.split(/[,;\s]+/).map((x) => x.trim().toLowerCase().replace(/^\./, "")).filter(Boolean)
  );
}

function extOf(name) {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function makeScanFilter({ excludeFolders = "", includeExts = "", excludeExts = "" } = {}) {
  const exFolders = parseNames(excludeFolders);
  const incExts = parseExts(includeExts);
  const exExts = parseExts(excludeExts);
  const isActive = exFolders.size > 0 || incExts.size > 0 || exExts.size > 0;

  const allowsName = (name) => {
    const ext = extOf(name);
    if (exExts.has(ext)) return false;
    if (incExts.size > 0 && !incExts.has(ext)) return false;
    return true;
  };

  // Full-path test: extension rules + no excluded folder anywhere in the parent path.
  const allows = (fullPath) => {
    if (!isActive) return true;
    const parts = fullPath.split(/[/\\]/).filter(Boolean);
    const name = parts[parts.length - 1] || "";
    if (!allowsName(name)) return false;
    if (exFolders.size > 0) {
      for (let i = 0; i < parts.length - 1; i++) {
        if (exFolders.has(parts[i].toLowerCase())) return false;
      }
    }
    return true;
  };

  return { isActive, allows };
}
