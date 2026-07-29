import { chmod, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "smol-toml";
import { validateManifestContents } from "./config.js";
import { ConfigError } from "./errors.js";

interface SourceBlock {
  start: number;
  end: number;
  source: string;
  ref?: string;
  skills: string[] | "*";
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function sourceBlocks(text: string): SourceBlock[] {
  const headers = [...text.matchAll(/^\s*\[\[sources\]\]\s*(?:#.*)?$/gm)];
  return headers.map((header, index) => {
    const start = header.index ?? 0;
    const end = headers[index + 1]?.index ?? text.length;
    const block = text.slice(start, end);
    let parsed: unknown;
    try {
      parsed = parse(block);
    } catch (error) {
      throw new ConfigError("Cannot safely edit malformed [[sources]] block.", undefined, error);
    }
    const value = parsed as {
      sources?: Array<{ source?: unknown; ref?: unknown; skills?: unknown }>;
    };
    const entry = value.sources?.[0];
    if (
      typeof entry?.source !== "string" ||
      !(
        entry.skills === "*" ||
        (Array.isArray(entry.skills) && entry.skills.every((item) => typeof item === "string"))
      )
    ) {
      throw new ConfigError("Cannot safely edit a [[sources]] block with unsupported formatting.");
    }
    return {
      start,
      end,
      source: entry.source,
      ...(typeof entry.ref === "string" ? { ref: entry.ref } : {}),
      skills: entry.skills as string[] | "*",
    };
  });
}

function assignmentRange(
  blockText: string,
  key: string,
): { start: number; end: number } | undefined {
  const match = new RegExp(`^\\s*${key}\\s*=`, "m").exec(blockText);
  if (!match || match.index === undefined) return undefined;
  let valueStart = match.index + match[0].length;
  while (blockText[valueStart] === " " || blockText[valueStart] === "\t") valueStart += 1;
  const first = blockText[valueStart];
  if (first !== "[" && first !== '"' && first !== "'") return undefined;
  let quoteCharacter: '"' | "'" | undefined;
  let escaped = false;
  let brackets = 0;
  for (let index = valueStart; index < blockText.length; index += 1) {
    const character = blockText[index];
    if (quoteCharacter) {
      if (quoteCharacter === '"' && escaped) escaped = false;
      else if (quoteCharacter === '"' && character === "\\") escaped = true;
      else if (character === quoteCharacter) {
        quoteCharacter = undefined;
        if (first !== "[") return { start: match.index, end: index + 1 };
      }
      continue;
    }
    if (character === '"' || character === "'") quoteCharacter = character;
    else if (character === "[") brackets += 1;
    else if (character === "]") {
      brackets -= 1;
      if (brackets === 0) return { start: match.index, end: index + 1 };
    }
  }
  return undefined;
}

function renderSkills(skills: readonly string[]): string {
  const sorted = [...new Set(skills)].sort((a, b) => a.localeCompare(b));
  if (sorted.length === 1) return `skills = [${quote(sorted[0] ?? "")}]`;
  return `skills = [\n${sorted.map((skill) => `  ${quote(skill)},`).join("\n")}\n]`;
}

function replaceSkills(text: string, block: SourceBlock, skills: readonly string[]): string {
  const blockText = text.slice(block.start, block.end);
  const range = assignmentRange(blockText, "skills");
  if (!range) throw new ConfigError("Cannot safely locate skills assignment in manifest.");
  return `${text.slice(0, block.start + range.start)}${renderSkills(skills)}${text.slice(block.start + range.end)}`;
}

async function atomicWrite(filePath: string, text: string): Promise<void> {
  const info = await stat(filePath);
  const temporary = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    await writeFile(temporary, text, { encoding: "utf8", flag: "wx", mode: info.mode });
    await chmod(temporary, info.mode);
    await rename(temporary, filePath);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export async function addToManifest(
  manifestPath: string,
  source: string,
  ref: string | undefined,
  skills: readonly string[] | "*",
): Promise<void> {
  const text = await readFile(manifestPath, "utf8");
  const updated = buildAddedManifest(text, source, ref, skills);
  if (updated === text) return;
  await validateManifestContents(updated, manifestPath);
  await atomicWrite(manifestPath, updated);
}

function buildAddedManifest(
  text: string,
  source: string,
  ref: string | undefined,
  skills: readonly string[] | "*",
): string {
  const blocks = sourceBlocks(text);
  const existing = blocks.find((block) => block.source === source && block.ref === ref);
  if (existing) {
    if (existing.skills === "*" || skills === "*") {
      if (existing.skills === "*") return text;
      const blockText = text.slice(existing.start, existing.end);
      const range = assignmentRange(blockText, "skills");
      if (!range) throw new ConfigError("Cannot safely locate skills assignment in manifest.");
      return `${text.slice(0, existing.start + range.start)}skills = "*"${text.slice(existing.start + range.end)}`;
    }
    return replaceSkills(text, existing, [...existing.skills, ...skills]);
  }
  const separator = text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
  const refLine = ref ? `ref = ${quote(ref)}\n` : "";
  const skillsLine = skills === "*" ? 'skills = "*"' : renderSkills(skills);
  return `${text}${separator}[[sources]]\nsource = ${quote(source)}\n${refLine}${skillsLine}\n`;
}

export async function validateManifestAdd(
  manifestPath: string,
  source: string,
  ref: string | undefined,
  skills: readonly string[] | "*",
): Promise<void> {
  const text = await readFile(manifestPath, "utf8");
  await validateManifestContents(buildAddedManifest(text, source, ref, skills), manifestPath);
}

function findRemovalBlock(text: string, name: string): SourceBlock {
  const matches = sourceBlocks(text).filter(
    (block) =>
      block.skills !== "*" &&
      block.skills.some((skill) => skill.toLowerCase() === name.toLowerCase()),
  );
  if (matches.length === 0) {
    throw new ConfigError(
      `Skill '${name}' is not explicitly declared.`,
      "Wildcard declarations cannot remove one skill; replace '*' with explicit names first.",
    );
  }
  if (matches.length > 1) {
    throw new ConfigError(`Skill '${name}' is declared by multiple sources; removal is ambiguous.`);
  }
  const block = matches[0];
  if (!block) throw new ConfigError(`Cannot safely locate skill '${name}'.`);
  return block;
}

export async function validateManifestRemoval(manifestPath: string, name: string): Promise<void> {
  const text = await readFile(manifestPath, "utf8");
  await validateManifestContents(buildRemovedManifest(text, name), manifestPath);
}

function buildRemovedManifest(text: string, name: string): string {
  const block = findRemovalBlock(text, name);
  if (block.skills === "*") return text;
  const remaining = block.skills.filter((skill) => skill.toLowerCase() !== name.toLowerCase());
  if (remaining.length > 0) {
    return replaceSkills(text, block, remaining);
  }
  let start = block.start;
  if (start > 0 && text.slice(0, start).endsWith("\n\n")) start -= 1;
  const blockText = text.slice(block.start, block.end);
  const skillsRange = assignmentRange(blockText, "skills");
  let trailingComments = "";
  if (skillsRange) {
    const suffix = blockText.slice(skillsRange.end);
    const withoutInlineComment = suffix.replace(/^[ \t]*(?:#[^\n]*)?/, "");
    if (
      withoutInlineComment
        .split(/\r?\n/)
        .every((line) => line.trim() === "" || line.trimStart().startsWith("#"))
    ) {
      trailingComments = suffix;
    }
  }
  return `${text.slice(0, start)}${trailingComments}${text.slice(block.end)}`;
}

export async function removeFromManifest(manifestPath: string, name: string): Promise<void> {
  const text = await readFile(manifestPath, "utf8");
  const updated = buildRemovedManifest(text, name);
  await validateManifestContents(updated, manifestPath);
  await atomicWrite(manifestPath, updated);
}
