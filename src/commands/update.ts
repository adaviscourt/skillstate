import { addArgs, observeSkills, runBackend, validateAgentTargets } from "../backend.js";
import { effectiveInstall, loadConfig, sourceWithRef } from "../config.js";
import { ConfigError, SkillstateError } from "../errors.js";
import { renderMessage } from "../output.js";
import type { CommonOptions } from "./shared.js";
import { projectState } from "./shared.js";

export async function updateCommand(
  names: readonly string[],
  options: CommonOptions,
): Promise<void> {
  const state = await loadConfig({ configPath: options.config });
  const declared = new Set(
    state.sources
      .flatMap((source) => (source.skills === "*" ? [] : source.skills))
      .map((name) => name.toLowerCase()),
  );
  for (const name of names) {
    if (!declared.has(name.toLowerCase())) {
      throw new ConfigError(
        `Skill '${name}' is not explicitly declared.`,
        "Run 'skillstate list' to see declared skills. Wildcard sources can only be updated as a group.",
      );
    }
  }
  const { agents, mode } = effectiveInstall(state, {
    ...(options.agent ? { agents: options.agent } : {}),
    ...(options.copy ? { mode: "copy" } : options.mode ? { mode: options.mode } : {}),
  });
  await validateAgentTargets(state.projectRoot, agents);
  await observeSkills(state.projectRoot, agents, options.verbose);
  for (const source of state.sources) {
    const selection =
      source.skills === "*"
        ? names.length === 0
          ? "*"
          : []
        : names.length === 0
          ? source.skills
          : source.skills.filter((name) =>
              names.some((selected) => selected.toLowerCase() === name.toLowerCase()),
            );
    if (selection !== "*" && selection.length === 0) continue;
    await runBackend(addArgs({ source: sourceWithRef(source), skills: selection, agents, mode }), {
      cwd: state.projectRoot,
      verbose: options.verbose,
    });
  }
  const verified = await projectState({ ...options, copy: false, mode: undefined });
  if (verified.plan.changes > 0) {
    throw new SkillstateError(
      `Backend reported success, but ${verified.plan.changes} declared change${verified.plan.changes === 1 ? " remains" : "s remain"}.`,
      { hint: "Run 'skillstate sync --dry-run --verbose' to inspect remaining drift." },
    );
  }
  const explicitNames =
    names.length > 0
      ? names
      : state.sources.flatMap((source) => (source.skills === "*" ? [] : source.skills));
  renderMessage(
    "update",
    names.length > 0 ? `Updated ${names.join(", ")}.` : "Updated project skills.",
    options,
    {
      skills: explicitNames,
      manifest: state.manifestPath,
    },
  );
}
