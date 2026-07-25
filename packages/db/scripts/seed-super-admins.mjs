import { createHash, randomBytes, randomUUID } from "node:crypto";
import { hash } from "@node-rs/argon2";
import postgres from "postgres";

const required = (key) => { const value = process.env[key]?.trim(); if (!value) throw new Error(`${key} is required`); return value; };
const databaseUrl = required("DATABASE_URL");
const rulesVersion = required("RULES_VERSION");
const accounts = [
  { username: required("SUPER_ADMIN_1_USERNAME").toLowerCase(), secret: required("SUPER_ADMIN_1_PASSWORD") },
  { username: required("SUPER_ADMIN_2_USERNAME").toLowerCase(), secret: required("SUPER_ADMIN_2_PASSWORD") },
];
if (accounts[0].username === accounts[1].username) throw new Error("Super-admin usernames must be distinct");
for (const account of accounts) {
  if (!/^[a-z0-9_]{3,32}$/.test(account.username)) throw new Error("Super-admin usernames must use 3-32 lowercase letters, numbers, or underscores");
  if (account.secret.length < 12 || account.secret.length > 128) throw new Error("Super-admin passwords must contain 12-128 characters");
}

const sql = postgres(databaseUrl, { max: 1, prepare: false });
try {
  let created = 0;
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('pulse_super_admin_seed'))`;
    for (const account of accounts) {
      const [existing] = await tx`SELECT id,is_super_admin FROM identity.users WHERE username_canonical=${account.username} FOR UPDATE`;
      if (existing && !existing.is_super_admin) throw new Error(`Configured super-admin username is already owned by a normal account: ${account.username}`);
      let id = existing?.id;
      if (!id) {
        id = randomUUID();
        const passwordHash = await hash(account.secret, { memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32 });
        const recoveryCodeHash = createHash("sha256").update(randomBytes(32)).digest("hex");
        await tx`INSERT INTO identity.users (id,username_canonical,password_hash,recovery_code_hash,nickname,status,is_super_admin,must_change_password,created_at,updated_at)
          VALUES (${id},${account.username},${passwordHash},${recoveryCodeHash},${account.username},'ACTIVE',true,true,now(),now())`;
        await tx`INSERT INTO identity.security_events (kind,account_key,source_key,occurred_at) VALUES ('SUPER_ADMIN_SEEDED',${account.username},'ops:seed',now())`;
        created += 1;
      }
      await tx`INSERT INTO identity.rule_acceptances (user_id,rules_version,is_adult_confirmed,accepted_at) VALUES (${id},${rulesVersion},true,now()) ON CONFLICT DO NOTHING`;
    }
    const admins = await tx`SELECT username_canonical FROM identity.users WHERE is_super_admin=true`;
    const configured = new Set(accounts.map((account) => account.username));
    if (admins.length !== 2 || admins.some((admin) => !configured.has(admin.username_canonical))) throw new Error("Database must contain exactly the two configured super-admin accounts");
  });
  process.stdout.write(`super-admin seed complete; created=${created}\n`);
} finally { await sql.end(); }
