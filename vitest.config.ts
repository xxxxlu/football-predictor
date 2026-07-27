import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // apps/web 用 tsconfig 里的 `@/*` 指向 src/；vitest 不读 tsconfig paths，
  // 所以在这里补一条同义 alias，否则被测模块一旦 import "@/..." 就解析失败。
  resolve: { alias: { "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
    coverage: { reporter: ["text", "json-summary"] },
  },
});
