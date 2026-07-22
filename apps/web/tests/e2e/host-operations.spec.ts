import { expect, test } from "@playwright/test";

// Story 7.5 gate G1 — Journey 4: 房主运营 (host views privacy-preserving submission status).
//
// test.fixme: authenticated + owner role. Recorded as a documented gap in the Story 7.5 Dev Agent
// Record. Beyond a session (see the Secure-cookie note in invite-join-room.spec.ts), a meaningful,
// non-empty submission grid needs: an owner, at least one other member, and at least one target
// fixture in the room. The forbidden state (a non-owner member hitting the page) is assertable with a
// second actor and is the lightest first slice to un-fixme.
//
// The body captures the REAL owner flow. Skipped, not faked.

test.fixme("owner sees the privacy banner and per-fixture submission counts", async ({ page }) => {
  // Precondition: authenticated as the room owner; roomId known from room creation.
  const roomId = "REPLACE_WITH_SEEDED_ROOM_ID";
  await page.goto(`/rooms/${roomId}/status`);

  // Owner view: privacy protection banner + submission tallies.
  await expect(page.getByText("隐私保护已开启")).toBeVisible();
  await expect(page.getByText(/已提交\s*\d+\s*\/\s*\d+/)).toBeVisible();
});

test.fixme("a non-owner member is shown the owner-only forbidden state", async ({ page }) => {
  // Precondition: authenticated as a NON-owner member of the room.
  const roomId = "REPLACE_WITH_SEEDED_ROOM_ID";
  await page.goto(`/rooms/${roomId}/status`);

  await expect(page.getByText("只有房主可以查看")).toBeVisible();
});
