import { describe, it, expect } from "vitest";
import { makeScanFilter } from "./scanFilter";

describe("makeScanFilter", () => {
  it("is inactive (allows everything) when no rules set", () => {
    const f = makeScanFilter({});
    expect(f.isActive).toBe(false);
    expect(f.allows("/a/b/c.txt")).toBe(true);
  });

  it("excludes files under an excluded folder (any separator)", () => {
    const f = makeScanFilter({ excludeFolders: "node_modules, .git" });
    expect(f.isActive).toBe(true);
    expect(f.allows("/proj/node_modules/x.js")).toBe(false);
    expect(f.allows("C:\\proj\\.git\\config")).toBe(false);
    expect(f.allows("/proj/src/x.js")).toBe(true);
  });

  it("excluded extensions always lose", () => {
    const f = makeScanFilter({ excludeExts: "tmp, .log" });
    expect(f.allows("/a/notes.tmp")).toBe(false);
    expect(f.allows("/a/run.log")).toBe(false);
    expect(f.allows("/a/notes.txt")).toBe(true);
  });

  it("include list restricts to only those extensions", () => {
    const f = makeScanFilter({ includeExts: "jpg png" });
    expect(f.allows("/a/photo.jpg")).toBe(true);
    expect(f.allows("/a/photo.PNG")).toBe(true);
    expect(f.allows("/a/doc.pdf")).toBe(false);
  });

  it("exclude wins over include", () => {
    const f = makeScanFilter({ includeExts: "jpg", excludeExts: "jpg" });
    expect(f.allows("/a/photo.jpg")).toBe(false);
  });
});
