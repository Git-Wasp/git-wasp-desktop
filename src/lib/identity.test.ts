import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { getIdentityConfig, setIdentity } from "./identity";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("identity", () => {
  it("getIdentityConfig reads from the backend", async () => {
    const cfg = {
      effective: { name: "A", email: "a@e" },
      local: { name: "A", email: "a@e" },
      global: null,
    };
    mockInvoke.mockResolvedValueOnce(cfg);
    await expect(getIdentityConfig()).resolves.toEqual(cfg);
    expect(mockInvoke).toHaveBeenCalledWith("get_identity_config");
  });

  it("setIdentity maps the local scope to global=false", async () => {
    mockInvoke.mockResolvedValueOnce({ effective: { name: "", email: "" }, local: null, global: null });
    await setIdentity("Jo", "jo@e", "local");
    expect(mockInvoke).toHaveBeenCalledWith("set_identity", {
      name: "Jo",
      email: "jo@e",
      global: false,
    });
  });

  it("setIdentity maps the global scope to global=true", async () => {
    mockInvoke.mockResolvedValueOnce({ effective: { name: "", email: "" }, local: null, global: null });
    await setIdentity("Jo", "jo@e", "global");
    expect(mockInvoke).toHaveBeenCalledWith("set_identity", {
      name: "Jo",
      email: "jo@e",
      global: true,
    });
  });
});
