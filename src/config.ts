import { access, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { parse } from "smol-toml";
import { z } from "zod";
import { ConfigError } from "./errors.js";
import type { DesiredSource, DesiredState, InstallMode } from "./model.js";

export const MANIFEST_NAME = "skillstate.toml";

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127;
  });
}

const safeText = z
  .string()
  .min(1)
  .refine((value) => !containsControlCharacter(value), "must not contain control characters")
  .refine((value) => !value.startsWith("-"), "must not begin with '-'");

const agentName = safeText.regex(
  /^[a-z0-9][a-z0-9-]*$/,
  "must use a lowercase skills CLI agent ID",
);

const skillName = safeText.regex(
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  "must be a canonical lowercase kebab-case skill ID",
);

const sourceSchema = z
  .object({
    source: safeText
      .refine((value) => !value.includes("#"), "must put refs in the 'ref' field")
      .refine(
        (value) => value.startsWith("git@") || value.startsWith("ssh://") || !value.includes("@"),
        "must select skills with the 'skills' field, not source@skill syntax",
      )
      .refine(
        (value) => !["coinbase/agentWallet", "vercel-labs/vercel-skills"].includes(value),
        "must use the canonical repository rather than an upstream source alias",
      ),
    ref: safeText
      .refine(
        (value) =>
          !/[#@ ~^:?*[\\]/.test(value) &&
          !value.includes("..") &&
          !value.includes("@{") &&
          !value.includes("%") &&
          !value.includes("//") &&
          !value.startsWith("/") &&
          !value.endsWith("/") &&
          !value.endsWith(".") &&
          value.split("/").every((part) => !part.startsWith(".") && !part.endsWith(".lock")),
        "must be an unambiguous Git branch or tag",
      )
      .optional(),
    skills: z.union([z.literal("*"), z.array(skillName).min(1)]),
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.ref && /(?:\/tree\/|\/-\/tree\/)/.test(entry.source)) {
      context.addIssue({
        code: "custom",
        path: ["ref"],
        message: "must not be combined with a tree URL that already embeds a ref",
      });
    }
  });

const manifestSchema = z
  .object({
    schema: z.literal(1),
    install: z
      .object({
        agents: z.array(agentName).min(1),
        mode: z.enum(["symlink", "copy"]),
      })
      .strict(),
    sources: z.array(sourceSchema).default([]),
  })
  .strict();

