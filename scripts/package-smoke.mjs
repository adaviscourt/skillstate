import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const temporary = await mkdtemp(path.join(os.tmpdir(), "skillstate-package-"));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("npm_execpath is required for package smoke tests");
const packageData = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

function npm(args, cwd) {
  return exec(process.execPath, [npmCli, ...args], { cwd });
}

try {
  await npm(["pack", "--pack-destination", temporary], process.cwd());
  const files = await readdir(temporary);
  const tarball = files.find((file) => file.endsWith(".tgz"));
  if (!tarball) throw new Error("npm pack did not produce a tarball");

  const consumer = path.join(temporary, "consumer");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(consumer));
  await npm(["init", "--yes"], consumer);
  await npm(["install", "--ignore-scripts", path.join(temporary, tarball)], consumer);
  const { stdout } = await npm(["exec", "--yes=false", "--", "skillstate", "--version"], consumer);
  if (stdout.trim() !== packageData.version)
    throw new Error(`Unexpected packed CLI version: ${stdout.trim()}`);
  process.stdout.write("Packed CLI smoke test passed.\n");
} finally {
  await rm(temporary, { force: true, recursive: true });
}
