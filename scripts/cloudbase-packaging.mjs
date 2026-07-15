import { cp, mkdir, readdir, readFile, realpath } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

export async function hoistCloudBaseNativePackages(rootDirectory) {
  const root = resolve(rootDirectory);
  const tracedScope = join(root, "apps/web/.next/node_modules/@node-rs");
  const runtimeScope = join(root, "apps/web/node_modules/@node-rs");
  const entries = await readdir(tracedScope, { withFileTypes: true });
  const aliases = [];

  for (const entry of entries) {
    if ((!entry.isDirectory() && !entry.isSymbolicLink()) || !/^argon2-[a-f0-9]+$/.test(entry.name)) continue;
    const tracedSource = join(tracedScope, entry.name);
    const source = entry.isSymbolicLink() ? await realpath(tracedSource) : tracedSource;
    const manifest = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
    if (manifest.name !== "@node-rs/argon2") continue;
    await mkdir(runtimeScope, { recursive: true });
    await cp(source, join(runtimeScope, entry.name), { recursive: true, force: true });
    aliases.push(entry.name);
  }

  if (aliases.length === 0) {
    throw new Error("No traced @node-rs/argon2 runtime alias was found.");
  }
  return aliases;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const aliases = await hoistCloudBaseNativePackages(process.argv[2] ?? process.cwd());
  console.log(`CloudBase native packages prepared: ${aliases.join(", ")}`);
}
