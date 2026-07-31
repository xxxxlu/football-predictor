import { expect, test, type APIResponse } from "@playwright/test";
import { createLoggedInActor, loginActor, createRoomViaApi } from "./support/actors";

// Story 12.3 — the full moderation journey over the room public chat:
//   member sends → another member reports → the community moderator hides it
//   from the governance inbox → the author receives an explanation → no room
//   member can read the message any more.
//
// Needs the COMMUNITY_MODERATOR fixture from `pnpm db:seed:e2e` (set
// E2E_MODERATOR_USERNAME / E2E_MODERATOR_PASSWORD before seeding and export the
// same values here) plus a persisting fp_session (APP_ENV=test or `next dev`).
// The moderator's hide runs over the 11.3 API surface — a resolution needs a
// fresh reauth proof, which page.request carries via the fp_reauth cookie.

const moderatorUsername = process.env.E2E_MODERATOR_USERNAME;
const moderatorPassword = process.env.E2E_MODERATOR_PASSWORD;

async function json<T>(response: APIResponse): Promise<T> {
  return (await response.json()) as T;
}

test.describe("room chat moderation journey", () => {
  test.skip(!moderatorUsername || !moderatorPassword,
    "E2E_MODERATOR_USERNAME / E2E_MODERATOR_PASSWORD not set — seed the moderator fixture with `pnpm db:seed:e2e`");

  test("message → report → inbox hide → author notified → members cannot read it", async ({ browser, baseURL }) => {
    const origin = { origin: baseURL ?? "http://127.0.0.1:3001" };
    const messageBody = `公屏治理旅程消息 ${Date.now().toString(36)}`;

    // --- The author (room owner) sends a message through the chat UI. ---
    const authorContext = await browser.newContext();
    const authorPage = await authorContext.newPage();
    await createLoggedInActor(authorPage, "chatauthor");
    const { roomId, inviteToken } = await createRoomViaApi(authorPage, baseURL, "公屏治理旅程房");
    expect(inviteToken, "invite token from room creation").not.toEqual("");
    await authorPage.goto(`/rooms/${roomId}`);
    await authorPage.getByLabel("发送消息").fill(messageBody);
    await authorPage.getByRole("button", { name: "发送", exact: true }).click();
    await expect(authorPage.getByText(messageBody)).toBeVisible();

    // --- A second member joins and reports it via the inline reason panel. ---
    const reporterContext = await browser.newContext();
    const reporterPage = await reporterContext.newPage();
    const reporterUsername = await createLoggedInActor(reporterPage, "chatreport");
    const joined = await reporterPage.request.post(`/api/v1/rooms/invites/${encodeURIComponent(inviteToken)}`, {
      headers: origin, data: { rulesAccepted: true },
    });
    expect(joined.ok(), "reporter joins via invite").toBeTruthy();
    await reporterPage.goto(`/rooms/${roomId}`);
    await expect(reporterPage.getByText(messageBody)).toBeVisible();
    await reporterPage.getByRole("button", { name: "举报", exact: true }).first().click();
    await reporterPage.getByLabel("举报原因（10–500 字）").fill("人身攻击，需要协管员尽快处理");
    await reporterPage.getByRole("button", { name: "提交举报" }).click();
    await expect(reporterPage.getByText("举报已提交，社区协管员会处理。")).toBeVisible();

    // --- The community moderator hides it from the governance inbox. ---
    const moderatorContext = await browser.newContext();
    const moderatorPage = await moderatorContext.newPage();
    await loginActor(moderatorPage, moderatorUsername!, moderatorPassword!);
    const reauth = await moderatorPage.request.post("/api/v1/auth/reauthenticate", {
      headers: origin, data: { password: moderatorPassword },
    });
    expect(reauth.ok(), "moderator reauth proof").toBeTruthy();
    const queue = await moderatorPage.request.get("/api/v1/admin/governance/reports?kind=MESSAGE&status=PENDING");
    expect(queue.status(), "moderator reads the message queue").toBe(200);
    const { data } = await json<{ data: { reports: Array<{ reportId: string; reporter: string }> } }>(queue);
    const report = data.reports.find((entry) => entry.reporter === reporterUsername);
    expect(report, "the filed report is visible to the community moderator").toBeTruthy();
    const resolved = await moderatorPage.request.post(`/api/v1/admin/governance/reports/${report!.reportId}/resolution`, {
      headers: origin, data: { disposition: "HIDE_MESSAGE", reason: "复核确认违规，隐藏该消息" },
    });
    expect(resolved.status(), "HIDE_MESSAGE resolution").toBe(200);

    // --- The author is told what happened and why. ---
    const notices = await authorPage.request.get("/api/v1/account/notices");
    expect(notices.status()).toBe(200);
    const noticesBody = await json<{ data: { notices: Array<{ kind: string; reason: string }> } }>(notices);
    const hiddenNotice = noticesBody.data.notices.find((notice) => notice.kind === "MESSAGE_HIDDEN");
    expect(hiddenNotice, "author receives the MESSAGE_HIDDEN explanation").toBeTruthy();
    expect(hiddenNotice!.reason).toBe("复核确认违规，隐藏该消息");

    // --- The hidden message is gone from every member's read model. ---
    const pageAfter = await reporterPage.request.get(`/api/v1/rooms/${roomId}/messages`);
    expect(pageAfter.status()).toBe(200);
    const chat = await json<{ data: { messages: Array<{ body: string }> } }>(pageAfter);
    expect(chat.data.messages.some((message) => message.body === messageBody), "hidden message excluded from the member read model").toBe(false);
    await reporterPage.reload();
    await expect(reporterPage.getByText(messageBody)).not.toBeVisible();

    await authorContext.close();
    await reporterContext.close();
    await moderatorContext.close();
  });
});
