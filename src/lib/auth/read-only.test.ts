/**
 * Viewer read-only guard: write methods throw 403 for viewers, reads pass
 * through; members/admins are unaffected.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readOnlyIfViewer, WRITE_METHODS } from "./read-only";
import { getUserRole } from "./users";

vi.mock("./users", () => ({
  getUserRole: vi.fn(),
}));

const mockGetUserRole = vi.mocked(getUserRole);

function fakeProvider() {
  return {
    providerName: "fake",
    listClients: vi.fn(async () => ["c1"]),
    getClient: vi.fn(async () => ({ id: "c1" })),
    createClient: vi.fn(async () => ({ id: "new" })),
    updateClient: vi.fn(async () => ({ id: "c1" })),
    removeClient: vi.fn(async () => undefined),
    markInvoiceSent: vi.fn(async () => undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("readOnlyIfViewer", () => {
  it("lets viewers read", async () => {
    mockGetUserRole.mockResolvedValue("viewer");
    const base = fakeProvider();
    const p = readOnlyIfViewer(
      base as unknown as import("@/core/storage").StorageProvider,
      "viewer-1",
    );
    await expect(p.listClients()).resolves.toEqual(["c1"]);
    await expect(p.getClient("c1")).resolves.toEqual({ id: "c1" });
    expect(mockGetUserRole).not.toHaveBeenCalled();
  });

  it("blocks viewer writes with 403", async () => {
    mockGetUserRole.mockResolvedValue("viewer");
    const base = fakeProvider();
    const p = readOnlyIfViewer(
      base as unknown as import("@/core/storage").StorageProvider,
      "viewer-1",
    );
    await expect(p.createClient({} as never)).rejects.toMatchObject({
      status: 403,
    });
    await expect(p.updateClient("c1", {})).rejects.toMatchObject({
      status: 403,
    });
    await expect(p.removeClient("c1")).rejects.toMatchObject({ status: 403 });
    await expect(p.markInvoiceSent({} as never)).rejects.toMatchObject({
      status: 403,
    });
    expect(base.createClient).not.toHaveBeenCalled();
    expect(mockGetUserRole).toHaveBeenCalledWith("viewer-1");
  });

  it("lets members and admins write", async () => {
    mockGetUserRole.mockResolvedValue("member");
    const base = fakeProvider();
    const p = readOnlyIfViewer(
      base as unknown as import("@/core/storage").StorageProvider,
      async () => "member-1",
    );
    await expect(p.createClient({} as never)).resolves.toEqual({ id: "new" });
    expect(base.createClient).toHaveBeenCalled();
  });

  it("covers every mutating method name", () => {
    for (const name of [
      "createClient",
      "updateClient",
      "removeClient",
      "createProject",
      "updateProject",
      "removeProject",
      "createTask",
      "updateTask",
      "removeTask",
      "createExpense",
      "updateExpense",
      "removeExpense",
      "createInvoice",
      "updateInvoice",
      "removeInvoice",
      "updateSettings",
      "createRecurringSchedule",
      "updateRecurringSchedule",
      "removeRecurringSchedule",
      "createRetainer",
      "updateRetainer",
      "removeRetainer",
      "assignNextInvoiceNumber",
      "markInvoiceSent",
      "markInvoicePaid",
      "createShareLink",
      "revokeShareLink",
      "recordTimesheetApproval",
    ]) {
      expect(WRITE_METHODS.has(name)).toBe(true);
    }
  });
});
