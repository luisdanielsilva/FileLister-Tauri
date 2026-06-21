import { describe, it, expect } from "vitest";
import { formatBytes, baseName, joinPath, isUnder } from "./paths";

describe("formatBytes", () => {
  it("scales KB → TB", () => {
    expect(formatBytes(512)).toBe("0.50 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.00 MB");
    expect(formatBytes(1024 ** 3)).toBe("1.00 GB");
    expect(formatBytes(1024 ** 4)).toBe("1.00 TB");
  });
});

describe("baseName", () => {
  it("handles POSIX paths", () => {
    expect(baseName("/Users/luis/Pictures/holiday.jpg")).toBe("holiday.jpg");
  });
  it("handles Windows paths", () => {
    expect(baseName("C:\\Users\\luis\\Pictures\\holiday.jpg")).toBe("holiday.jpg");
  });
  it("tolerates trailing separators", () => {
    expect(baseName("/Users/luis/Dest/")).toBe("Dest");
    expect(baseName("C:\\Users\\luis\\Dest\\")).toBe("Dest");
  });
});

describe("joinPath", () => {
  it("uses the parent's separator", () => {
    expect(joinPath("/Users/luis/Dest", "Trip merged")).toBe("/Users/luis/Dest/Trip merged");
    expect(joinPath("C:\\Users\\luis\\Dest", "Trip merged")).toBe("C:\\Users\\luis\\Dest\\Trip merged");
  });
  it("does not double the separator", () => {
    expect(joinPath("/a/b/", "c")).toBe("/a/b/c");
    expect(joinPath("C:\\a\\b\\", "c")).toBe("C:\\a\\b\\c");
  });
});

describe("isUnder", () => {
  it("matches a path inside a root (both separator styles)", () => {
    expect(isUnder("/a/b/c.txt", "/a/b")).toBe(true);
    expect(isUnder("C:\\a\\b\\c.txt", "C:\\a\\b")).toBe(true);
    expect(isUnder("/a/b", "/a/b")).toBe(true); // the root itself
  });
  it("rejects sibling prefixes (/a/bcd is not under /a/b)", () => {
    expect(isUnder("/a/bcd", "/a/b")).toBe(false);
    expect(isUnder("C:\\a\\bcd", "C:\\a\\b")).toBe(false);
  });
});
