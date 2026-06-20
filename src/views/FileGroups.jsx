import { Icon } from "../icons";

function confidenceClass(overall) {
  if (overall >= 0.75) return "match-high";
  if (overall >= 0.5) return "match-mid";
  return "match-low";
}

function FileGroupCard({ group, deletedPaths, selected, onSelect, onDelete, onOpenFolder }) {
  const remaining = group.files.filter((f) => !deletedPaths.has(f.full_path)).length;
  return (
    <div className={`fgroup ${remaining > 1 ? "removable" : "safe"}`}>
      <div className="fgroup-head">
        {group.is_symlink_group ? (
          <span style={{ color: "var(--purple)" }}>
            <Icon name="link" size={13} />
          </span>
        ) : (
          <Icon name="doc" size={13} />
        )}
        <span className="fgroup-name">{group.name}</span>
        {group.is_symlink_group && <span className="tag symlink">symlink</span>}
        <span className="fgroup-size">({group.size})</span>
        <span className="spacer" />
        {group.confidence && (
          <span
            className={`tag ${confidenceClass(group.confidence.overall)}`}
            title={tooltipFor(group.confidence)}
          >
            {Math.round(group.confidence.overall * 100)}% match
          </span>
        )}
        <span className={`copies ${remaining > 1 ? "dup" : "safe"}`}>{remaining} copies</span>
      </div>
      {group.files.map((file) => {
        const isDeleted = deletedPaths.has(file.full_path);
        return (
          <div className="frow" key={file.id}>
            <span
              className={`path ${isDeleted ? "deleted" : selected === file.id ? "selected" : ""}`}
              onClick={() => !isDeleted && onSelect(file)}
              title={file.full_path}
            >
              {file.path}
            </span>
            {!isDeleted ? (
              <>
                <button className="icon-btn" title="Open folder in Finder" onClick={() => onOpenFolder(file.path)}>
                  <Icon name="folder" size={13} />
                </button>
                <button
                  className={`icon-btn ${remaining > 1 ? "" : "lock"}`}
                  disabled={remaining <= 1}
                  title={remaining > 1 ? "Move to Trash" : "Safety lock — last copy"}
                  onClick={() => remaining > 1 && onDelete(group, file)}
                >
                  <Icon name={remaining > 1 ? "trash" : "lock"} size={13} />
                </button>
              </>
            ) : (
              <span style={{ color: "var(--red)" }}>
                <Icon name="check" size={13} />
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function tooltipFor(c) {
  let lines = [`Confidence: ${Math.round(c.overall * 100)}% — ${c.label}`, ""];
  for (const s of c.signals) {
    lines.push(`• ${s.name}: ${Math.round(s.score * 100)}%  (weight ${Math.round(s.weight * 100)}%)`);
    lines.push(`  ${s.detail}`);
  }
  return lines.join("\n");
}

export function FileGroups({ groups, deletedPaths, selected, onSelect, onDelete, onOpenFolder }) {
  return (
    <div className="group-list">
      {groups.map((g) => (
        <FileGroupCard
          key={g.id}
          group={g}
          deletedPaths={deletedPaths}
          selected={selected}
          onSelect={onSelect}
          onDelete={onDelete}
          onOpenFolder={onOpenFolder}
        />
      ))}
    </div>
  );
}
