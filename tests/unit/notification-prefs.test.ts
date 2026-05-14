import { describe, expect, it, vi, beforeEach } from "vitest";

const updateMock = vi.fn();
const revalidateMock = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    update: () => ({
      set: (v: unknown) => ({
        where: () => {
          updateMock(v);
          return Promise.resolve();
        },
      }),
    }),
    query: {
      profiles: {
        findFirst: vi.fn(),
      },
    },
  },
  schema: {
    profiles: {
      userId: { name: "user_id" },
    },
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: revalidateMock }));

vi.mock("@/lib/supabase/auth-cache", () => ({
  getCachedUser: vi.fn().mockResolvedValue({ id: "user-1", email: "u@e.com" }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

beforeEach(() => {
  updateMock.mockReset();
  revalidateMock.mockReset();
  vi.resetModules();
});

describe("updateCadence", () => {
  it("persists 'daily' to emailDigestCadence", async () => {
    const { updateCadence } = await import("@/lib/settings/notification-prefs-actions");
    const result = await updateCadence("daily");
    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ emailDigestCadence: "daily" }),
    );
    expect(revalidateMock).toHaveBeenCalledWith("/settings/notifications", "page");
  });

  it("rejects an unknown cadence value without calling db.update", async () => {
    const { updateCadence } = await import("@/lib/settings/notification-prefs-actions");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await updateCadence("yearly" as any);
    expect(result).toEqual(expect.objectContaining({ ok: false, error: expect.any(String) }));
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("updateEmailType", () => {
  it("persists email_follows = false", async () => {
    const { updateEmailType } = await import("@/lib/settings/notification-prefs-actions");
    const result = await updateEmailType("follows", false);
    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ emailFollows: false }),
    );
  });

  it("rejects an unknown type without calling db.update", async () => {
    const { updateEmailType } = await import("@/lib/settings/notification-prefs-actions");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await updateEmailType("dm" as any, true);
    expect(result).toEqual(expect.objectContaining({ ok: false, error: expect.any(String) }));
    expect(updateMock).not.toHaveBeenCalled();
  });
});
