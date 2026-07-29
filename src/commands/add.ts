import { realpath } from "node:fs/promises";
import path from "node:path";
import { addArgs, observeSkills, runBackend, validateAgentTargets } from "../backend.js";
import { effectiveInstall, loadConfig } from "../config.js";
import { ConfigError, SkillstateError } from "../errors.js";
import { readLock } from "../lock.js";
import { addToManifest, validateManifestAdd } from "../manifest-editor.js";
import { renderMessage } from "../output.js";
import { entryMatchesSource } from "../planner.js";
import type { CommonOptions } from "./shared.js";

export interface AddOptions extends CommonOptions {
  dryRun?: boolean;
  ref?: string;
  skill?: string[];
}

function parseSelection(values?: readonly string[]): readonly string[] | "*" {
  if (!values || values.length === 0) {
    throw new ConfigError(
      "At least one skill selection is required.",
      "Pass --skill <name> (repeatable), or --skill '*' for every skill from the source.",
    );
  }
  if (values.includes("*")) {
    if (values.length !== 1) throw new ConfigError("'*' cannot be combined with named skills.");
    return "*";
  }
  for (const value of values) {
    const hasControlCharacter = [...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 31 || code === 127;
    });
    if (
      !value ||
      value.startsWith("-") ||
      value === "." ||
      value === ".." ||
      /[\\/]/.test(value) ||
      hasControlCharacter
    ) {
      throw new ConfigError(`Invalid skill name '${value}'.`);
    }
  }
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function splitRef(source: string, optionRef?: string): { source: string; ref?: string } {
  const fragment = source.indexOf("#");
  if (fragment === -1) return { source, ...(optionRef ? { ref: optionRef } : {}) };
  if (optionRef) throw new ConfigError("Specify a ref with either '#ref' or --ref, not both.");
  const ref = source.slice(fragment + 1);
  if (!ref) throw new ConfigError("Source ref cannot be empty.");
  return { source: source.slice(0, fragment), ref };
}

async function backendSource(
  source: string,
  ref: string | undefined,
  manifestPath: string,
  root: string,
): Promise<string> {
  const local =
    source === "." ||
    source === ".." ||
    source.startsWith("./") ||
    source.startsWith("../") ||
    path.isAbsolute(source);
  const unresolved = local ? path.resolve(path.dirname(manifestPath), source) : source;
  const normalized = local ? await realpath(unresolved) : source;
  if (local) {
    const canonicalRoot = await realpath(root);
    const relative = path.relative(canonicalRoot, normalized);
    if (relative === ".." || relative.startsWith(`..${path.sep}`)) {
      throw new ConfigError("Local source resolves outside the project.");
    }
  }
  return ref ? `${normalized}#${ref}` : normalized;
}

export async function addCommand(sourceArgument: string, options: AddOptions): Promise<void> {
  const state = await loadConfig({ configPath: options.config });
  const selection = parseSelection(options.skill);
  const { source, ref } = splitRef(sourceArgument, options.ref);
  await validateManifestAdd(state.manifestPath, source, ref, selection);
  const { agents, mode } = effectiveInstall(state, {
    ...(options.agent ? { agents: options.agent } : {}),
    ...(options.copy ? { mode: "copy" } : options.mode ? { mode: options.mode } : {}),
  });
  const resolvedSource = await backendSource(source, ref, state.manifestPath, state.projectRoot);
  const args = addArgs({
    source: resolvedSource,
    skills: selection,
    agents,
    mode,
  });
  if (options.dryRun) {
    renderMessage(
      "add",
      `Would add ${selection === "*" ? "all skills" : selection.join(", ")} from ${source}.`,
      options,
      {
        source,
        ref: ref ?? null,
        skills: selection,
        backendArgs: args,
        manifest: state.manifestPath,
        status: "dry-run",
      },
    );
    return;
  }
  await validateAgentTargets(state.projectRoot, agents);
  await observeSkills(state.projectRoot, agents, options.verbose);
  await runBackend(args, { cwd: state.projectRoot, verbose: options.verbose });
  const locked = await readLock(state.projectRoot);
  const observed = await observeSkills(state.projectRoot, agents, options.verbose);
  const desiredSource = {
    source: ref ? resolvedSource.slice(0, -`#${ref}`.length) : resolvedSource,
    displaySource: source,
    ...(ref ? { ref } : {}),
    skills: selection,
  };
  const matching = locked.entries.filter((entry) => entryMatchesSource(entry, desiredSource));
  const names =
    selection === "*"
      ? matching.filter((entry) => entry.manageable !== false).map((entry) => entry.name)
      : selection;
  const complete =
    matching.length > 0 &&
    names.every((name) => {
      const lockedEntry = matching.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
      return (
        lockedEntry !== undefined &&
        agents.every((agent) =>
          (observed[agent] ?? []).some((entry) => entry.name.toLowerCase() === name.toLowerCase()),
        )
      );
    });
  if (!complete) {
    throw new SkillstateError(
      "Backend reported success, but installed state does not contain every requested skill.",
      { hint: "Run with --verbose and inspect the skills CLI output." },
    );
  }
  await addToManifest(state.manifestPath, source, ref, selection);
  renderMessage(
    "add",
    `Added ${selection === "*" ? "all skills" : selection.join(", ")} from ${source}.`,
    options,
    {
      source,
      ref: ref ?? null,
      skills: selection,
      manifest: state.manifestPath,
    },
  );
}