export interface LoadConfigOptions {
  cwd?: string | undefined;
  configPath?: string | undefined;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function isGitRoot(directory: string): Promise<boolean> {
  return exists(path.join(directory, ".git"));
}

export async function findGitRoot(start = process.cwd()): Promise<string | undefined> {
  let current = path.resolve(start);
  while (true) {
    if (await isGitRoot(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export async function discoverManifest(start = process.cwd()): Promise<string> {
  let current = path.resolve(start);
  while (true) {
    const candidate = path.join(current, MANIFEST_NAME);
    if (await exists(candidate)) return candidate;
    if (await isGitRoot(current)) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new ConfigError(
    `No ${MANIFEST_NAME} found from ${path.resolve(start)} to the Git root.`,
    "Run 'skillstate init --agent <name>' at the project root.",
  );
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map(
      (issue) => `${issue.path.length > 0 ? issue.path.join(".") : "manifest"}: ${issue.message}`,
    )
    .join("\n");
}

function isLocalSource(source: string): boolean {
  return (
    source === "." ||
    source === ".." ||
    source.startsWith("./") ||
    source.startsWith("../") ||
    path.isAbsolute(source) ||
    /^[A-Za-z]:[\\/]/.test(source)
  );
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

async function normalizeSources(
  entries: z.infer<typeof sourceSchema>[],
  manifestDirectory: string,
  projectRoot: string,
): Promise<DesiredSource[]> {
  const combinations = new Set<string>();
  const skillOwners = new Map<string, number>();
  const wildcardIndexes = entries
    .map((entry, index) => (entry.skills === "*" ? index : undefined))
    .filter((index): index is number => index !== undefined);
  if (wildcardIndexes.length > 1 || (wildcardIndexes.length === 1 && entries.length > 1)) {
    throw new ConfigError(
      "Wildcard sources cannot be combined with other sources in schema 1.",
      "Use one wildcard source or replace '*' with explicit skill names to establish ownership.",
    );
  }
  const normalized: DesiredSource[] = [];
  const canonicalRoot = await realpath(projectRoot).catch(() => path.resolve(projectRoot));
  for (const [index, entry] of entries.entries()) {
    const local = isLocalSource(entry.source);
    const unresolvedSource = local ? path.resolve(manifestDirectory, entry.source) : entry.source;
    if (local && entry.ref) {
      throw new ConfigError(`sources.${index}.ref is not supported for local sources.`);
    }
    let source = unresolvedSource;
    if (local) {
      try {
        source = await realpath(unresolvedSource);
      } catch (error) {
        throw new ConfigError(
          `sources.${index}.source does not exist: ${entry.source}`,
          "Create the local skill directory before declaring it.",
          error,
        );
      }
    }
    if (local && !isInside(canonicalRoot, source)) {
      throw new ConfigError(
        `sources.${index}.source resolves outside the project: ${entry.source}`,
        "Move the skill under the Git root. External local sources are intentionally rejected.",
      );
    }

    const skills = entry.skills === "*" ? "*" : [...new Set(entry.skills)].sort();
    if (entry.skills !== "*" && skills.length !== entry.skills.length) {
      throw new ConfigError(`sources.${index}.skills contains duplicate names.`);
    }
    const selected = skills === "*" ? ["*"] : skills;
    for (const skill of selected) {
      const key = `${source}\0${entry.ref ?? ""}\0${skill}`.toLowerCase();
      if (combinations.has(key)) {
        throw new ConfigError(
          `Duplicate source/ref/skill combination at sources.${index}: ${entry.source} (${skill}).`,
        );
      }
      combinations.add(key);
      if (skill !== "*") {
        const normalizedSkill = skill.toLowerCase();
        const previousOwner = skillOwners.get(normalizedSkill);
        if (previousOwner !== undefined) {
          throw new ConfigError(
            `Skill '${skill}' is declared by both sources.${previousOwner} and sources.${index}.`,
            "Each explicit skill name must have one source because the backend lock is keyed by name.",
          );
        }
        skillOwners.set(normalizedSkill, index);
      }
    }

    normalized.push({
      source,
      displaySource: entry.source,
      ...(entry.ref === undefined ? {} : { ref: entry.ref }),
      skills,
    });
  }
  return normalized;
}

function parseManifest(contents: string, manifestPath: string): z.infer<typeof manifestSchema> {
  let parsed: unknown;
  try {
    parsed = parse(contents);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ConfigError(`Invalid TOML in ${manifestPath}: ${detail}`, undefined, error);
  }
  const result = manifestSchema.safeParse(parsed);
  if (!result.success) {
    throw new ConfigError(`Invalid ${MANIFEST_NAME}:\n${formatIssues(result.error)}`);
  }
  return result.data;
}

export async function validateManifestContents(
  contents: string,
  manifestPath: string,
): Promise<void> {
  const data = parseManifest(contents, manifestPath);
  const manifestDirectory = path.dirname(manifestPath);
  const projectRoot = (await findGitRoot(manifestDirectory)) ?? manifestDirectory;
  await normalizeSources(data.sources, manifestDirectory, projectRoot);
}

export async function loadConfig(options: LoadConfigOptions = {}): Promise<DesiredState> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const manifestPath = options.configPath
    ? path.resolve(cwd, options.configPath)
    : await discoverManifest(cwd);

  let contents: string;
  try {
    contents = await readFile(manifestPath, "utf8");
  } catch (error) {
    throw new ConfigError(`Cannot read manifest at ${manifestPath}.`, undefined, error);
  }

  const data = parseManifest(contents, manifestPath);

  const manifestDirectory = path.dirname(manifestPath);
  const gitRoot = await findGitRoot(manifestDirectory);
  const projectRoot = gitRoot ?? manifestDirectory;
  if (gitRoot && !isInside(gitRoot, manifestPath)) {
    throw new ConfigError(`Manifest is outside the project root: ${manifestPath}`);
  }

  return {
    schema: 1,
    agents: [...new Set(data.install.agents)],
    mode: data.install.mode,
    sources: await normalizeSources(data.sources, manifestDirectory, projectRoot),
    manifestPath,
    projectRoot,
  };
}

export async function initTarget(cwd = process.cwd()): Promise<string> {
  const root = await findGitRoot(cwd);
  if (!root) {
    throw new ConfigError(
      "Cannot initialize Skillstate outside a Git repository.",
      "Run 'git init' or move into an existing repository first.",
    );
  }
  const target = path.join(root, MANIFEST_NAME);
  try {
    const info = await stat(target);
    if (info.isFile()) {
      throw new ConfigError(
        `${target} already exists.`,
        "Edit it or pass --config to other commands.",
      );
    }
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (code !== "ENOENT") throw error;
  }
  return target;
}

export function effectiveInstall(
  state: DesiredState,
  overrides: { agents?: readonly string[]; mode?: InstallMode },
): { agents: readonly string[]; mode: InstallMode } {
  const agents = overrides.agents ? [...new Set(overrides.agents)] : state.agents;
  if (agents.length === 0) throw new ConfigError("At least one --agent value is required.");
  for (const agent of agents) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(agent)) {
      throw new ConfigError(
        `Invalid agent '${agent}'.`,
        "Use a skills CLI agent ID such as 'opencode'.",
      );
    }
  }
  return { agents, mode: overrides.mode ?? state.mode };
}

export function sourceWithRef(source: DesiredSource): string {
  return source.ref ? `${source.source}#${source.ref}` : source.source;
}
