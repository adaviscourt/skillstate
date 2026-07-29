import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function temporaryProject(prefix = "skillstate-"): Promise<string> {
  const root = await import("node:fs/promises").then(({ mkdtemp }) =>
    mkdtemp(path.join(os.tmpdir(), prefix)),
  );
  await mkdir(path.join(root, ".git"));
  return root;
}

export async function writeManifest(root: string, body?: string): Promise<string> {
  const manifestPath = path.join(root, "skillstate.toml");
  await writeFile(
    manifestPath,
    body ??
      `schema = 1\n\n[install]\nagents = ["opencode"]\nmode = "symlink"\n\n[[sources]]\nsource = "owner/repo"\nskills = ["review"]\n`,
  );
  return manifestPath;
}
