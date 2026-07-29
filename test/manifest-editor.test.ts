import { readFile, rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  addToManifest,
  removeFromManifest,
  validateManifestAdd,
  validateManifestRemoval,
} from "../src/manifest-editor.js";
import { temporaryProject, writeManifest } from "./helpers.js";

const projects: string[] = [];
afterEach(async () => {
  await Promise.all(
    projects.splice(0).map((project) => rm(project, { force: true, recursive: true })),
  );
});

describe("manifest editor", () => {
  it("adds sorted skills while preserving comments and unrelated formatting", async () => {
    const root = await temporaryProject();
    projects.push(root);
    const manifest = await writeManifest(
      root,
      `# project comment\nschema = 1\n\n[install]\nagents=["opencode"] # keep\nmode="symlink"\n\n[[sources]]\n# source comment\nsource = "owner/repo"\nskills = ["zeta"] # selection\n`,
    );
    await addToManifest(manifest, "owner/repo", undefined, ["alpha"]);
    const updated = await readFile(manifest, "utf8");
    expect(updated).toContain("# project comment");
    expect(updated).toContain('agents=["opencode"] # keep');
    expect(updated).toContain("# source comment");
    expect(updated).toContain('skills = [\n  "alpha",\n  "zeta",\n]');
  });

  it("appends a new source without rewriting existing content", async () => {
    const root = await temporaryProject();
    projects.push(root);
    const manifest = await writeManifest(root);
    const before = await readFile(manifest, "utf8");
    await addToManifest(manifest, "another/repo", "v1", ["beta"]);
    const after = await readFile(manifest, "utf8");
    expect(after.startsWith(before)).toBe(true);
    expect(after).toContain('source = "another/repo"\nref = "v1"\nskills = ["beta"]');
  });

  it("removes one skill and collapses an empty source block", async () => {
    const root = await temporaryProject();
    projects.push(root);
    const manifest = await writeManifest(
      root,
      `schema = 1\n[install]\nagents = ["opencode"]\nmode = "symlink"\n[[sources]]\nsource = "one/repo"\nskills = ["alpha", "beta"]\n[[sources]]\nsource = "two/repo"\nskills = ["gamma"]\n`,
    );
    await removeFromManifest(manifest, "alpha");
    await removeFromManifest(manifest, "gamma");
    const updated = await readFile(manifest, "utf8");
    expect(updated).toContain('skills = ["beta"]');
    expect(updated).not.toContain("two/repo");
  });

  it("keeps the manifest valid after removing the final dependency", async () => {
    const root = await temporaryProject();
    projects.push(root);
    const manifest = await writeManifest(root);
    await removeFromManifest(manifest, "review");
    const updated = await readFile(manifest, "utf8");
    expect(updated).not.toContain("[[sources]]");
    await addToManifest(manifest, "new/repo", undefined, ["new-skill"]);
    expect(await readFile(manifest, "utf8")).toContain('source = "new/repo"');
  });

  it("preserves footer comments when removing the final source", async () => {
    const root = await temporaryProject();
    projects.push(root);
    const manifest = await writeManifest(
      root,
      `schema = 1\n[install]\nagents = ["opencode"]\nmode = "symlink"\n[[sources]]\nsource = "one/repo"\nskills = ["review"]\n\n# Keep this project note.\n`,
    );
    await removeFromManifest(manifest, "review");
    expect(await readFile(manifest, "utf8")).toContain("# Keep this project note.");
  });

  it("preserves an inline comment when editing a literal-string array", async () => {
    const root = await temporaryProject();
    projects.push(root);
    const manifest = await writeManifest(
      root,
      `schema = 1\n[install]\nagents = ["opencode"]\nmode = "symlink"\n[[sources]]\nsource = "one/repo"\nskills = ['alpha'] # keep me\n`,
    );
    await addToManifest(manifest, "one/repo", undefined, ["beta"]);
    const updated = await readFile(manifest, "utf8");
    expect(updated).toContain("# keep me");
    expect(updated).toContain('"alpha"');
  });

  it("refuses ambiguous wildcard removal", async () => {
    const root = await temporaryProject();
    projects.push(root);
    const manifest = await writeManifest(
      root,
      `schema = 1\n[install]\nagents = ["opencode"]\nmode = "symlink"\n[[sources]]\nsource = "one/repo"\nskills = "*"\n`,
    );
    await expect(removeFromManifest(manifest, "alpha")).rejects.toThrow("not explicitly declared");
    await expect(validateManifestRemoval(manifest, "alpha")).rejects.toThrow(
      "not explicitly declared",
    );
  });

  it("validates a safe edit before backend mutation", async () => {
    const root = await temporaryProject();
    projects.push(root);
    const manifest = await writeManifest(root);
    await expect(
      validateManifestAdd(manifest, "owner/repo", undefined, ["second"]),
    ).resolves.toBeUndefined();
    await expect(validateManifestRemoval(manifest, "review")).resolves.toBeUndefined();
  });
});
