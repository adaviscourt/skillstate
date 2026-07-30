import { describe, expect, it } from "vitest";
import type { DesiredState, InstalledState } from "../src/model.js";
import { createPlan, entryMatchesSource } from "../src/planner.js";

const desired: DesiredState = {
  schema: 1,
  agents: ["opencode"],
  mode: "symlink",
  manifestPath: "/project/skillstate.toml",
  projectRoot: "/project",
  sources: [
    { source: "owner/repo", displaySource: "owner/repo", ref: "main", skills: ["alpha", "beta"] },
  ],
};

function installed(names: string[]): InstalledState {
  return {
    version: 1,
    path: "/project/skills-lock.json",
    entries: names.map((name) => ({
      name,
      source: "owner/repo",
      sourceType: "github",
      ref: "main",
      computedHash: name,
    })),
    observed: {
      opencode: names.map((name) => ({
        name,
        path: `/project/.agents/skills/${name}`,
      })),
    },
  };
}

describe("planner", () => {
  it("installs only missing skills", () => {
    const plan = createPlan(desired, installed(["alpha"]));
    expect(plan).toMatchObject({ changes: 1, installs: 1, removals: 0 });
    expect(plan.actions[0]).toMatchObject({ kind: "install", skills: ["beta"] });
    expect(plan.actions[0]?.args).toEqual([
      "add",
      "owner/repo#main",
      "--skill",
      "beta",
      "--agent",
      "opencode",
      "--yes",
    ]);
  });

  it("is a no-op when every declaration is locked", () => {
    const plan = createPlan(desired, installed(["alpha", "beta"]));
    expect(plan.changes).toBe(0);
    expect(plan.actions[0]?.kind).toBe("noop");
  });

  it("restores locked skills missing from target agents", () => {
    const state = { ...installed(["alpha", "beta"]), observed: { opencode: [] } };
    const plan = createPlan(desired, state);
    expect(plan).toMatchObject({ changes: 1, installs: 0, restores: 1 });
    expect(plan.actions[0]).toMatchObject({ kind: "restore", skills: ["alpha", "beta"] });
  });

  it("treats a ref mismatch as drift", () => {
    const state = installed(["alpha", "beta"]);
    const changed = {
      ...state,
      entries: state.entries.map((entry) => ({ ...entry, ref: "dev" })),
    };
    expect(createPlan(desired, changed).installs).toBe(1);
  });

  it("treats an unexpected lock ref as drift when the manifest has no ref", () => {
    const unpinned = {
      ...desired,
      sources: desired.sources.map((source) => ({
        source: source.source,
        displaySource: source.displaySource,
        skills: source.skills,
      })),
    };
    expect(createPlan(unpinned, installed(["alpha", "beta"])).changes).toBe(1);
  });

  it("does not accept a same-name entry from another source", () => {
    const state = installed(["alpha", "beta"]);
    const changed = {
      ...state,
      entries: state.entries.map((entry) => ({ ...entry, source: "other/repo" })),
    };
    expect(createPlan(desired, changed).changes).toBe(1);
  });

  it("overrides agents and install mode", () => {
    const plan = createPlan(desired, installed([]), { agents: ["codex"], mode: "copy" });
    expect(plan.actions[0]).toMatchObject({ agents: ["codex"], mode: "copy" });
    expect(plan.actions[0]?.args).toContain("--copy");
  });

  it("does not prune unless explicitly requested", () => {
    const state = installed(["alpha", "beta", "manual"]);
    expect(createPlan(desired, state).removals).toBe(0);
    const pruned = createPlan(desired, state, { prune: true });
    expect(pruned.removals).toBe(1);
    expect(pruned.actions.at(-1)).toMatchObject({
      kind: "remove",
      skills: ["manual"],
      destructive: true,
    });
  });

  it("refuses to prune noncanonical unmanaged lock entries", () => {
    const state = installed(["alpha", "beta"]);
    const unsafe = {
      ...state,
      entries: [
        ...state.entries,
        {
          name: ".",
          manageable: false,
          source: "manual/source",
          sourceType: "local",
          computedHash: "hash",
        },
      ],
    };
    const plan = createPlan(desired, unsafe, { prune: true });
    expect(plan.removals).toBe(0);
    expect(plan.actions.at(-1)).toMatchObject({ kind: "warning", skills: ["."] });
  });

  it("warns about offline wildcard observability", () => {
    const original = desired.sources[0];
    if (!original) throw new Error("test fixture source missing");
    const wildcard = { ...desired, sources: [{ ...original, skills: "*" as const }] };
    const plan = createPlan(wildcard, installed(["alpha"]));
    expect(plan).toMatchObject({ changes: 0, warnings: 1 });
  });

  it("matches GitHub repository subpaths through skillPath", () => {
    expect(
      entryMatchesSource(
        {
          name: "pdf",
          source: "anthropics/skills",
          sourceType: "github",
          skillPath: "skills/pdf/SKILL.md",
          computedHash: "hash",
        },
        {
          source: "anthropics/skills/skills/pdf",
          displaySource: "anthropics/skills/skills/pdf",
          skills: ["pdf"],
        },
      ),
    ).toBe(true);
  });

  it("matches GitHub tree URLs and GitLab .git lock URLs", () => {
    const githubEntry = {
      name: "pdf",
      source: "anthropics/skills",
      sourceType: "github",
      ref: "main",
      skillPath: "skills/pdf/SKILL.md",
      computedHash: "hash",
    };
    expect(
      entryMatchesSource(githubEntry, {
        source: "https://github.com/anthropics/skills/tree/main/skills/pdf",
        displaySource: "https://github.com/anthropics/skills/tree/main/skills/pdf",
        skills: ["pdf"],
      }),
    ).toBe(true);
    expect(
      entryMatchesSource(
        {
          name: "review",
          source: "group/repo",
          sourceUrl: "https://gitlab.com/group/repo.git",
          sourceType: "gitlab",
          computedHash: "hash",
        },
        {
          source: "https://gitlab.com/group/repo",
          displaySource: "https://gitlab.com/group/repo",
          skills: ["review"],
        },
      ),
    ).toBe(true);
  });

  it("matches relative local sources across checkout roots", () => {
    expect(
      entryMatchesSource(
        {
          name: "review",
          source: "/old/checkout/skills/review",
          sourceType: "local",
          computedHash: "hash",
        },
        {
          source: "/new/checkout/skills/review",
          displaySource: "./skills/review",
          skills: ["review"],
        },
      ),
    ).toBe(true);
  });

  it("does not suffix-match a stale local path in the current checkout", () => {
    expect(
      entryMatchesSource(
        {
          name: "review",
          source: "/project/legacy/skills/review",
          sourceType: "local",
          computedHash: "hash",
        },
        {
          source: "/project/skills/review",
          displaySource: "./skills/review",
          skills: ["review"],
        },
      ),
    ).toBe(false);
  });

  it("compares SCP-style Git sources case-sensitively", () => {
    expect(
      entryMatchesSource(
        {
          name: "review",
          source: "git@example.com:Owner/Repo",
          sourceType: "git",
          computedHash: "hash",
        },
        {
          source: "git@example.com:owner/repo",
          displaySource: "git@example.com:owner/repo",
          skills: ["review"],
        },
      ),
    ).toBe(false);
  });
});
