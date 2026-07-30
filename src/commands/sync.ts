import path from "node:path";
import { listBackendAgents, observeSkills, validateAgentTargets } from "../backend.js";
import { MANIFEST_NAME } from "../config.js";
import { ConfigError, SkillstateError } from "../errors.js";
import { renderMessage, renderPlan } from "../output.js";
import type { CommonOptions } from "./shared.js";
import { confirmDestructive, executePlan, projectState } from "./shared.js";

export interface SyncOptions extends CommonOptions {
  dryRun?: boolean;
  prune?: boolean;
}

export async function syncCommand(options: SyncOptions): Promise<void> {
  const { state, plan } = await projectState(options, { prune: options.prune ?? false });
  if (
    options.prune &&
    path.resolve(state.manifestPath) !== path.resolve(state.projectRoot, MANIFEST_NAME)
  ) {
    throw new ConfigError(
      "Pruning is unavailable with an alternate manifest.",
      "Run prune from the root manifest because alternate manifests share project lock state.",
    );
  }
  if (options.dryRun) {
    renderPlan("sync", state, plan, options, "dry-run");
    return;
  }
  if (plan.removals > 0) {
    if (!options.json) renderPlan("sync", state, plan, options, "planned");
    if (options.json && !options.yes) {
      throw new SkillstateError("JSON prune requires explicit confirmation.", {
        hint: "Review with --dry-run --json, then rerun with --yes --json.",
      });
    }
    await confirmDestructive(
      `Remove ${plan.removals} unmanaged lock entr${plan.removals === 1 ? "y" : "ies"}?`,
      options.yes,
    );
  } else if (!options.json) {
    renderPlan("sync", state, plan, options, "planned");
  }
  if (plan.removals > 0) {
    const allAgents = await listBackendAgents();
    await validateAgentTargets(state.projectRoot, allAgents);
    await observeSkills(state.projectRoot, allAgents, options.verbose);
  }
  await executePlan(state, plan, options);
  const verified = await projectState(
    { ...options, copy: false, mode: undefined },
    { prune: options.prune ?? false },
  );
  if (verified.plan.changes > 0) {
    throw new SkillstateError(
      `Backend reported success, but ${verified.plan.changes} planned change${verified.plan.changes === 1 ? " remains" : "s remain"}.`,
      { hint: "Run 'skillstate sync --dry-run --verbose' to inspect remaining drift." },
    );
  }
  if (options.prune && plan.removals > 0) {
    const removedNames = new Set(
      plan.actions
        .filter((action) => action.kind === "remove")
        .flatMap((action) => action.skills)
        .map((name) => name.toLowerCase()),
    );
    const allObserved = await observeSkills(
      state.projectRoot,
      await listBackendAgents(),
      options.verbose,
    );
    const stale = Object.values(allObserved)
      .flat()
      .find((skill) => removedNames.has(skill.name.toLowerCase()));
    if (stale) {
      throw new SkillstateError(
        `Backend reported success, but pruned skill '${stale.name}' remains in a project agent.`,
        { hint: "Run 'skills remove' directly with --verbose diagnostics, then retry." },
      );
    }
  }
  if (options.json) renderPlan("sync", state, plan, options, "synced");
  else if (plan.changes > 0) renderMessage("sync", "Sync complete.", options);
}
