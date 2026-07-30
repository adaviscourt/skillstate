import { spawn } from "node:child_process";
import { type Dirent, realpathSync } from "node:fs";
import { access, lstat, readdir, readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BackendError, SkillstateError } from "./errors.js";
import type { InstallMode, ObservedSkill } from "./model.js";

const require = createRequire(import.meta.url);
const SUPPORTED_SKILLS_VERSION = "1.5.20";

interface SkillsPackage {
  version: string;
  bin: string | Record<string, string>;
}

export interface BackendRunOptions {
  cwd: string;
  verbose?: boolean | undefined;
  stdio?: "inherit" | "pipe" | undefined;
}

export interface BackendResult {
  stdout: string;
  stderr: string;
}

export interface BackendInfo {
  version: string;
  binPath: string;
  packageRoot: string;
}

function assertSafeValue(value: string, label: string, allowWildcard = false): void {
  if (allowWildcard && value === "*") return;
  const unsafeControl = [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127;
  });
  if (!value || value.startsWith("-") || unsafeControl) {
    throw new SkillstateError(`Unsafe ${label} '${value}'.`);
  }
}

function assertCanonicalSkill(value: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new SkillstateError(`Unsafe skill name '${value}'.`);
  }
}

export function addArgs(input: {
  source: string;
  skills: readonly string[] | "*";
  agents: readonly string[];
  mode: InstallMode;
}): string[] {
  assertSafeValue(input.source, "source");
  for (const skill of input.skills === "*" ? ["*"] : input.skills) {
    if (skill !== "*") assertCanonicalSkill(skill);
  }
  for (const agent of input.agents) assertSafeValue(agent, "agent name");
  return [
    "add",
    input.source,
    "--skill",
    ...(input.skills === "*" ? ["*"] : input.skills),
    "--agent",
    ...input.agents,
    ...(input.mode === "copy" ? ["--copy"] : []),
    "--yes",
  ];
}

export function removeArgs(skills: readonly string[], agents?: readonly string[]): string[] {
  for (const skill of skills) assertCanonicalSkill(skill);
  for (const agent of agents ?? []) assertSafeValue(agent, "agent name");
  return [
    "remove",
    ...skills,
    ...(agents && agents.length > 0 ? ["--agent", ...agents] : []),
    "--yes",
  ];
}

export function updateArgs(skills: readonly string[]): string[] {
  for (const skill of skills) assertCanonicalSkill(skill);
  return ["update", ...skills, "--project", "--yes"];
}

