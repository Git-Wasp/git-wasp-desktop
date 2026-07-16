import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { invoke } from "@tauri-apps/api/core";
import { DiagnosticsSettings } from "./DiagnosticsSettings";
import { useToastStore } from "../../stores/toastStore";

const mockInvoke = vi.mocked(invoke);

const info = {
  enabled: false,
  logDir: "/home/u/logs",
  logFile: "/home/u/logs/gitclient.log",
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("DiagnosticsSettings", () => {
  it("shows the current state and log file path", async () => {
    mockInvoke.mockResolvedValueOnce(info); // get_diagnostics_info

    render(<DiagnosticsSettings />);

    expect(await screen.findByText("/home/u/logs/gitclient.log")).toBeInTheDocument();
    const toggle = screen.getByRole("switch", { name: /enable diagnostic logging/i });
    expect(toggle).not.toBeChecked();
  });

  it("toggles diagnostics on and persists the choice", async () => {
    mockInvoke.mockResolvedValueOnce(info); // get_diagnostics_info
    mockInvoke.mockResolvedValueOnce(undefined); // set_diagnostics

    render(<DiagnosticsSettings />);
    const toggle = await screen.findByRole("switch", { name: /enable diagnostic logging/i });

    fireEvent.click(toggle);

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("set_diagnostics", { enabled: true }),
    );
    await waitFor(() => expect(toggle).toBeChecked());
    expect(localStorage.getItem("diagnostics")).toBe("on");
  });

  it("reveals the log folder", async () => {
    mockInvoke.mockResolvedValueOnce(info); // get_diagnostics_info
    mockInvoke.mockResolvedValueOnce(undefined); // open_log_dir

    render(<DiagnosticsSettings />);
    fireEvent.click(await screen.findByRole("button", { name: /open log folder/i }));

    await waitFor(() => expect(mockInvoke).toHaveBeenCalledWith("open_log_dir"));
  });

  it("shows a toast instead of throwing when revealing the log folder fails", async () => {
    mockInvoke.mockResolvedValueOnce(info); // get_diagnostics_info
    mockInvoke.mockRejectedValueOnce(new Error("no file manager")); // open_log_dir
    const error = vi.fn();
    useToastStore.setState({ error });

    render(<DiagnosticsSettings />);
    fireEvent.click(await screen.findByRole("button", { name: /open log folder/i }));

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith("Error: no file manager", { title: "Couldn't open log folder" }),
    );
  });
});
