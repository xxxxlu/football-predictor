import { expect, test, type APIResponse } from "@playwright/test";
import { createLoggedInActor, loginActor } from "./support/actors";

// Story 12.4 — the full governance journey over the PULSE CLUB public channel:
//   member confirms the community rules and sends → another member reports →
//   the community moderator hides it from the same 11.3 governance inbox
//   (kind=CHANNEL_MESSAGE) → the author receives an explanation → the channel
//   read model no longer returns the message.
//
// Needs the COMMUNITY_MODERATOR fixture from `pnpm db:seed:e2e` (set
// E2E_MODERATOR_USERNAME / E2E_MODERATOR_PASSWORD before seeding and export the
// same values here) plus a persisting fp_session (APP_ENV=test or `next dev`).

const moderatorUsername = process.env.E2E_MODERATOR_USERNAME;
const moderatorPassword = process.env.E2E_MODERATOR_PASSWORD;

async function json<T>(response: APIResponse): Promise<T> {
  return (await response.json()) as T;
}

test.describe("club channel governance journey", () => {
  test.skip(!moderatorUsername || !moderatorPassword,
    "E2E_MODERATOR_USERNAME / E2E_MODERATOR_PASSWORD not set — seed the moderator fixture with `pnpm db:seed:e2e`");

  test("confirm rules → send → report → inbox hide → author notified → channel hides it", async ({ browser, baseURL }) => {
    const origin = { origin: baseURL ?? "http://127.0.0.1:3001" };
    const messageBody = `频道治理旅程消息 ${Date.now().toString(36)}`;

    // --- The author confirms the rules in place and sends through the channel UI. ---
    const authorContext = await browser.newContext();
    const authorPage = await authorContext.newPage();
    await createLoggedInActor(authorPage, "chanauthor");
    await authorPage.goto("/club");
    // The composer is replaced by the rules card until the server confirms (AC2).
    await expect(authorPage.getByRole("button", { name: "我已阅读并确认社区规则" })).toBeVisible();
    await expect(authorPage.getByLabel("发送消息")).toHaveCount(0);
    await authorPage.getByRole("button", { name: "我已阅读并确认社区规则" }).click();
    const composer = authorPage.getByLabel("发送消息");
    await expect(composer).toBeVisible();
    await composer.fill(messageBody);
    await authorPage.getByRole("button", { name: "发送", exact: true }).click();
    await expect(authorPage.getByText(messageBody)).toBeVisible();

    // --- A second member (rules confirmed) reports it via the inline panel. ---
    const reporterContext = await browser.newContext();
    const reporterPage = await reporterContext.newPage();
    const reporterUsername = await createLoggedInActor(reporterPage, "chanreport");
    const confirmed = await reporterPage.request.post("/api/v1/club/rules-acceptance", { headers: origin });
    expect(confirmed.ok(), "reporter confirms the community rules").toBeTruthy();
    await reporterPage.goto("/club");
    await expect(reporterPage.getByText(messageBody)).toBeVisible();
    await reporterPage.locator("li", { hasText: messageBody }).getByRole("button", { name: "举报", exact: true }).click();
    await reporterPage.getByLabel("举报原因（10–500 字）").fill("违规导流拉人，需要协管员尽快处理");
    await reporterPage.getByRole("button", { name: "提交举报" }).click();
    await expect(reporterPage.getByText("举报已提交，社区协管员会处理。")).toBeVisible();

    // --- The community moderator hides it from the same governance inbox. ---
    const moderatorContext = await browser.newContext();
    const moderatorPage = await moderatorContext.newPage();
    await loginActor(moderatorPage, moderatorUsername!, moderatorPassword!);
    const reauth = await moderatorPage.request.post("/api/v1/auth/reauthenticate", {
      headers: origin, data: { password: moderatorPassword },
    });
    expect(reauth.ok(), "moderator reauth proof").toBeTruthy();
    const queue = await moderatorPage.request.get("/api/v1/admin/governance/reports?kind=CHANNEL_MESSAGE&status=PENDING");
    expect(queue.status(), "moderator reads the channel queue").toBe(200);
    const { data } = await json<{ data: { reports: Array<{ reportId: string; reporter: string }> } }>(queue);
    const report = data.reports.find((entry) => entry.reporter === reporterUsername);
    expect(report, "the channel report is visible to the community moderator").toBeTruthy();

    // The detail shows the explicit scope label, never a NULL room name.
    const detail = await moderatorPage.request.get(`/api/v1/admin/governance/reports/${report!.reportId}`);
    expect(detail.status()).toBe(200);
    const detailBody = await json<{ data: { message: { roomName: string; body: string } | null; room: unknown } }>(detail);
    expect(detailBody.data.message?.roomName).toBe("PULSE CLUB");
    expect(detailBody.data.message?.body).toBe(messageBody);
    expect(detailBody.data.room).toBeNull();

    const resolved = await moderatorPage.request.post(`/api/v1/admin/governance/reports/${report!.reportId}/resolution`, {
      headers: origin, data: { disposition: "HIDE_MESSAGE", reason: "复核确认违规，隐藏该频道发言" },
    });
    expect(resolved.status(), "HIDE_MESSAGE resolution on a channel report").toBe(200);

    // --- The author is told what happened and why. ---
    const notices = await authorPage.request.get("/api/v1/account/notices");
    expect(notices.status()).toBe(200);
    const noticesBody = await json<{ data: { notices: Array<{ kind: string; reason: string }> } }>(notices);
    const hiddenNotice = noticesBody.data.notices.find((notice) => notice.reason === "复核确认违规，隐藏该频道发言");
    expect(hiddenNotice, "author receives the MESSAGE_HIDDEN explanation").toBeTruthy();
    expect(hiddenNotice!.kind).toBe("MESSAGE_HIDDEN");

    // --- The hidden message is gone from the channel read model. ---
    const pageAfter = await reporterPage.request.get("/api/v1/club/channel/messages");
    expect(pageAfter.status()).toBe(200);
    const channel = await json<{ data: { messages: Array<{ body: string }> } }>(pageAfter);
    expect(channel.data.messages.some((message) => message.body === messageBody), "hidden message excluded from the channel read model").toBe(false);
    await reporterPage.reload();
    await expect(reporterPage.getByText(messageBody)).not.toBeVisible();

    await authorContext.close();
    await reporterContext.close();
    await moderatorContext.close();
  });
});
