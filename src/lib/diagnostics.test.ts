import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  applyDiagnosticsPref,
  getDiagnosticsInfo,
  loadDiagnosticsPref,
  openLogDir,
  setDiagnostics,
} from "./diagnostics";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("diagnostics", () => {
  it("returns null when no override is stored (follow build default)", () => {
    expect(loadDiagnosticsPref()).toBeNull();
  });

  it("setDiagnostics persists the choice and tells the backend", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);

    await setDiagnostics(true);

    expect(localStorage.getItem("diagnostics")).toBe("on");
    expect(loadDiagnosticsPref()).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith("set_diagnostics", { enabled: true });
  });

  it("setDiagnostics persists an off choice", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);

    await setDiagnostics(false);

    expect(localStorage.getItem("diagnostics")).toBe("off");
    expect(loadDiagnosticsPref()).toBe(false);
  });

  it("applyDiagnosticsPref re-applies a stored override", async () => {
    localStorage.setItem("diagnostics", "off");
    mockInvoke.mockResolvedValueOnce(undefined);

    await applyDiagnosticsPref();

    expect(mockInvoke).toHaveBeenCalledWith("set_diagnostics", { enabled: false });
  });

  it("applyDiagnosticsPref is a no-op with no stored override", async () => {
    await applyDiagnosticsPref();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("getDiagnosticsInfo reads from the backend", async () => {
    const info = { enabled: true, logDir: "/logs", logFile: "/logs/gitclient.log" };
    mockInvoke.mockResolvedValueOnce(info);

    await expect(getDiagnosticsInfo()).resolves.toEqual(info);
    expect(mockInvoke).toHaveBeenCalledWith("get_diagnostics_info");
  });

  it("openLogDir invokes the backend command", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);
    await openLogDir();
    expect(mockInvoke).toHaveBeenCalledWith("open_log_dir");
  });
});
