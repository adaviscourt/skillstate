import { describe, expect, it } from "vitest";
import { addArgs, quoteCommand, removeArgs, resolveBackend, updateArgs } from "../src/backend.js";

describe("backend argv", () => {
  it("builds non-interactive add argv without a shell", () => {
    expect(
      addArgs({
        source: "owner/repo#main",
        skills: ["alpha", "beta"],
        agents: ["opencode", "claude-code"],
        mode: "copy",
      }),
    ).toEqual([
      "add",
      "owner/repo#main",
      "--skill",
      "alpha",
      "beta",
      "--agent",
      "opencode",
      "claude-code",
      "--copy",
      "--yes",
    ]);
  });

  it("puts remove names before greedy agent options", () => {
    expect(removeArgs(["review"], ["opencode"])).toEqual([
      "remove",
      "review",
      "--agent",
      "opencode",
      "--yes",
    ]);
  });

  it("scopes updates to project state", () => {
    expect(updateArgs(["review"])).toEqual(["update", "review", "--project", "--yes"]);
  });

  it("quotes diagnostic commands without evaluating them", () => {
    expect(quoteCommand(["add", "owner/repo", "--skill", "name with spaces"])).toBe(
      'skills add owner/repo --skill "name with spaces"',
    );
  });

  it("resolves the pinned local backend", () => {
    expect(resolveBackend()).toMatchObject({ version: "1.5.20" });
  });

  it("rejects option-like values before constructing backend argv", () => {
    expect(() =>
      addArgs({ source: "owner/repo", skills: ["--all"], agents: ["opencode"], mode: "copy" }),
    ).toThrow("Unsafe skill name");
    expect(() => removeArgs(["--all"])).toThrow("Unsafe skill name");
  });
});
