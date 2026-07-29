import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import { temporaryProject, writeManifest } from "./helpers.js";

const projects: string[] = [];
afterEach(async () => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
  await Promise.all(
    projects.splice(0).map((project) => rm(project, { force: true, recursive: true })),
  );
});

describe("CLI", () => {
  it("returns config exit code for a missing manifest", async () => {
    const root = await temporaryProject();
    projects.push(root);
    const previous = process.cwd();
    process.chdir(root);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await expect(main(["node", "skillstate", "check"])).resolves.toBe(2);
      expect(stderr).toHaveBeenCalledWith(expect.stringContaining("No skillstate.toml found"));
    } finally {
      process.chdir(previous);
    }
  });

  it("returns drift exit code without mutating files", async () => {
    const root = await temporaryProject();
    projects.push(root);
    const manifest = await writeManifest(root);
    const before = await import("node:fs/promises").then(({ readFile }) =>
      readFile(manifest, "utf8"),
    );
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const previous = process.cwd();
    process.chdir(root);
    try {
      await expect(main(["node", "skillstate", "check", "--json"])).resolves.toBe(3);
      expect(stdout).toHaveBeenCalledWith(expect.stringContaining('"status": "drift"'));
      const after = await import("node:fs/promises").then(({ readFile }) =>
        readFile(manifest, "utf8"),
      );
      expect(after).toEqual(before);
    } finally {
      process.chdir(previous);
    }
  });

  it("creates a manifest non-interactively with an explicit agent", async () => {
    const root = await temporaryProject();
    projects.push(root);
    const nested = path.join(root, "nested");
    await mkdir(nested);
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const previous = process.cwd();
    process.chdir(nested);
    try {
      await expect(
        main(["node", "skillstate", "init", "--agent", "opencode", "--json"]),
      ).resolves.toBe(0);
      expect(stdout).toHaveBeenCalledWith(expect.stringContaining('"agents": [\n    "opencode"'));
    } finally {
      process.chdir(previous);
    }
  });

  it("returns structured JSON for Commander errors", async () => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    await expect(main(["node", "skillstate", "unknown", "--json"])).resolves.toBe(2);
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('"status": "error"'));
    expect(stderr).not.toHaveBeenCalled();
  });

  it("marks lifecycle JSON dry-runs explicitly", async () => {
    const root = await temporaryProject();
    projects.push(root);
    await writeManifest(root);
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const previous = process.cwd();
    process.chdir(root);
    try {
      await expect(
        main([
          "node",
          "skillstate",
          "add",
          "owner/repo",
          "--skill",
          "second",
          "--dry-run",
          "--json",
        ]),
      ).resolves.toBe(0);
      expect(stdout).toHaveBeenCalledWith(expect.stringContaining('"status": "dry-run"'));
    } finally {
      process.chdir(previous);
    }
  });

  it("refuses prune from an auto-discovered nested manifest", async () => {
    const root = await temporaryProject();
    projects.push(root);
    const nested = path.join(root, "nested");
    await mkdir(nested);
    await writeManifest(nested, `schema = 1\n[install]\nagents = ["opencode"]\nmode = "copy"\n`);
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const previous = process.cwd();
    process.chdir(nested);
    try {
      await expect(main(["node", "skillstate", "sync", "--prune", "--dry-run"])).resolves.toBe(2);
      expect(stderr).toHaveBeenCalledWith(expect.stringContaining("alternate manifest"));
    } finally {
      process.chdir(previous);
    }
  });
});
