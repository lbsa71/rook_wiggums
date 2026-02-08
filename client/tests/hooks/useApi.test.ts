import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiGet, apiPost } from "../../src/hooks/useApi";

describe("useApi", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("apiGet", () => {
    it("fetches JSON from a GET endpoint", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ state: "RUNNING" }),
      } as Response);

      const result = await apiGet<{ state: string }>("/api/loop/status");

      expect(result.state).toBe("RUNNING");
      expect(fetch).toHaveBeenCalledWith("/api/loop/status");
    });

    it("throws on non-ok response", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: false,
        status: 500,
      } as Response);

      await expect(apiGet("/api/fail")).rejects.toThrow("GET /api/fail failed: 500");
    });
  });

  describe("apiPost", () => {
    it("sends POST with JSON body", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      } as Response);

      const result = await apiPost<{ success: boolean }>("/api/conversation/send", { message: "hello" });

      expect(result.success).toBe(true);
      expect(fetch).toHaveBeenCalledWith("/api/conversation/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"message":"hello"}',
      });
    });

    it("sends POST without body", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ state: "RUNNING" }),
      } as Response);

      await apiPost("/api/loop/start");

      expect(fetch).toHaveBeenCalledWith("/api/loop/start", {
        method: "POST",
        headers: {},
        body: undefined,
      });
    });

    it("throws on non-ok response", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: false,
        status: 409,
      } as Response);

      await expect(apiPost("/api/loop/start")).rejects.toThrow("POST /api/loop/start failed: 409");
    });
  });
});
