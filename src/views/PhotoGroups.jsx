import { Icon } from "../icons";
import { fileSrc, formatBytes } from "../api";

function popcount(a, b) {
  // Hamming distance between two BigInt-able u64 values (passed as numbers from JSON
  // may lose precision; we compute similarity from the value as given).
  let x = BigInt(a) ^ BigInt(b);
  let count = 0;
  while (x > 0n) { count += Number(x & 1n); x >>= 1n; }
  return count;
}

function similarityToKeeper(photo, keeper) {
  if (!keeper || photo.id === keeper.id) return 100;
  const ham = popcount(photo.p_hash, keeper.p_hash);
  return Math.round((1 - ham / 64) * 100);
}

function PhotoCard({ group, deletedPaths, selectedId, onSelect, onSetKeeper, onDeleteOthers }) {
  const keeper = group.photos.find((p) => p.id === group.keeper_id);
  return (
    <div className="pgroup">
      <div className="pgroup-head">
        <span style={{ color: "var(--indigo)" }}><Icon name="stack" size={14} /></span>
        <span className="pgroup-title">{group.photos.length} similar photos</span>
        <span className="spacer" />
        <span className="saves-pill">
          <Icon name="drive" size={9} /> Save {formatBytes(group.reclaimable_bytes)}
        </span>
        <button className="action-btn red" onClick={() => onDeleteOthers(group)}>
          <Icon name="trash" size={11} /> Delete others
        </button>
      </div>
      <div className="photo-strip">
        {group.photos.map((photo) => {
          const isKeeper = photo.id === group.keeper_id;
          const isDeleted = deletedPaths.has(photo.full_path);
          const sim = similarityToKeeper(photo, keeper);
          return (
            <div
              key={photo.id}
              className={`pcell ${isKeeper ? "keeper" : ""} ${selectedId === photo.id ? "selected" : ""} ${isDeleted ? "deleted" : ""}`}
              onClick={() => onSelect(photo.id)}
            >
              <img className="pthumb" src={fileSrc(photo.full_path)} alt={photo.name} loading="lazy" />
              <span className="pcaption" title={photo.full_path}>{photo.name}</span>
              <span className="pcaption">{photo.pixel_width}×{photo.pixel_height} · {formatBytes(photo.size_bytes)}</span>
              {isKeeper ? (
                <span className="keeper-badge">★ KEEPER</span>
              ) : isDeleted ? (
                <span className="keeper-badge" style={{ color: "var(--red)" }}>deleted</span>
              ) : (
                <button className="pkeep-btn" onClick={(e) => { e.stopPropagation(); onSetKeeper(group.id, photo.id); }}>
                  Keep this ({sim}%)
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PhotoGroups({ groups, deletedPaths, selectedId, onSelect, onSetKeeper, onDeleteOthers }) {
  return (
    <div className="group-list">
      {groups.map((g) => (
        <PhotoCard
          key={g.id}
          group={g}
          deletedPaths={deletedPaths}
          selectedId={selectedId}
          onSelect={onSelect}
          onSetKeeper={onSetKeeper}
          onDeleteOthers={onDeleteOthers}
        />
      ))}
    </div>
  );
}
