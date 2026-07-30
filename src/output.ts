import path from "node:path";
import { quoteCommand } from "./backend.js";
import type { DesiredState, InstalledState, Plan, PlanAction } from "./model.js";
import { entryMatchesSource } from "./planner.js";

export interface OutputOptions {
  json?: boolean | undefined;
  verbose?: boolean | undefined;
}

function actionLabel(action: PlanAction): string {
  switch (action.kind) {
    case "install":
      return "+ install";
    case "restore":
      return "+ restore";
    case "remove":
      return "- remove ";
    case "warning":
      return "! note   ";
    case "noop":
      return "= ready  ";
  }
}

function printableAction(action: PlanAction) {
  return {
    kind: action.kind,
    source: action.source ?? null,
    ref: action.ref ?? null,
    skills: action.skills,
    agents: action.agents,
    mode: action.mode,
    reason: action.reason,
    destructive: action.destructive,
    backendArgs: action.args ?? null,
  };
}

export function renderPlan(
  command: string,
  state: DesiredState,
  plan: Plan,
  options: OutputOptions,
  status?: string,
): void {
  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          schema: 1,
          command,
          status: status ?? (plan.changes > 0 ? "changes" : "ready"),
          manifest: state.manifestPath,
          projectRoot: state.projectRoot,
          actions: plan.actions.map(printableAction),
          summary: {
            changes: plan.changes,
            installs: plan.installs,
            restores: plan.restores,
            removals: plan.removals,
            warnings: plan.warnings,
          },
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  process.stdout.write(
    `Manifest: ${path.relative(process.cwd(), state.manifestPath) || state.manifestPath}\n`,
  );
  const visible = plan.actions.filter((action) => options.verbose || action.kind !== "noop");
  if (visible.length === 0) {
    process.stdout.write("State: ready (no changes)\n");
    return;
  }
  for (const action of visible) {
    const source = action.source
      ? ` from ${action.source}${action.ref ? `#${action.ref}` : ""}`
      : "";
    process.stdout.write(`${actionLabel(action)} ${action.skills.join(", ")}${source}\n`);
    if (options.verbose) {
      process.stdout.write(`          ${action.reason}\n`);
      if (action.args) process.stdout.write(`          ${quoteCommand(action.args)}\n`);
    }
  }
  process.stdout.write(
    `Summary: ${plan.installs} install, ${plan.restores} restore, ${plan.removals} remove, ${plan.warnings} note\n`,
  );
}

export function renderList(
  state: DesiredState,
  installed: InstalledState,
  plan: Plan,
  options: OutputOptions,
): void {
  const rows = state.sources.flatMap((source) => {
    const matchingEntries = installed.entries.filter((entry) => entryMatchesSource(entry, source));
    const names =
      source.skills === "*"
        ? matchingEntries.length > 0
          ? matchingEntries.map((entry) => entry.name)
          : ["*"]
        : source.skills;
    return names.map((name) => {
      const installedEntry = matchingEntries.find(
        (entry) => entry.name.toLowerCase() === name.toLowerCase(),
      );
      const observed = Object.values(installed.observed).every((agentSkills) =>
        agentSkills.some((entry) => entry.name.toLowerCase() === name.toLowerCase()),
      );
      return {
        name,
        source: source.displaySource,
        ref: source.ref ?? null,
        installed: installedEntry !== undefined && observed,
        lockedSource: installedEntry?.source ?? null,
      };
    });
  });
  const unmanaged = installed.entries
    .filter(
      (entry) =>
        !state.sources.some(
          (source) =>
            entryMatchesSource(entry, source) &&
            (source.skills === "*" ||
              source.skills.some((name) => name.toLowerCase() === entry.name.toLowerCase())),
        ),
    )
    .map((entry) => ({ name: entry.name, source: entry.source }));

  if (options.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          schema: 1,
          command: "list",
          status: plan.changes > 0 ? "drift" : "ready",
          manifest: state.manifestPath,
          desired: rows,
          unmanaged,
          summary: { desired: rows.length, installed: installed.entries.length },
        },
        null,
        2,
      )}\n`,
    );
    return;
  }

  process.stdout.write("DESIRED  STATE    SOURCE\n");
  for (const row of rows) {
    const name = row.name.padEnd(8);
    const status = (row.installed ? "locked" : "missing").padEnd(8);
    process.stdout.write(`${name} ${status} ${row.source}${row.ref ? `#${row.ref}` : ""}\n`);
  }
  if (unmanaged.length > 0) {
    process.stdout.write(`\nUnmanaged lock entries (${unmanaged.length}):\n`);
    for (const entry of unmanaged) process.stdout.write(`  ${entry.name} (${entry.source})\n`);
  }
}

export function renderMessage(
  command: string,
  message: string,
  options: OutputOptions,
  data: Record<string, unknown> = {},
): void {
  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({ schema: 1, command, status: "success", ...data }, null, 2)}\n`,
    );
  } else {
    process.stdout.write(`${message}\n`);
  }
}
