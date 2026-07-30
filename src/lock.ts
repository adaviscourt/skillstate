import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { BackendError, ConfigError } from "./errors.js";
import type { InstalledState } from "./model.js";

export const LOCK_NAME = "skills-lock.json";

const lockEntrySchema = z
  .object({
    source: z.string().min(1).refine(safeForDisplay, "must not contain control characters"),
    sourceUrl: z.string().refine(safeForDisplay, "must not contain control characters").optional(),
    ref: z.string().refine(safeForDisplay, "must not contain control characters").optional(),
    sourceType: z.string().min(1).refine(safeForDisplay, "must not contain control characters"),
    skillPath: z.string().refine(safeForDisplay, "must not contain control characters").optional(),
    computedHash: z.string().min(1),
    subagents: z.array(z.string()).optional(),
  })
  .passthrough();

function safeForDisplay(value: string): boolean {
  return [...value].every((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code > 31 && code !== 127;
  });
}

const lockSkillNameSchema = z
  .string()
  .min(1)
  .refine(safeForDisplay, "must not contain control characters");

const lockSchema = z
  .object({
    version: z.number().int(),
    skills: z.record(lockSkillNameSchema, lockEntrySchema),
  })
  .passthrough();

export async function readLock(projectRoot: string): Promise<InstalledState> {
  const lockPath = path.join(projectRoot, LOCK_NAME);
  let text: string;
  try {
    text = await readFile(lockPath, "utf8");
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (code === "ENOENT") return { version: 1, path: lockPath, entries: [], observed: {} };
    throw new ConfigError(`Cannot read backend lock at ${lockPath}.`, undefined, error);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new ConfigError(`Invalid JSON in backend lock at ${lockPath}.`, undefined, error);
  }
  const result = lockSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(`Invalid backend lock schema at ${lockPath}.`);
  }
  if (result.data.version !== 1) {
    throw new BackendError(
      `Unsupported ${LOCK_NAME} version ${result.data.version}; expected version 1.`,
      "Upgrade Skillstate or install a compatible skills CLI.",
    );
  }

  const entries = Object.entries(result.data.skills)
    .map(([name, entry]) => ({
      name,
      manageable: /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name),
      ...entry,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { version: 1, path: lockPath, entries, observed: {} };
}
