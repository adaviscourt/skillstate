import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const project = await mkdtemp(path.join(os.tmpdir(), "skillstate-e2e-"));
const cli = path.resolve("dist/cli.js");

try {
  await mkdir(path.join(project, ".git"));
  await writeFile(
    path.join(project, "skillstate.toml"),
    `schema = 1\n\n[install]\nagents = ["opencode"]\nmode = "copy"\n\n[[sources]]\nsource = "vercel-labs/agent-skills"\nskills = ["web-design-guidelines"]\n`,
  );
  await exec(process.execPath, [cli, "sync"], { cwd: project, timeout: 300_000 });
  await access(path.join(project, "skills-lock.json"));
  await access(path.join(project, ".agents", "skills", "web-design-guidelines", "SKILL.md"));
  await exec(process.execPath, [cli, "check"], { cwd: project });

  // Simulate a clean clone: committed lock present, generated installations absent.
  await rm(path.join(project, ".agents"), { force: true, recursive: true });
  await exec(process.execPath, [cli, "sync"], { cwd: project, timeout: 300_000 });
  await access(path.join(project, ".agents", "skills", "web-design-guidelines", "SKILL.md"));

  const second = await exec(process.execPath, [cli, "sync", "--dry-run", "--json"], {
    cwd: project,
  });
  const result = JSON.parse(second.stdout);
  if (result.summary?.changes !== 0) throw new Error("Second sync was not idempotent");

  await exec(process.execPath, [cli, "update", "web-design-guidelines"], {
    cwd: project,
    timeout: 300_000,
  });
  await exec(process.execPath, [cli, "remove", "web-design-guidelines"], { cwd: project });
  await exec(process.execPath, [cli, "check"], { cwd: project });
  process.stdout.write("Network E2E passed.\n");
} finally {
  if (process.env.SKILLSTATE_E2E_KEEP === "1") {
    process.stderr.write(`Preserved E2E project: ${project}\n`);
  } else {
    await rm(project, { force: true, recursive: true });
  }
}
