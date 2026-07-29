import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { initTarget } from "../config.js";
import { ConfigError } from "../errors.js";
import { type OutputOptions, renderMessage } from "../output.js";

export interface InitOptions extends OutputOptions {
  agent?: string[] | undefined;
  copy?: boolean | undefined;
}

async function chooseAgents(provided?: readonly string[]): Promise<string[]> {
  if (provided && provided.length > 0) return [...new Set(provided)];
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new ConfigError(
      "Agent targets are required in a non-interactive session.",
      "Pass --agent <name> once per target, for example --agent opencode.",
    );
  }
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await readline.question("Agent IDs (comma-separated) [claude-code]: ");
    return (answer.trim() || "claude-code")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  } finally {
    readline.close();
  }
}

function validateAgents(agents: readonly string[]): void {
  if (agents.length === 0) throw new ConfigError("At least one agent is required.");
  for (const agent of agents) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(agent)) {
      throw new ConfigError(
        `Invalid agent '${agent}'.`,
        "Use a lowercase skills CLI ID such as 'claude-code', 'codex', or 'opencode'.",
      );
    }
  }
}

export async function initCommand(options: InitOptions): Promise<void> {
  const target = await initTarget();
  if (options.json && (!options.agent || options.agent.length === 0)) {
    throw new ConfigError(
      "JSON initialization requires explicit agent targets.",
      "Pass --agent <name> once per target.",
    );
  }
  const agents = await chooseAgents(options.agent);
  validateAgents(agents);
  const mode = options.copy ? "copy" : "symlink";
  const content =
    `# Skillstate manifest. Documentation: https://github.com/adaviscourt/skillstate#manifest\n` +
    `schema = 1\n\n` +
    `[install]\n` +
    `agents = [${agents.map((agent) => JSON.stringify(agent)).join(", ")}]\n` +
    `mode = ${JSON.stringify(mode)}\n\n` +
    `# Add your first dependency with:\n` +
    `# skillstate add owner/repo --skill skill-name\n`;
  await writeFile(target, content, { encoding: "utf8", flag: "wx" });
  renderMessage(
    "init",
    `Created ${target}\nNext: run 'skillstate add <source> --skill <name>'.`,
    options,
    {
      manifest: target,
      agents,
      mode,
    },
  );
}
