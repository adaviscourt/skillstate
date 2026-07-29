import { createInterface } from "node:readline/promises";
import { observeSkills, runBackend } from "../backend.js";
import { effectiveInstall, loadConfig } from "../config.js";
import { SkillstateError } from "../errors.js";
import { readLock } from "../lock.js";
import type { DesiredState, Plan } from "../model.js";
import { createPlan } from "../planner.js";

export interface CommonOptions {
  agent?: string[] | undefined;
  config?: string | undefined;
  copy?: boolean | undefined;
  json?: boolean | undefined;
  mode?: "symlink" | "copy" | undefined;
  verbose?: boolean | undefined;
  yes?: boolean | undefined;
}

export async function projectState(
  options: CommonOptions,
  extra: { prune?: boolean } = {},
): Promise<{ state: DesiredState; plan: Plan }> {
  const state = await loadConfig({ configPath: options.config });
  const mode = options.copy ? "copy" : options.mode;
  const effective = effectiveInstall(state, {
    ...(options.agent ? { agents: options.agent } : {}),
    ...(mode ? { mode } : {}),
  });
  const installed = {
    ...(await readLock(state.projectRoot)),
    observed: await observeSkills(state.projectRoot, effective.agents, options.verbose),
  };
  const plan = createPlan(state, installed, {
    ...(options.agent ? { agents: options.agent } : {}),
    ...(mode ? { mode } : {}),
    ...(extra.prune === undefined ? {} : { prune: extra.prune }),
  });
  return { state, plan };
}

export async function executePlan(
  state: DesiredState,
  plan: Plan,
  options: CommonOptions,
): Promise<void> {
  const phases = [
    plan.actions.filter((action) => action.kind === "install" || action.kind === "restore"),
    plan.actions.filter((action) => action.kind === "remove"),
  ];
  for (const [index, actions] of phases.entries()) {
    const failures: string[] = [];
    for (const action of actions) {
      if (!action.args) continue;
      try {
        await runBackend(action.args, { cwd: state.projectRoot, verbose: options.verbose });
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    }
    if (failures.length > 0) {
      throw new SkillstateError(
        `${failures.length} backend ${index === 0 ? "install/restore" : "remove"} operation${failures.length === 1 ? "" : "s"} failed:\n${failures.join("\n")}`,
      );
    }
  }
}

export async function confirmDestructive(question: string, yes = false): Promise<void> {
  if (yes) return;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new SkillstateError("Confirmation required in a non-interactive session.", {
      hint: "Review with --dry-run, then rerun with --yes.",
    });
  }
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await readline.question(`${question} [y/N] `);
    if (!/^y(?:es)?$/i.test(answer.trim())) {
      throw new SkillstateError("Cancelled.");
    }
  } finally {
    readline.close();
  }
}
