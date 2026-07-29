import { readFile } from "node:fs/promises";

const packageData = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const expectedTag = `v${packageData.version}`;
const actualTag = process.env.GITHUB_REF_NAME;

if (actualTag !== expectedTag) {
  throw new Error(
    `Release tag '${actualTag ?? ""}' does not match package version '${expectedTag}'.`,
  );
}

process.stdout.write(`Verified release ${expectedTag}.\n`);
