import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";

try {
  loadEnvFile(".env");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const child = spawn(process.execPath, [resolve("apps/web/node_modules/next/dist/bin/next"), "dev", "-H", "127.0.0.1", "-p", "3001"], {
  cwd: "apps/web",
  stdio: "inherit",
  env: process.env,
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("error", (error) => {
  console.error(`Unable to start the web development server: ${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1);
});
