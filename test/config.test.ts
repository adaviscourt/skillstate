import { mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverManifest, loadConfig, sourceWithRef } from "../src/config.js";
import { ConfigError } from "../src/errors.js";
import { temporaryProject, writeManifest } from "./helpers.js";

const projects: string[] = [];

afterEach(async () => {
  await Promise.all(
    projects.splice(0).map((project) => rm(project, { force: true, recursive: true })),
  );
});

describe("manifest discovery", () => {
  it("walks from a nested directory to the Git root", async () => {
    const root = await temporaryProject();
    projects.push(root);
    const manifest = await writeManifest(root);
    const nested = path.join(root, "packages", "app");
    await mkdir(nested, { recursive: true });
    await expect(discoverManifest(nested)).resolves.toBe(manifest);
  });

  it("does not traverse above the nearest Git root", async () => {
    const outer = await temporaryProject();
    projects.push(outer);
    await writeManifest(outer);
    const nestedRoot = path.join(outer, "nested");
    await mkdir(path.join(nestedRoot, ".git"), { recursive: true });
    await expect(discoverManifest(nestedRoot)).rejects.toBeInstanceOf(ConfigError);
  });
});

describe("manifest parsing", () => {
  it("normalizes ordering, refs, and local paths", async () => {
    const root = await temporaryProject();
    projects.push(root);
    await mkdir(path.join(root, "skills", "local"), { recursive: true });
    await writeManifest(
      root,
      `schema = 1\n[install]\nagents = ["opencode", "opencode"]\nmode = "copy"\n[[sources]]\nsource = "./skills/local"\nskills = ["zeta", "alpha"]\n`,
    );
    const state = await loadConfig({ cwd: root });
    expect(state.agents).toEqual(["opencode"]);
    expect(state.mode).toBe("copy");
    const canonicalLocal = await realpath(path.join(root, "skills", "local"));
    expect(state.sources[0]).toMatchObject({
      source: canonicalLocal,
      skills: ["alpha", "zeta"],
    });
    const source = state.sources[0];
    expect(source).toBeDefined();
    if (source) expect(sourceWithRef(source)).toBe(canonicalLocal);
  });

  it("rejects unknown keys with an actionable path", async () => {
    const root = await temporaryProject();
    projects.push(root);
    await writeManifest(
      root,
      `schema = 1\n[install]\nagents = ["opencode"]\nmode = "symlink"\nunknown = true\n[[sources]]\nsource = "owner/repo"\nskills = ["review"]\n`,
    );
    await expect(loadConfig({ cwd: root })).rejects.toThrow("install: Unrecognized key");
  });

  it("rejects duplicate combinations", async () => {
    const root = await temporaryProject();
    projects.push(root);
    await writeManifest(
      root,
      `schema = 1\n[install]\nagents = ["opencode"]\nmode = "symlink"\n[[sources]]\nsource = "owner/repo"\nskills = ["review"]\n[[sources]]\nsource = "owner/repo"\nskills = ["review"]\n`,
    );
    await expect(loadConfig({ cwd: root })).rejects.toThrow("Duplicate source/ref/skill");
  });

  it("rejects ambiguous refs before backend execution", async () => {
    const root = await temporaryProject();
    projects.push(root);
    await writeManifest(
      root,
      `schema = 1\n[install]\nagents = ["opencode"]\nmode = "symlink"\n[[sources]]\nsource = "owner/repo"\nref = "feature@latest"\nskills = ["review"]\n`,
    );
    await expect(loadConfig({ cwd: root })).rejects.toThrow("unambiguous Git branch or tag");
  });

  it("accepts slash-containing Git refs", async () => {
    const root = await temporaryProject();
    projects.push(root);
    await writeManifest(
      root,
      `schema = 1\n[install]\nagents = ["opencode"]\nmode = "symlink"\n[[sources]]\nsource = "owner/repo"\nref = "feature/review"\nskills = ["review"]\n`,
    );
    await expect(loadConfig({ cwd: root })).resolves.toMatchObject({
      sources: [{ ref: "feature/review" }],
    });
  });

  it("rejects encoded refs", async () => {
    const root = await temporaryProject();
    projects.push(root);
    await writeManifest(
      root,
      `schema = 1\n[install]\nagents = ["opencode"]\nmode = "symlink"\n[[sources]]\nsource = "owner/repo"\nref = "feature%2Freview"\nskills = ["review"]\n`,
    );
    await expect(loadConfig({ cwd: root })).rejects.toThrow();
  });

  it("rejects separate refs on tree URLs", async () => {
    const root = await temporaryProject();
    projects.push(root);
    await writeManifest(
      root,
      `schema = 1\n[install]\nagents = ["opencode"]\nmode = "symlink"\n[[sources]]\nsource = "https://github.com/owner/repo/tree/main/skills/review"\nref = "dev"\nskills = ["review"]\n`,
    );
    await expect(loadConfig({ cwd: root })).rejects.toThrow("tree URL");
  });

  it("rejects local paths outside the project", async () => {
    const root = await temporaryProject();
    projects.push(root);
    await writeManifest(
      root,
      `schema = 1\n[install]\nagents = ["opencode"]\nmode = "symlink"\n[[sources]]\nsource = "../outside"\nskills = ["review"]\n`,
    );
    await expect(loadConfig({ cwd: root })).rejects.toThrow("does not exist");
  });

  it("rejects a local symlink that escapes the project", async () => {
    const root = await temporaryProject();
    const outside = await temporaryProject("skillstate-outside-");
    projects.push(root, outside);
    await mkdir(path.join(root, "skills"));
    await symlink(outside, path.join(root, "skills", "escaped"));
    await writeManifest(
      root,
      `schema = 1\n[install]\nagents = ["opencode"]\nmode = "symlink"\n[[sources]]\nsource = "./skills/escaped"\nskills = ["review"]\n`,
    );
    await expect(loadConfig({ cwd: root })).rejects.toThrow("outside the project");
  });

  it("rejects refs on local sources", async () => {
    const root = await temporaryProject();
    projects.push(root);
    await mkdir(path.join(root, "skills", "local"), { recursive: true });
    await writeManifest(
      root,
      `schema = 1\n[install]\nagents = ["opencode"]\nmode = "symlink"\n[[sources]]\nsource = "./skills/local"\nref = "main"\nskills = ["review"]\n`,
    );
    await expect(loadConfig({ cwd: root })).rejects.toThrow("not supported for local sources");
  });

  it("allows an empty dependency set", async () => {
    const root = await temporaryProject();
    projects.push(root);
    await writeManifest(root, `schema = 1\n[install]\nagents = ["opencode"]\nmode = "symlink"\n`);
    await expect(loadConfig({ cwd: root })).resolves.toMatchObject({ sources: [] });
  });

  it("rejects ambiguous wildcard ownership", async () => {
    const root = await temporaryProject();
    projects.push(root);
    await writeManifest(
      root,
      `schema = 1\n[install]\nagents = ["opencode"]\nmode = "symlink"\n[[sources]]\nsource = "one/repo"\nskills = "*"\n[[sources]]\nsource = "two/repo"\nskills = ["review"]\n`,
    );
    await expect(loadConfig({ cwd: root })).rejects.toThrow("Wildcard sources cannot be combined");
  });

  it("rejects noncanonical skill IDs", async () => {
    const root = await temporaryProject();
    projects.push(root);
    await writeManifest(
      root,
      `schema = 1\n[install]\nagents = ["opencode"]\nmode = "symlink"\n[[sources]]\nsource = "one/repo"\nskills = ["Review Skill"]\n`,
    );
    await expect(loadConfig({ cwd: root })).rejects.toThrow("canonical lowercase kebab-case");
  });

  it("rejects duplicate explicit skill names across sources", async () => {
    const root = await temporaryProject();
    projects.push(root);
    await writeManifest(
      root,
      `schema = 1\n[install]\nagents = ["opencode"]\nmode = "symlink"\n[[sources]]\nsource = "one/repo"\nskills = ["review"]\n[[sources]]\nsource = "two/repo"\nskills = ["review"]\n`,
    );
    await expect(loadConfig({ cwd: root })).rejects.toThrow("declared by both");
  });

  it("reports TOML syntax errors", async () => {
    const root = await temporaryProject();
    projects.push(root);
    await writeFile(path.join(root, "skillstate.toml"), "schema = [");
    await expect(loadConfig({ cwd: root })).rejects.toThrow("Invalid TOML");
  });
});
