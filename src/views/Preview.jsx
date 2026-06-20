import { useState, useEffect } from "react";
import { Icon } from "../icons";
import { api, fileSrc, baseName } from "../api";

const IMAGE_EXT = ["jpg", "jpeg", "png", "gif", "heic", "heif", "bmp", "webp", "svg", "tiff", "tif", "ico"];
const TEXT_EXT = ["txt", "md", "json", "js", "jsx", "ts", "tsx", "rs", "py", "swift", "html", "css", "xml", "yaml", "yml", "toml", "csv", "log", "sh", "c", "cpp", "h", "java", "go", "rb"];
const VIDEO_EXT = ["mp4", "mov", "webm", "m4v"];

function ext(path) {
  const m = path.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

export function Preview({ path, onClose }) {
  const [text, setText] = useState(null);
  const e = ext(path);
  const kind = IMAGE_EXT.includes(e) ? "image" : VIDEO_EXT.includes(e) ? "video" : TEXT_EXT.includes(e) ? "text" : "other";

  useEffect(() => {
    if (kind === "text") {
      api.readTextFile(path, 100000).then(setText).catch(() => setText("(could not read file)"));
    }
  }, [path, kind]);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" style={{ width: "80vw", maxWidth: 900, height: "80vh", padding: 0, display: "flex", flexDirection: "column" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
          <Icon name="doc" size={14} />
          <span style={{ fontWeight: 600, fontSize: 13, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{baseName(path)}</span>
          <button className="btn-bordered" onClick={() => api.openFolder(path)}>Open in default app</button>
          <button className="btn-bordered" onClick={onClose}>Close (Space)</button>
        </div>
        <div style={{ flex: 1, overflow: "auto", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "rgba(0,0,0,0.15)" }}>
          {kind === "image" && <img src={fileSrc(path)} alt={baseName(path)} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />}
          {kind === "video" && <video src={fileSrc(path)} controls style={{ maxWidth: "100%", maxHeight: "100%" }} />}
          {kind === "text" && <pre className="mono" style={{ alignSelf: "flex-start", width: "100%", fontSize: 11, whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0, color: "var(--text)" }}>{text ?? "Loading…"}</pre>}
          {kind === "other" && (
            <div className="empty">
              <span className="icon"><Icon name="doc" size={46} /></span>
              <span className="title">No inline preview</span>
              <span className="sub">Use “Open in default app” to view this file type.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
