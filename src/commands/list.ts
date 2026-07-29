import { observeSkills } from "../backend.js";
import { effectiveInstall, loadConfig } from "../config.js";
import { readLock } from "../lock.js";
import { renderList } from "../output.js";
import { createPlan } from "../planner.js";
import type { CommonOptions } from "./shared.js";

export async function listCommand(options: CommonOptions): Promise<void> {
  const state = await loadConfig({ configPath: options.config });
  const effective = effectiveInstall(state, {
    ...(options.agent ? { agents: options.agent } : {}),
    ...(options.copy ? { mode: "copy" } : options.mode ? { mode: options.mode } : {}),
  });
  const installed = {
    ...(await readLock(state.projectRoot)),
    observed: await observeSkills(state.projectRoot, effective.agents, options.verbose),
  };
  const plan = createPlan(state, installed, {
    ...(options.agent ? { agents: options.agent } : {}),
    ...(options.copy ? { mode: "copy" } : options.mode ? { mode: options.mode } : {}),
  });
  renderList(state, installed, plan, options);
}
