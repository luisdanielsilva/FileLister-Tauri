import { baseName, isUnder } from "./api";

const ACROSS = "__across__";

// The single selected root containing all given paths, or null if they span more
// than one (a cross-folder duplicate). Longest match wins. Mirrors owningRoot().
function owningRoot(paths, roots) {
  const set = new Set();
  for (const p of paths) {
    const matches = roots.filter((r) => isUnder(p, r));
    if (matches.length) {
      const best = matches.reduce((a, b) => (b.length > a.length ? b : a));
      set.add(best);
    }
  }
  return set.size === 1 ? [...set][0] : null;
}

// Returns ordered sections (selected folders first, then the "across" bucket), or
// null when fewer than 2 folders are selected (flat list).
export function computeSections(groups, getPaths, roots) {
  if (roots.length < 2) return null;
  const byKey = new Map();
  for (const g of groups) {
    const key = owningRoot(getPaths(g), roots) ?? ACROSS;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(g);
  }
  const sections = [];
  for (const r of roots) {
    if (byKey.has(r)) sections.push({ key: r, label: baseName(r), path: r, isAcross: false, groups: byKey.get(r) });
  }
  if (byKey.has(ACROSS)) sections.push({ key: ACROSS, label: "Across multiple folders", isAcross: true, groups: byKey.get(ACROSS) });
  return sections.length ? sections : null;
}

export const filePaths = (g) => g.files.map((f) => f.path);
export const folderPaths = (g) => g.folders;
