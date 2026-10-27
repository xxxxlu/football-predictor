import { describe, expect, it, vi, beforeEach } from "vitest";
import { GET } from "./route";

vi.mock("../../../auth/_lib/handlers", () => ({
  readSessionToken: vi.fn(),
}));

vi.mock("../../../_lib/operator-gate", () => ({
  requireAnyCapability: vi.fn(),
}));

vi.mock("../../../auth/_lib/runtime", () => ({
  getIdentityService: vi.fn(),
}));

vi.mock("./runtime", () => ({
  getSettlementAuditRepository: vi.fn(),
}));

import { readSessionToken } from "../../../auth/_lib/handlers";
import { requireAnyCapability } from "../../../_lib/operator-gate";
import { getSettlementAuditRepository } from "./runtime";
import { AuthError } from "@pulse/domain";

describe("GET /api/v1/admin/settlement/audit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when session cookie is absent", async () => {
    vi.mocked(readSessionToken).mockReturnValue(null);

    const request = new Request("http://localhost/api/v1/admin/settlement/audit");
    const response = await GET(request);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("UNAUTHENTICATED");
  });

  it("returns 403 when operator lacks required audit capabilities", async () => {
    vi.mocked(readSessionToken).mockReturnValue("valid-session-token");
    vi.mocked(requireAnyCapability).mockRejectedValue(
      new AuthError("FORBIDDEN", 403, "You do not have permission for this operation."),
    );

    const request = new Request("http://localhost/api/v1/admin/settlement/audit");
    const response = await GET(request);

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("returns 200 and audit report when authorized", async () => {
    vi.mocked(readSessionToken).mockReturnValue("valid-session-token");
    vi.mocked(requireAnyCapability).mockResolvedValue({
      actorId: "admin-1",
      matchingCapability: "AUDIT_READ",
    } as never);

    const mockReport = {
      generatedAt: "2026-10-19T10:00:00.000Z",
      passed: true,
      totalTicketsChecked: 250,
      totalSettlementsChecked: 200,
      totalAccountsAudited: 80,
      discrepancies: [],
      summary: {
        criticalCount: 0,
        warningCount: 0,
        cleanAccountCount: 80,
        corruptedAccountCount: 0,
      },
    };

    const mockRepo = {
      runAudit: vi.fn().mockResolvedValue(mockReport),
    };
    vi.mocked(getSettlementAuditRepository).mockReturnValue(mockRepo as never);

    const request = new Request("http://localhost/api/v1/admin/settlement/audit");
    const response = await GET(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual(mockReport);
    expect(mockRepo.runAudit).toHaveBeenCalledOnce();
  });
});
