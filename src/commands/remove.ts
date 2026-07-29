import {
  listBackendAgents,
  observeSkills,
  removeArgs,
  runBackend,
  validateAgentTargets,
} from "../backend.js";
import { loadConfig } from "../config.js";
import { ConfigError, SkillstateError } from "../errors.js";
import { readLock } from "../lock.js";
import { removeFromManifest, validateManifestRemoval } from "../manifest-editor.js";
import { renderMessage } from "../output.js";
import type { CommonOptions } from "./shared.js";

export interface RemoveOptions extends CommonOptions {
  dryRun?: boolean;
}

export async function removeCommand(name: string, options: RemoveOptions): Promise<void> {
  const state = await loadConfig({ configPath: options.config });
  if (options.agent && options.agent.length > 0) {
    throw new ConfigError(
      "remove does not accept an agent override when deleting shared project intent.",
      "Remove the dependency from every configured agent, or edit install.agents first.",
    );
  }
  const args = removeArgs([name]);
  await validateManifestRemoval(state.manifestPath, name);
  if (options.dryRun) {
    renderMessage("remove", `Would remove ${name}.`, options, {
      skill: name,
      agents: ["*"],
      backendArgs: args,
      manifest: state.manifestPath,
      status: "dry-run",
    });
    return;
  }
  const allAgents = await listBackendAgents();
  await validateAgentTargets(state.projectRoot, allAgents);
  await observeSkills(state.projectRoot, allAgents, options.verbose);
  await runBackend(args, { cwd: state.projectRoot, verbose: options.verbose });
  const locked = await readLock(state.projectRoot);
  const observed = await observeSkills(state.projectRoot, allAgents, options.verbose);
  const remainsLocked = locked.entries.some(
    (entry) => entry.name.toLowerCase() === name.toLowerCase(),
  );
  const remainsObserved = Object.values(observed)
    .flat()
    .some((entry) => entry.name.toLowerCase() === name.toLowerCase());
  if (remainsLocked || remainsObserved) {
    throw new SkillstateError(
      `Backend reported success, but '${name}' remains installed or locked.`,
      { hint: "Run with --verbose and inspect the skills CLI output." },
    );
  }
  await removeFromManifest(state.manifestPath, name);
  renderMessage("remove", `Removed ${name}.`, options, {
    skill: name,
    manifest: state.manifestPath,
  });
}
