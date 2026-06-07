import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useGithubStore } from "../githubStore";

const mockInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
  useGithubStore.setState({
    authStatus: {},
    remoteInfo: null,
    pullRequests: [],
    githubRepos: [],
    deviceFlowInit: null,
    isAuthenticating: false,
  });
});

describe("githubStore", () => {
  it("init checks github.com auth status even when no repo is open", async () => {
    mockInvoke.mockResolvedValueOnce(true); // github_auth_status("github.com")
    mockInvoke.mockRejectedValueOnce(new Error("no 'origin' remote configured")); // detect_remote_info

    await useGithubStore.getState().init();

    expect(mockInvoke).toHaveBeenCalledWith("github_auth_status", { host: "github.com" });
    expect(useGithubStore.getState().authStatus["github.com"]).toBe(true);
    expect(useGithubStore.getState().remoteInfo).toBeNull();
  });

  it("detectRemote populates remoteInfo and checks auth status", async () => {
    const remoteInfo = { host: "github.com", owner: "mike", repo: "gitclient", protocol: "https" as const };
    mockInvoke.mockResolvedValueOnce(remoteInfo); // detect_remote_info
    mockInvoke.mockResolvedValueOnce(true); // github_auth_status

    await useGithubStore.getState().detectRemote();

    expect(mockInvoke).toHaveBeenCalledWith("detect_remote_info");
    expect(mockInvoke).toHaveBeenCalledWith("github_auth_status", { host: "github.com" });
    expect(useGithubStore.getState().remoteInfo).toEqual(remoteInfo);
    expect(useGithubStore.getState().authStatus["github.com"]).toBe(true);
  });

  it("detectRemote clears remoteInfo when no GitHub remote is configured", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("no recognised remote"));

    await useGithubStore.getState().detectRemote();

    expect(useGithubStore.getState().remoteInfo).toBeNull();
  });

  it("startDeviceFlow stores the init payload and marks authenticating", async () => {
    const init = {
      userCode: "WXYZ-1234",
      verificationUri: "https://github.com/login/device",
      deviceCode: "device-abc",
      expiresIn: 900,
      interval: 5,
    };
    mockInvoke.mockResolvedValueOnce(init);

    await useGithubStore.getState().startDeviceFlow("github.com");

    expect(mockInvoke).toHaveBeenCalledWith("github_start_device_flow", { host: "github.com" });
    expect(useGithubStore.getState().deviceFlowInit).toEqual(init);
    expect(useGithubStore.getState().isAuthenticating).toBe(true);
  });

  it("startDeviceFlow ignores a concurrent call while one is already starting", async () => {
    const init = {
      userCode: "WXYZ-1234",
      verificationUri: "https://github.com/login/device",
      deviceCode: "device-abc",
      expiresIn: 900,
      interval: 5,
    };
    let resolveInvoke: (value: typeof init) => void = () => {};
    mockInvoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveInvoke = resolve;
        }),
    );

    const first = useGithubStore.getState().startDeviceFlow("github.com");
    const second = useGithubStore.getState().startDeviceFlow("github.com");
    resolveInvoke(init);
    await Promise.all([first, second]);

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(useGithubStore.getState().deviceFlowInit).toEqual(init);
  });

  it("startDeviceFlow resets isAuthenticating on failure so it can be retried", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("device code request failed"));

    await expect(useGithubStore.getState().startDeviceFlow("github.com")).rejects.toThrow(
      "device code request failed",
    );

    expect(useGithubStore.getState().isAuthenticating).toBe(false);
    expect(useGithubStore.getState().deviceFlowInit).toBeNull();
  });

  it("pollDeviceFlow returns pending result without changing state", async () => {
    useGithubStore.setState({
      deviceFlowInit: {
        userCode: "WXYZ-1234",
        verificationUri: "https://github.com/login/device",
        deviceCode: "device-abc",
        expiresIn: 900,
        interval: 5,
      },
      isAuthenticating: true,
    });
    mockInvoke.mockResolvedValueOnce({ done: false, token: null });

    const result = await useGithubStore.getState().pollDeviceFlow("github.com");

    expect(mockInvoke).toHaveBeenCalledWith("github_poll_device_flow", {
      host: "github.com",
      deviceCode: "device-abc",
    });
    expect(result.done).toBe(false);
    expect(useGithubStore.getState().isAuthenticating).toBe(true);
    expect(useGithubStore.getState().deviceFlowInit).not.toBeNull();
  });

  it("pollDeviceFlow clears flow state and marks authenticated when done", async () => {
    useGithubStore.setState({
      deviceFlowInit: {
        userCode: "WXYZ-1234",
        verificationUri: "https://github.com/login/device",
        deviceCode: "device-abc",
        expiresIn: 900,
        interval: 5,
      },
      isAuthenticating: true,
    });
    mockInvoke.mockResolvedValueOnce({ done: true, token: "gho_secret" });

    const result = await useGithubStore.getState().pollDeviceFlow("github.com");

    expect(result.done).toBe(true);
    expect(useGithubStore.getState().deviceFlowInit).toBeNull();
    expect(useGithubStore.getState().isAuthenticating).toBe(false);
    expect(useGithubStore.getState().authStatus["github.com"]).toBe(true);
  });

  it("logout calls github_logout and clears auth status for that host", async () => {
    useGithubStore.setState({ authStatus: { "github.com": true } });
    mockInvoke.mockResolvedValueOnce(undefined);

    await useGithubStore.getState().logout("github.com");

    expect(mockInvoke).toHaveBeenCalledWith("github_logout", { host: "github.com" });
    expect(useGithubStore.getState().authStatus["github.com"]).toBe(false);
  });

  it("loadPullRequests populates pullRequests", async () => {
    const prs = [
      {
        number: 1,
        title: "Add feature",
        author: "mike",
        headRef: "feat/x",
        baseRef: "main",
        url: "https://github.com/mike/gitclient/pull/1",
        ciStatus: "success" as const,
        approvalCount: 2,
      },
    ];
    mockInvoke.mockResolvedValueOnce(prs);

    await useGithubStore.getState().loadPullRequests("github.com");

    expect(mockInvoke).toHaveBeenCalledWith("list_pull_requests", { host: "github.com" });
    expect(useGithubStore.getState().pullRequests).toEqual(prs);
  });

  it("createPullRequest invokes create_pull_request and prepends the result", async () => {
    const pr = {
      number: 2,
      title: "New PR",
      author: "mike",
      headRef: "feat/y",
      baseRef: "main",
      url: "https://github.com/mike/gitclient/pull/2",
      ciStatus: "none" as const,
      approvalCount: 0,
    };
    mockInvoke.mockResolvedValueOnce(pr);

    const result = await useGithubStore
      .getState()
      .createPullRequest("github.com", "New PR", "body", "feat/y", "main");

    expect(mockInvoke).toHaveBeenCalledWith("create_pull_request", {
      host: "github.com",
      title: "New PR",
      body: "body",
      head: "feat/y",
      base: "main",
    });
    expect(result).toEqual(pr);
    expect(useGithubStore.getState().pullRequests[0]).toEqual(pr);
  });
});
