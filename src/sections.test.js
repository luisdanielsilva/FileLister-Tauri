import { describe, it, expect } from "vitest";
import { computeSections } from "./sections";

// Each test group is just { id, paths }; getPaths returns its folder paths.
const getPaths = (g) => g.paths;

describe("computeSections", () => {
  it("returns null (flat list) for fewer than 2 selected folders", () => {
    const groups = [{ id: "1", paths: ["/a/x"] }];
    expect(computeSections(groups, getPaths, ["/a"])).toBeNull();
  });

  it("buckets groups under their owning folder, with an 'across' bucket for cross-folder ones", () => {
    const g1 = { id: "1", paths: ["/a/x"] };
    const g2 = { id: "2", paths: ["/b/y"] };
    const g3 = { id: "3", paths: ["/a/x", "/b/y"] }; // spans both → across
    const sections = computeSections([g1, g2, g3], getPaths, ["/a", "/b"]);

    expect(sections.map((s) => s.key)).toEqual(["/a", "/b", "__across__"]);
    expect(sections[0].groups).toEqual([g1]);
    expect(sections[1].groups).toEqual([g2]);
    const across = sections[2];
    expect(across.isAcross).toBe(true);
    expect(across.label).toBe("Across multiple folders");
    expect(across.groups).toEqual([g3]);
  });

  it("assigns a path to the most specific (longest-matching) nested root", () => {
    const g = { id: "1", paths: ["/a/b/x"] }; // under both /a and /a/b
    const sections = computeSections([g], getPaths, ["/a", "/a/b"]);
    // belongs to /a/b (longest match); /a has no groups so it isn't shown
    expect(sections).toHaveLength(1);
    expect(sections[0].key).toBe("/a/b");
  });
});
