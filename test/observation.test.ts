import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { observeSkills } from "../src/backend.js";
import { BackendError } from "../src/errors.js";
import { temporaryProject } from "./helpers.js";

const projects: string[] = [];
afterEach(async () => {
  await Promise.all(
    projects.splice(0).map((project) => rm(project, { force: true, recursive: true })),
  );
});

describe("agent observation", () => {
  it("uses exact backend-owned target paths instead of unrelated canonical state", async () => {
    const root = await temporaryProject();
    projects.push(root);
    const claudeSkill = path.join(root, ".claude", "skills", "review");
    await mkdir(claudeSkill, { recursive: true });
    await writeFile(
      path.join(claudeSkill, "SKILL.md"),
      "---\nname: review\ndescription: test\n---\n",
    );

    const observed = await observeSkills(root, ["claude-code", "opencode"]);
    expect(observed["claude-code"]?.map((skill) => skill.name)).toEqual(["review"]);
    expect(observed.opencode).toEqual([]);
  });

  it("rejects agent target symlinks that escape the project", async () => {
    const root = await temporaryProject();
    const outside = await temporaryProject("skillstate-agent-outside-");
    projects.push(root, outside);
    await symlink(outside, path.join(root, ".claude"));
    await expect(observeSkills(root, ["claude-code"])).rejects.toBeInstanceOf(BackendError);
  });

  it("rejects dynamic Eve subagent targets that escape the project", async () => {
    const root = await temporaryProject();
    const outside = await temporaryProject("skillstate-eve-outside-");
    projects.push(root, outside);
    const subagent = path.join(root, "agent", "subagents", "reviewer");
    await mkdir(subagent, { recursive: true });
    await symlink(outside, path.join(subagent, "skills"));
    await expect(observeSkills(root, ["eve"])).rejects.toBeInstanceOf(BackendError);
  });
});
