import { act } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import "@testing-library/jest-dom";
import { DeviceFlowModal } from "./DeviceFlowModal";
import { useGithubStore } from "../../stores/githubStore";

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);
const mockOpenUrl = vi.mocked(openUrl);

const fakeInit = {
  userCode: "WXYZ-1234",
  verificationUri: "https://github.com/login/device",
  deviceCode: "device-abc",
  expiresIn: 900,
  interval: 5,
};

beforeEach(() => {
  vi.clearAllMocks();
  useGithubStore.setState({
    connections: {},
    remoteInfo: null,
    pullRequests: [],
    githubRepos: [],
    deviceFlowInit: null,
    isAuthenticating: false,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("DeviceFlowModal", () => {
  it("starts the device flow on mount and renders the user code", async () => {
    mockInvoke.mockResolvedValueOnce(fakeInit); // github_start_device_flow

    render(<DeviceFlowModal host="github.com" onClose={vi.fn()} />);

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("github_start_device_flow", { host: "github.com" });
    });
    await waitFor(() => {
      expect(screen.getByText("WXYZ-1234")).toBeTruthy();
    });
    expect(screen.getByText(/github\.com\/login\/device/)).toBeTruthy();
  });

  it("opens the verification URL in the browser when clicked", async () => {
    mockInvoke.mockResolvedValueOnce(fakeInit);

    render(<DeviceFlowModal host="github.com" onClose={vi.fn()} />);

    const button = await screen.findByRole("button", { name: /open in browser/i });
    fireEvent.click(button);

    expect(mockOpenUrl).toHaveBeenCalledWith(fakeInit.verificationUri);
  });

  it("polls at the configured interval and closes when authorization completes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onClose = vi.fn();
    mockInvoke.mockResolvedValueOnce(fakeInit); // github_start_device_flow
    mockInvoke.mockResolvedValueOnce({ done: false, token: null, slowDown: false }); // first poll
    mockInvoke.mockResolvedValueOnce({ done: true, token: "gho_secret", slowDown: false }); // second poll

    render(<DeviceFlowModal host="github.com" onClose={onClose} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(fakeInit.interval * 1000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(fakeInit.interval * 1000);
    });

    expect(mockInvoke).toHaveBeenCalledWith("github_poll_device_flow", {
      host: "github.com",
      deviceCode: "device-abc",
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("backs off the polling interval when GitHub responds with slow_down", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onClose = vi.fn();
    const pollCalls = () =>
      mockInvoke.mock.calls.filter(([command]) => command === "github_poll_device_flow").length;
    mockInvoke.mockResolvedValueOnce(fakeInit); // github_start_device_flow
    mockInvoke.mockResolvedValueOnce({ done: false, token: null, slowDown: true }); // first poll: back off
    mockInvoke.mockResolvedValueOnce({ done: true, token: "gho_secret", slowDown: false }); // second poll: done

    render(<DeviceFlowModal host="github.com" onClose={onClose} />);

    // First poll fires at the originally configured interval.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(fakeInit.interval * 1000);
    });
    expect(pollCalls()).toBe(1);

    // Waiting the *original* interval again is not enough — slow_down must
    // add at least 5 more seconds before the next poll fires.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(fakeInit.interval * 1000);
    });
    expect(pollCalls()).toBe(1);

    // Once the extra backoff has elapsed, polling resumes and completes.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("cancel button stops the flow and closes the modal", async () => {
    const onClose = vi.fn();
    mockInvoke.mockResolvedValueOnce(fakeInit);

    render(<DeviceFlowModal host="github.com" onClose={onClose} />);

    const cancelButton = await screen.findByRole("button", { name: /cancel/i });
    fireEvent.click(cancelButton);

    expect(onClose).toHaveBeenCalled();
    expect(useGithubStore.getState().deviceFlowInit).toBeNull();
  });
});
