import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required to run migrations");

const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const files = (await readdir(migrationsDirectory)).filter((file) => file.endsWith(".sql")).sort();
const sql = postgres(databaseUrl, { max: 1, prepare: false });

try {
  await sql.begin(async (transaction) => {
    await transaction`SELECT pg_advisory_xact_lock(hashtext('pulse_migrations'))`;
    await transaction`CREATE TABLE IF NOT EXISTS public.app_schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
    const applied = new Set((await transaction`SELECT name FROM public.app_schema_migrations`).map((row) => row.name));
    for (const file of files) {
      if (applied.has(file)) continue;
      await transaction.unsafe(await readFile(join(migrationsDirectory, file), "utf8"));
      await transaction`INSERT INTO public.app_schema_migrations (name) VALUES (${file})`;
      process.stdout.write(`applied ${file}\n`);
    }
  });
} finally {
  await sql.end();
}
