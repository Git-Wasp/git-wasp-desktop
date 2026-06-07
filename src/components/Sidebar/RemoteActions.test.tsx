import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { RemoteActions } from "./RemoteActions";
import { useGithubStore } from "../../stores/githubStore";
import { useRemoteStore } from "../../stores/remoteStore";

beforeEach(() => {
  vi.clearAllMocks();
  useGithubStore.setState({
    authStatus: {},
    remoteInfo: { host: "github.com", owner: "mike", repo: "gitclient", protocol: "https" },
    pullRequests: [],
    githubRepos: [],
    deviceFlowInit: null,
    isAuthenticating: false,
  });
  useRemoteStore.setState({
    aheadBehind: [],
    isFetching: false,
    isPulling: false,
    isPushing: false,
    lastError: null,
    fetch: vi.fn().mockResolvedValue({ updatedRefs: [] }),
    pull: vi.fn().mockResolvedValue({ status: "AlreadyUpToDate" }),
    push: vi.fn().mockResolvedValue(undefined),
  });
});

describe("RemoteActions", () => {
  it("renders fetch, pull, and push buttons when a remote is detected", () => {
    render(<RemoteActions onOpenClone={vi.fn()} />);

    expect(screen.getByRole("button", { name: /fetch/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^pull$/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^push$/i })).toBeTruthy();
  });

  it("calls remoteStore.fetch when the Fetch button is clicked", () => {
    render(<RemoteActions onOpenClone={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /fetch/i }));

    expect(useRemoteStore.getState().fetch).toHaveBeenCalled();
  });

  it("disables the fetch button while a fetch is in progress", () => {
    useRemoteStore.setState({ isFetching: true });

    render(<RemoteActions onOpenClone={vi.fn()} />);

    expect(screen.getByRole("button", { name: /fetch/i })).toBeDisabled();
  });

  it("shows the last remote error when one is present", () => {
    useRemoteStore.setState({ lastError: "could not connect to remote" });

    render(<RemoteActions onOpenClone={vi.fn()} />);

    expect(screen.getByText(/could not connect to remote/i)).toBeTruthy();
  });

  it("calls onOpenClone when Clone from GitHub is clicked", () => {
    const onOpenClone = vi.fn();
    render(<RemoteActions onOpenClone={onOpenClone} />);

    fireEvent.click(screen.getByRole("button", { name: /clone from github/i }));

    expect(onOpenClone).toHaveBeenCalled();
  });
});
