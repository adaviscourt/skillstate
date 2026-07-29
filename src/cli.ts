#!/usr/bin/env node
import { createRequire } from "node:module";
import { Command, CommanderError, Option } from "commander";
import { isMainModule } from "./backend.js";
import { addCommand } from "./commands/add.js";
import { checkCommand } from "./commands/check.js";
import { initCommand } from "./commands/init.js";
import { listCommand } from "./commands/list.js";
import { removeCommand } from "./commands/remove.js";
import type { CommonOptions } from "./commands/shared.js";
import { syncCommand } from "./commands/sync.js";
import { updateCommand } from "./commands/update.js";
import { SkillstateError } from "./errors.js";
import { EXIT_CONFIG, EXIT_FAILURE } from "./model.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function commonOptions(command: Command): CommonOptions {
  return command.optsWithGlobals<CommonOptions>();
}

function withAgentOption(command: Command): Command {
  return command.option("-a, --agent <name>", "override an agent target; repeatable", collect);
}

function withInstallOptions(command: Command): Command {
  return withAgentOption(command)
    .addOption(new Option("--mode <mode>", "override install mode").choices(["symlink", "copy"]))
    .option("--copy", "shortcut for --mode copy");
}

export function createProgram(): Command {
  const program = new Command();
  program
    .name("skillstate")
    .description("Declarative project skill environments powered by skills.sh.")
    .version(version)
    .option("--config <path>", "use another skillstate.toml")
    .option("--json", "write stable machine-readable JSON to stdout")
    .option("--verbose", "show backend commands and planning reasons")
    .configureHelp({ showGlobalOptions: true })
    .showHelpAfterError("\nRun 'skillstate <command> --help' for examples.")
    .addHelpText(
      "after",
      `\nQuick start:\n  $ skillstate init --agent opencode\n  $ skillstate add owner/repo --skill skill-name --dry-run\n  $ skillstate add owner/repo --skill skill-name\n\nExit codes:\n  0 success  1 failure  2 invalid config  3 drift  4 backend incompatibility\n`,
    );

  const init = program
    .command("init")
    .description("create a documented starter manifest at the Git root")
    .option("-a, --agent <name>", "agent target; repeatable", collect)
    .option("--copy", "default to copied installations instead of symlinks")
    .addHelpText(
      "after",
      "\nExamples:\n  $ skillstate init --agent claude-code --agent opencode\n  $ skillstate init --agent codex --copy\n",
    );
  init.action(async () => initCommand(commonOptions(init)));

  const sync = withInstallOptions(program.command("sync"))
    .description("reconcile declared skills through the bundled skills CLI")
    .option("--dry-run", "print the deterministic plan without mutation")
    .option("--prune", "remove lock entries absent from the manifest (requires confirmation)")
    .option("-y, --yes", "skip destructive prune confirmation")
    .addHelpText(
      "after",
      "\nExamples:\n  $ skillstate sync --dry-run\n  $ skillstate sync --agent opencode --copy\n  $ skillstate sync --prune --yes\n\nNormal sync never removes undeclared skills.\n",
    );
  sync.action(async () => syncCommand({ ...commonOptions(sync), ...sync.opts() }));

  const check = withAgentOption(program.command("check"))
    .description("validate configuration and detect manifest-to-lock drift without mutation")
    .addHelpText(
      "after",
      "\nExample:\n  $ skillstate check --json\n\nExits 3 when a declared skill is missing or locked to another source/ref.\n",
    );
  check.action(async () => checkCommand(commonOptions(check)));

  const list = withAgentOption(program.command("list"))
    .alias("ls")
    .description("show desired, locked, and unmanaged skill state")
    .addHelpText("after", "\nExamples:\n  $ skillstate list\n  $ skillstate list --json\n");
  list.action(async () => listCommand(commonOptions(list)));

  const add = withInstallOptions(program.command("add <source>"))
    .description("install a skill, then add it to the manifest without reformatting the file")
    .option("-s, --skill <name>", "skill name; repeatable, or '*'", collect)
    .option("--ref <ref>", "repository branch or tag")
    .option("--dry-run", "show backend argv and manifest intent without mutation")
    .addHelpText(
      "after",
      `\nExamples:\n  $ skillstate add vercel-labs/agent-skills --skill web-design-guidelines\n  $ skillstate add owner/repo --ref v1 --skill review --skill test\n  $ skillstate add ./skills/internal-review --skill internal-review\n  $ skillstate add owner/repo --skill '*'\n`,
    );
  add.action(async (source: string) =>
    addCommand(source, { ...commonOptions(add), ...add.opts() }),
  );

  const remove = program
    .command("remove <name>")
    .alias("rm")
    .description("remove a managed installation, then update the manifest in place")
    .option("--dry-run", "show backend argv and manifest intent without mutation")
    .addHelpText(
      "after",
      "\nExample:\n  $ skillstate remove web-design-guidelines\n\nWildcard declarations must be made explicit before removing one skill.\n",
    );
  remove.action(async (name: string) =>
    removeCommand(name, { ...commonOptions(remove), ...remove.opts() }),
  );

  const update = withInstallOptions(program.command("update [names...]"))
    .description("intentionally refresh all or selected declared project skills")
    .addHelpText(
      "after",
      "\nExamples:\n  $ skillstate update\n  $ skillstate update review test\n\nNamed updates affect explicit declarations only. A full update also rediscovers wildcard sources.\n",
    );
  update.action(async (names: string[]) => updateCommand(names, commonOptions(update)));

  return program;
}

export async function main(argv = process.argv): Promise<number> {
  const program = createProgram().exitOverride();
  const json = argv.includes("--json");
  const command =
    argv
      .slice(2)
      .find((value) =>
        ["init", "sync", "check", "list", "ls", "add", "remove", "rm", "update"].includes(value),
      ) ?? null;
  if (json) program.configureOutput({ writeErr: () => undefined });
  try {
    await program.parseAsync(argv);
    return Number(process.exitCode ?? 0);
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.exitCode === 0) return 0;
      if (json) {
        process.stdout.write(
          `${JSON.stringify(
            { schema: 1, command, status: "error", error: error.message, hint: null },
            null,
            2,
          )}\n`,
        );
      }
      return EXIT_CONFIG;
    }
    const normalized =
      error instanceof SkillstateError
        ? error
        : new SkillstateError(error instanceof Error ? error.message : String(error));
    if (json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            schema: 1,
            command,
            status: "error",
            error: normalized.message,
            hint: normalized.hint ?? null,
          },
          null,
          2,
        )}\n`,
      );
    } else {
      process.stderr.write(`error: ${normalized.message}\n`);
      if (normalized.hint) process.stderr.write(`hint: ${normalized.hint}\n`);
    }
    return normalized.exitCode ?? EXIT_FAILURE;
  }
}

if (isMainModule(import.meta.url)) process.exitCode = await main();