export function quoteCommand(args: readonly string[]): string {
  return ["skills", ...args]
    .map((arg) => (/^[A-Za-z0-9_./:@#=-]+$/.test(arg) ? arg : JSON.stringify(arg)))
    .join(" ");
}

export function resolveBackend(): BackendInfo {
  let packagePath: string;
  try {
    packagePath = require.resolve("skills/package.json");
  } catch (error) {
    throw new BackendError(
      "Cannot resolve the bundled skills CLI.",
      "Reinstall skillstate with your package manager.",
      error,
    );
  }
  const packageData = require(packagePath) as SkillsPackage;
  if (packageData.version !== SUPPORTED_SKILLS_VERSION) {
    throw new BackendError(
      `Unsupported skills CLI version ${packageData.version}; expected 1.5.20.`,
      "Install a compatible Skillstate release or restore its lockfile.",
    );
  }
  const relativeBin =
    typeof packageData.bin === "string" ? packageData.bin : packageData.bin.skills;
  if (!relativeBin) throw new BackendError("The installed skills package has no 'skills' binary.");
  return {
    version: packageData.version,
    binPath: path.resolve(path.dirname(packagePath), relativeBin),
    packageRoot: path.dirname(packagePath),
  };
}

let agentDirectories: Promise<ReadonlyMap<string, string>> | undefined;

async function readAgentDirectories(): Promise<ReadonlyMap<string, string>> {
  if (agentDirectories) return agentDirectories;
  agentDirectories = (async () => {
    const { packageRoot } = resolveBackend();
    const readme = await readFile(path.join(packageRoot, "README.md"), "utf8");
    const agentTable =
      /<!-- supported-agents:start -->([\s\S]*?)<!-- supported-agents:end -->/.exec(readme)?.[1];
    if (!agentTable) {
      throw new BackendError("Cannot locate the generated agent table in the bundled skills CLI.");
    }
    const directories = new Map<string, string>();
    for (const line of agentTable.split(/\r?\n/)) {
      if (!line.startsWith("|")) continue;
      const columns = line
        .split("|")
        .slice(1, -1)
        .map((column) => column.trim());
      const ids = [...(columns[1] ?? "").matchAll(/`([^`]+)`/g)].map((match) => match[1]);
      const projectDirectory = /`([^`]+)`/.exec(columns[2] ?? "")?.[1];
      if (
        !projectDirectory ||
        path.isAbsolute(projectDirectory) ||
        projectDirectory.includes("..")
      ) {
        continue;
      }
      for (const id of ids) if (id) directories.set(id, projectDirectory);
    }
    if (directories.size === 0) {
      throw new BackendError("Cannot read agent project paths from the bundled skills CLI.");
    }
    return directories;
  })();
  return agentDirectories;
}

export async function listBackendAgents(): Promise<readonly string[]> {
  return [...(await readAgentDirectories()).keys()].sort();
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

async function nearestExistingPath(candidate: string): Promise<string> {
  let current = candidate;
  while (true) {
    if (await lstat(current).catch(() => undefined)) return current;
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
}

function backendSafeName(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._]+/g, "-")
      .replace(/^[.-]+|[.-]+$/g, "")
      .slice(0, 255) || "unnamed-skill"
  );
}

async function validateEveSubagentTargets(cwd: string, canonicalRoot: string): Promise<void> {
  const subagentsDirectory = path.resolve(cwd, "agent", "subagents");
  const ancestor = await nearestExistingPath(subagentsDirectory);
  if (!isInside(canonicalRoot, await realpath(ancestor))) {
    throw new BackendError("Eve subagent targets resolve outside the project.");
  }
  let entries: Dirent[];
  try {
    entries = await readdir(subagentsDirectory, { withFileTypes: true });
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (code === "ENOENT") return;
    throw new BackendError("Cannot inspect Eve subagent targets.", undefined, error);
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const target = path.join(subagentsDirectory, backendSafeName(entry.name), "skills");
    const targetAncestor = await nearestExistingPath(target);
    if (!isInside(canonicalRoot, await realpath(targetAncestor))) {
      throw new BackendError(
        `Eve subagent target '${entry.name}' resolves outside the project.`,
        "Replace the external symlink before removing project skills.",
      );
    }
  }
}

export async function validateAgentTargets(cwd: string, agents: readonly string[]): Promise<void> {
  const directories = await readAgentDirectories();
  const canonicalRoot = await realpath(cwd);
  const canonicalDirectory = directories.get("universal");
  const targets = new Set<string>();
  if (canonicalDirectory) targets.add(canonicalDirectory);
  for (const agent of agents) {
    const directory = directories.get(agent);
    if (!directory) {
      throw new BackendError(
        `Agent '${agent}' is not supported by skills@${SUPPORTED_SKILLS_VERSION}.`,
      );
    }
    targets.add(directory);
  }
  for (const relativeDirectory of targets) {
    const target = path.resolve(cwd, relativeDirectory);
    const ancestor = await nearestExistingPath(target);
    const canonicalAncestor = await realpath(ancestor);
    if (!isInside(canonicalRoot, canonicalAncestor)) {
      throw new BackendError(
        `Agent target '${relativeDirectory}' resolves outside the project.`,
        "Replace the external symlink before installing or removing project skills.",
      );
    }
  }
  if (agents.includes("eve")) await validateEveSubagentTargets(cwd, canonicalRoot);
}

export async function observeSkills(
  cwd: string,
  agents: readonly string[],
  verbose = false,
): Promise<Readonly<Record<string, readonly ObservedSkill[]>>> {
  const directories = await readAgentDirectories();
  await validateAgentTargets(cwd, agents);
  const canonicalRoot = await realpath(cwd);
  const observations = await Promise.all(
    agents.map(async (agent) => {
      assertSafeValue(agent, "agent name");
      const relativeDirectory = directories.get(agent);
      if (!relativeDirectory) {
        throw new BackendError(
          `Agent '${agent}' is not supported by skills@${SUPPORTED_SKILLS_VERSION}.`,
        );
      }
      const directory = path.resolve(cwd, relativeDirectory);
      let entries: Dirent[];
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        const code = error instanceof Error && "code" in error ? error.code : undefined;
        if (code === "ENOENT") return [agent, []] as const;
        throw new BackendError(`Cannot inspect skills for agent '${agent}'.`, undefined, error);
      }
      const skills: ObservedSkill[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.name)) continue;
        const skillPath = path.join(directory, entry.name);
        try {
          await access(path.join(skillPath, "SKILL.md"));
          const canonicalSkillPath = await realpath(skillPath);
          if (!isInside(canonicalRoot, canonicalSkillPath)) {
            throw new BackendError(
              `Skill '${entry.name}' for agent '${agent}' resolves outside the project.`,
            );
          }
          skills.push({ name: entry.name, path: skillPath });
        } catch (error) {
          if (error instanceof BackendError) throw error;
        }
      }
      if (verbose) process.stderr.write(`observe: ${agent} -> ${relativeDirectory}\n`);
      return [agent, skills] as const;
    }),
  );
  return Object.fromEntries(observations);
}

export async function runBackend(
  args: readonly string[],
  options: BackendRunOptions,
): Promise<BackendResult> {
  const backend = resolveBackend();
  if (options.verbose) process.stderr.write(`backend: ${quoteCommand(args)}\n`);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [backend.binPath, ...args], {
      cwd: options.cwd,
      env: { ...process.env, DISABLE_TELEMETRY: "1" },
      shell: false,
      stdio: options.stdio === "inherit" ? "inherit" : ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    if (child.stdout) child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    if (child.stderr) child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.once("error", (error) =>
      reject(new SkillstateError("Failed to start skills CLI.", { cause: error })),
    );
    child.once("close", (code, signal) => {
      if (code === 0) return resolve({ stdout, stderr });
      const detail = stderr.trim() || stdout.trim();
      reject(
        new SkillstateError(
          `skills CLI failed${signal ? ` with signal ${signal}` : ` with exit code ${code ?? 1}`}${detail ? `: ${detail}` : "."}`,
        ),
      );
    });
  });
}

export function isMainModule(metaUrl: string): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(metaUrl));
  } catch {
    return path.resolve(entry) === path.resolve(fileURLToPath(metaUrl));
  }
}
