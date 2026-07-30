import path from "node:path";
import { addArgs, removeArgs } from "./backend.js";
import { effectiveInstall, sourceWithRef } from "./config.js";
import type {
  DesiredSource,
  DesiredState,
  InstalledState,
  InvocationOverrides,
  LockEntry,
  Plan,
  PlanAction,
} from "./model.js";

function sourceParts(source: string): {
  repository: string;
  subpath?: string;
  ref?: string;
  caseInsensitive?: boolean;
} {
  const normalized = source
    .replace(/\\/g, "/")
    .replace(/\/$/, "")
    .replace(/\.git$/, "");
  if (path.isAbsolute(source) || /^[A-Za-z]:\//.test(normalized)) return { repository: normalized };
  if (normalized.startsWith("git@") || normalized.startsWith("ssh://")) {
    return { repository: normalized };
  }
  if (normalized.startsWith("github:")) {
    return { repository: normalized.slice("github:".length), caseInsensitive: true };
  }
  if (normalized.startsWith("gitlab:")) return { repository: normalized };
  const githubTree = normalized.match(
    /^https?:\/\/github\.com\/([^/]+\/[^/]+)\/tree\/([^/]+)(?:\/(.+))?$/,
  );
  if (githubTree?.[1] && githubTree[2]) {
    return {
      repository: githubTree[1],
      ref: githubTree[2],
      ...(githubTree[3] ? { subpath: githubTree[3] } : {}),
      caseInsensitive: true,
    };
  }
  const github = normalized.match(
    /^(?:https?:\/\/github\.com\/)?([^/]+\/[^/]+?)(?:\.git)?(?:\/(.+))?$/,
  );
  if (github?.[1]) {
    return {
      repository: github[1].replace(/\.git$/, ""),
      ...(github[2] ? { subpath: github[2] } : {}),
      caseInsensitive: true,
    };
  }
  const gitlabTree = normalized.match(
    /^https?:\/\/gitlab\.com\/(.+)\/-\/tree\/([^/]+)(?:\/(.+))?$/,
  );
  if (gitlabTree?.[1] && gitlabTree[2]) {
    return {
      repository: `gitlab:${gitlabTree[1]}`,
      ref: gitlabTree[2],
      ...(gitlabTree[3] ? { subpath: gitlabTree[3] } : {}),
    };
  }
  const gitlab = normalized.match(/^https?:\/\/gitlab\.com\/(.+)$/);
  if (gitlab?.[1]) return { repository: `gitlab:${gitlab[1]}` };
  return { repository: normalized };
}

export function entryMatchesSource(entry: LockEntry, desired: DesiredSource): boolean {
  const expected = sourceParts(desired.source);
  const actualSource = entry.sourceUrl ?? entry.source;
  const actual = sourceParts(actualSource);
  const relativeLocal = desired.displaySource.replace(/\\/g, "/").replace(/^\.\//, "");
  const expectedLocalSuffix = `/${relativeLocal}`;
  const expectedRepository = expected.repository.replace(/\\/g, "/");
  const currentRoot = expectedRepository.endsWith(expectedLocalSuffix)
    ? expectedRepository.slice(0, -expectedLocalSuffix.length)
    : undefined;
  const actualRepository = actual.repository.replace(/\\/g, "/");
  const actualIsCurrentCheckout =
    currentRoot !== undefined &&
    (actualRepository === currentRoot || actualRepository.startsWith(`${currentRoot}/`));
  const portableLocalMatch =
    entry.sourceType === "local" &&
    !path.isAbsolute(desired.displaySource) &&
    (actualIsCurrentCheckout
      ? actualRepository === expectedRepository
      : actualRepository.endsWith(expectedLocalSuffix));
  const repositoriesMatch =
    portableLocalMatch ||
    (expected.caseInsensitive
      ? expected.repository.toLowerCase() === actual.repository.toLowerCase()
      : expected.repository === actual.repository);
  if (!repositoriesMatch) return false;
  const expectedRef = desired.ref ?? expected.ref;
  if ((expectedRef ?? "") !== (entry.ref ?? "")) return false;
  if (expected.subpath) {
    const skillPath = entry.skillPath?.replace(/\\/g, "/");
    if (!skillPath?.startsWith(`${expected.subpath.replace(/\/$/, "")}/`)) return false;
  }
  return true;
}

function desiredNames(state: DesiredState): Set<string> {
  const names = new Set<string>();
  for (const source of state.sources) {
    if (source.skills !== "*") for (const skill of source.skills) names.add(skill.toLowerCase());
  }
  return names;
}

function observedByEveryAgent(
  installed: InstalledState,
  agents: readonly string[],
  entry: LockEntry,
): boolean {
  return agents.every((agent) =>
    (installed.observed[agent] ?? []).some(
      (observed) => observed.name.toLowerCase() === entry.name.toLowerCase(),
    ),
  );
}

export function createPlan(
  desired: DesiredState,
  installed: InstalledState,
  overrides: InvocationOverrides = {},
): Plan {
  const { agents, mode } = effectiveInstall(desired, overrides);
  const actions: PlanAction[] = [];

  for (const source of desired.sources) {
    const matchingEntries = installed.entries.filter((entry) => entryMatchesSource(entry, source));
    if (source.skills === "*") {
      const missingLocally = matchingEntries
        .filter((entry) => entry.manageable !== false)
        .filter((entry) => !observedByEveryAgent(installed, agents, entry))
        .map((entry) => entry.name);
      const selection =
        matchingEntries.length === 0 ? "*" : missingLocally.length > 0 ? missingLocally : undefined;
      if (selection) {
        const args = addArgs({ source: sourceWithRef(source), skills: selection, agents, mode });
        actions.push({
          kind: matchingEntries.length > 0 ? "restore" : "install",
          source: source.displaySource,
          ...(source.ref ? { ref: source.ref } : {}),
          skills: selection === "*" ? ["*"] : selection,
          agents,
          mode,
          reason:
            matchingEntries.length === 0
              ? "No locked skills match this wildcard source."
              : "Locked skills are missing from one or more target agents.",
          args,
          destructive: false,
        });
      } else {
        actions.push({
          kind: "warning",
          source: source.displaySource,
          ...(source.ref ? { ref: source.ref } : {}),
          skills: matchingEntries.map((entry) => entry.name),
          agents,
          mode,
          reason: "Wildcard coverage is limited to skills currently recorded in the backend lock.",
          destructive: false,
        });
      }
      continue;
    }

    const missing = source.skills.filter((skill) => {
      const entry = matchingEntries.find(
        (candidate) => candidate.name.toLowerCase() === skill.toLowerCase(),
      );
      return !entry || !observedByEveryAgent(installed, agents, entry);
    });
    if (missing.length > 0) {
      const args = addArgs({ source: sourceWithRef(source), skills: missing, agents, mode });
      const restore = missing.every((skill) =>
        matchingEntries.some((entry) => entry.name.toLowerCase() === skill.toLowerCase()),
      );
      actions.push({
        kind: restore ? "restore" : "install",
        source: source.displaySource,
        ...(source.ref ? { ref: source.ref } : {}),
        skills: missing,
        agents,
        mode,
        reason:
          "Missing from the backend lock, locked to another source/ref, or absent from a target agent.",
        args,
        destructive: false,
      });
    } else {
      actions.push({
        kind: "noop",
        source: source.displaySource,
        ...(source.ref ? { ref: source.ref } : {}),
        skills: source.skills,
        agents,
        mode,
        reason: "Declared skills are covered by the backend lock.",
        destructive: false,
      });
    }
  }

  if (overrides.prune) {
    const names = desiredNames(desired);
    const extras = installed.entries.filter((entry) => {
      if (names.has(entry.name.toLowerCase())) return false;
      return !desired.sources.some(
        (source) => source.skills === "*" && entryMatchesSource(entry, source),
      );
    });
    for (const entry of extras) {
      if (entry.manageable === false) {
        actions.push({
          kind: "warning",
          source: entry.source,
          ...(entry.ref ? { ref: entry.ref } : {}),
          skills: [entry.name],
          agents: ["*"],
          mode,
          reason: "Noncanonical backend lock entry cannot be pruned safely; remove it with skills.",
          destructive: false,
        });
        continue;
      }
      actions.push({
        kind: "remove",
        source: entry.source,
        ...(entry.ref ? { ref: entry.ref } : {}),
        skills: [entry.name],
        agents: ["*"],
        mode,
        reason:
          "Backend lock entry is absent from the manifest; removal targets all project agents.",
        args: removeArgs([entry.name]),
        destructive: true,
      });
    }
  }

  const changes = actions.filter(
    (action) => action.kind === "install" || action.kind === "restore" || action.kind === "remove",
  );
  return {
    actions,
    changes: changes.length,
    installs: actions.filter((action) => action.kind === "install").length,
    restores: actions.filter((action) => action.kind === "restore").length,
    removals: actions.filter((action) => action.kind === "remove").length,
    warnings: actions.filter((action) => action.kind === "warning").length,
  };
}
