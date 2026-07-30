import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BackendError, ConfigError } from "../src/errors.js";
import { readLock } from "../src/lock.js";
import { temporaryProject } from "./helpers.js";

const projects: string[] = [];
afterEach(async () => {
  await Promise.all(
    projects.splice(0).map((project) => rm(project, { force: true, recursive: true })),
  );
});

describe("backend lock", () => {
  it("treats a missing lock as empty state", async () => {
    const root = await temporaryProject();
    projects.push(root);
    await expect(readLock(root)).resolves.toMatchObject({ version: 1, entries: [], observed: {} });
  });

  it("reads and sorts schema version 1 entries", async () => {
    const root = await temporaryProject();
    projects.push(root);
    await writeFile(
      path.join(root, "skills-lock.json"),
      JSON.stringify({
        version: 1,
        skills: {
          zeta: { source: "owner/repo", sourceType: "github", computedHash: "z" },
          alpha: { source: "owner/repo", sourceType: "github", computedHash: "a" },
        },
      }),
    );
    const state = await readLock(root);
    expect(state.entries.map((entry) => entry.name)).toEqual(["alpha", "zeta"]);
  });

  it("rejects future lock versions", async () => {
    const root = await temporaryProject();
    projects.push(root);
    await writeFile(
      path.join(root, "skills-lock.json"),
      JSON.stringify({ version: 2, skills: {} }),
    );
    await expect(readLock(root)).rejects.toBeInstanceOf(BackendError);
  });

  it("rejects malformed lock JSON", async () => {
    const root = await temporaryProject();
    projects.push(root);
    await writeFile(path.join(root, "skills-lock.json"), "{");
    await expect(readLock(root)).rejects.toBeInstanceOf(ConfigError);
  });

  it("tolerates but marks option-like unmanaged lock keys unsafe", async () => {
    const root = await temporaryProject();
    projects.push(root);
    await writeFile(
      path.join(root, "skills-lock.json"),
      JSON.stringify({
        version: 1,
        skills: {
          "--all": { source: "owner/repo", sourceType: "github", computedHash: "hash" },
        },
      }),
    );
    const state = await readLock(root);
    expect(state.entries[0]).toMatchObject({ name: "--all", manageable: false });
  });

  it("rejects display controls in lock values", async () => {
    const root = await temporaryProject();
    projects.push(root);
    await writeFile(
      path.join(root, "skills-lock.json"),
      JSON.stringify({
        version: 1,
        skills: {
          ".": { source: "owner/repo\u001b[2J", sourceType: "github", computedHash: "hash" },
        },
      }),
    );
    await expect(readLock(root)).rejects.toBeInstanceOf(ConfigError);
  });
});
