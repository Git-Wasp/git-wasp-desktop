import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { logOperationError, logger } from "./logger";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("logger", () => {
  it("forwards a level + message to the backend", () => {
    mockInvoke.mockResolvedValue(undefined);
    logger.error("boom");
    expect(mockInvoke).toHaveBeenCalledWith("frontend_log", { level: "error", message: "boom" });
  });

  it("logOperationError returns the message and logs it", () => {
    mockInvoke.mockResolvedValue(undefined);

    const msg = logOperationError("push", new Error("rejected"));

    expect(msg).toBe("rejected");
    expect(mockInvoke).toHaveBeenCalledWith("frontend_log", {
      level: "error",
      message: "push failed: rejected",
    });
  });

  it("logOperationError stringifies non-Error values", () => {
    mockInvoke.mockResolvedValue(undefined);
    expect(logOperationError("fetch", "nope")).toBe("nope");
  });

  it("never throws when the backend invoke rejects", () => {
    mockInvoke.mockRejectedValue(new Error("ipc down"));
    expect(() => logger.info("hi")).not.toThrow();
  });
});
