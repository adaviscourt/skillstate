import { EXIT_DRIFT } from "../model.js";
import { renderPlan } from "../output.js";
import type { CommonOptions } from "./shared.js";
import { projectState } from "./shared.js";

export async function checkCommand(options: CommonOptions): Promise<void> {
  const { state, plan } = await projectState(options);
  const drift = plan.changes > 0;
  renderPlan("check", state, plan, options, drift ? "drift" : "ready");
  if (drift) process.exitCode = EXIT_DRIFT;
}
