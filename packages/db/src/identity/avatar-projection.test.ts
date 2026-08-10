import type postgres from "postgres";
import { describe, expect, it } from "vitest";

import {
  avatarColumns,
  avatarJoin,
  avatarJoinUnlessViewerBlocked,
  clearAvatarWithin,
  enqueueAvatarObjectDeletion,
  withAuthorAvatar,
  withAvatar,
  withoutAvatar,
} from "./avatar-projection.js";

/**
 * The read-side fragments every avatar-bearing projection shares. If these drift,
 * one surface starts serving a photo the others withhold — which is exactly the
 * kind of inconsistency the block rule and the moderation gate must not have.
 */

type Row = Record<string, unknown>;

class FakeQuery {
  constructor(readonly strings: readonly string[], readonly values: readonly unknown[], private readonly run: (query: FakeQuery) => Promise<Row[]>) {}
  then<T, U>(resolve?: (rows: Row[]) => T | PromiseLike<T>, reject?: (reason: unknown) => U | PromiseLike<U>) {
    return this.run(this).then(resolve, reject);
  }
}

function flatten(query: FakeQuery): { text: string; values: unknown[] } {
  let text = "";
  const values: unknown[] = [];
  query.strings.forEach((chunk, index) => {
    text += chunk;
    if (index >= query.values.length) return;
    const value = query.values[index];
    if (value instanceof FakeQuery) {
      const inner = flatten(value);
      text += inner.text;
      values.push(...inner.values);
    } else {
      text += " $ ";
      values.push(value);
    }
  });
  return { text, values };
}

function fakeSql(respond: (query: string) => Row[], log?: { queries: string[]; values: unknown[] }) {
  const run = async (query: FakeQuery) => {
    const { text, values } = flatten(query);
    const normalized = text.replace(/\s+/g, " ").trim();
    log?.queries.push(normalized);
    log?.values.push(...values);
    return respond(normalized);
  };
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => new FakeQuery(strings, values, run);
  return sql as unknown as postgres.Sql;
}

/**
 * Renders a fragment the way `fakeSql` does — placeholders inlined as `$`, runs
 * of whitespace collapsed. Asserting on the raw template would be asserting on
 * this file's indentation rather than on the SQL it generates.
 */
const render = (fragment: unknown) => {
  const { text, values } = flatten(fragment as FakeQuery);
  return { text: text.replace(/\s+/g, " ").trim(), values };
};
const PUBLIC_ID = "7f3a1c2b-4d5e-4f60-8a91-b2c3d4e5f607";
const VIEWER = "aaaaaaaa-0000-0000-0000-000000000001";

describe("shared avatar SQL fragments", () => {
  it("only ever joins an APPROVED avatar, so a takedown lands on the next read", () => {
    const sql = fakeSql(() => []);
    expect(render(avatarJoin(sql)).text).toContain("av.moderation_status = 'APPROVED'");
    expect(render(avatarJoinUnlessViewerBlocked(sql, VIEWER)).text).toContain("av.moderation_status = 'APPROVED'");
  });

  it("selects the public handle and the version, never the storage location", () => {
    const { text } = render(avatarColumns(fakeSql(() => [])));
    expect(text).toContain('av.public_id AS "avatarPublicId"');
    expect(text).toContain('av.version AS "avatarVersion"');
    expect(text).not.toContain("object_key");
    expect(text).not.toContain("file_id");
  });

  /**
   * The block rule is viewer-directional on purpose. Suppressing in the other
   * direction — hiding a blocker's photo from the person they blocked — would make
   * an avatar vanish from a pane where it used to be, which is the "you have been
   * blocked" signal the anti-enumeration rule forbids.
   */
  it("withholds a photo only from the viewer who blocked, never the other way round", () => {
    const { text, values } = render(avatarJoinUnlessViewerBlocked(fakeSql(() => []), VIEWER));
    expect(text).toContain("NOT EXISTS");
    expect(text).toContain("b.blocker_user_id = $ AND b.blocked_user_id = u.id");
    // The bound parameter is the viewer, so the filter can only ever run in that
    // one direction; a reversed pair would need a different fragment entirely.
    expect(values).toEqual([VIEWER]);
    expect(text).not.toContain("b.blocked_user_id = $ AND b.blocker_user_id = u.id");
  });
});

describe("avatar row mappers", () => {
  const joined = { userId: "u1", nickname: "Alice", avatarPublicId: PUBLIC_ID, avatarVersion: 3 };

  it("replaces the raw public id with the derived pair", () => {
    expect(withAvatar(joined)).toEqual({
      userId: "u1",
      nickname: "Alice",
      avatarUrl: `/api/v1/media/avatars/${PUBLIC_ID}/3.webp`,
      avatarVersion: 3,
    });
    // The building block never reaches a caller — leaving it in would trip the
    // minimal-projection guards, which is the intended safety net.
    expect(Object.keys(withAvatar(joined))).not.toContain("avatarPublicId");
  });

  it("suppresses a photo without changing the row's shape", () => {
    expect(withoutAvatar(joined)).toEqual({ userId: "u1", nickname: "Alice", avatarUrl: null, avatarVersion: null });
    expect(Object.keys(withoutAvatar(joined)).sort()).toEqual(Object.keys(withAvatar(joined)).sort());
  });

  it("prefixes the pair for message authors", () => {
    expect(withAuthorAvatar({ id: "m1", avatarPublicId: PUBLIC_ID, avatarVersion: 2 })).toEqual({
      id: "m1",
      authorAvatarUrl: `/api/v1/media/avatars/${PUBLIC_ID}/2.webp`,
      authorAvatarVersion: 2,
    });
    expect(withAuthorAvatar({ id: "m1", avatarPublicId: null, avatarVersion: null })).toEqual({
      id: "m1",
      authorAvatarUrl: null,
      authorAvatarVersion: null,
    });
  });
});

describe("clearAvatarWithin", () => {
  it("drops the row and books the object in the same transaction", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    const sql = fakeSql((query) =>
      query.includes("DELETE FROM identity.user_avatars")
        ? [{ objectKey: `avatars/${PUBLIC_ID}/2.webp`, fileId: "cloud://env/x" }]
        : [], log);

    await expect(clearAvatarWithin(sql, VIEWER, "2026-08-07T10:00:00.000Z")).resolves.toEqual({
      objectKey: `avatars/${PUBLIC_ID}/2.webp`,
      fileId: "cloud://env/x",
    });
    expect(log.queries[0]).toContain("DELETE FROM identity.user_avatars");
    expect(log.queries[1]).toContain("INSERT INTO identity.avatar_object_deletions");
  });

  it("is a no-op for an account with no avatar", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    await expect(clearAvatarWithin(fakeSql(() => [], log), VIEWER, "2026-08-07T10:00:00.000Z")).resolves.toBeNull();
    expect(log.queries.some((query) => query.includes("avatar_object_deletions"))).toBe(false);
  });

  it("enqueues idempotently, so a replay never doubles the queue", async () => {
    const log = { queries: [] as string[], values: [] as unknown[] };
    await enqueueAvatarObjectDeletion(fakeSql(() => [], log), { objectKey: `avatars/${PUBLIC_ID}/1.webp`, fileId: null }, "2026-08-07T10:00:00.000Z");
    expect(log.queries[0]).toContain("ON CONFLICT (object_key) DO NOTHING");
  });
});
