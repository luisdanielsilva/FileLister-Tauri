// Pure path/format helpers — no Tauri or DOM imports, so they're trivially unit-testable.

// Human-readable byte size. Mirrors the Rust format_bytes.
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
