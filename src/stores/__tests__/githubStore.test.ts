import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useGithubStore } from "../githubStore";
import { useRepoStore } from "../repoStore";

const mockInvoke = vi.mocked(invoke);

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

const connected = { state: "connected" as const, login: "mike", message: null };

describe("githubStore", () => {
  it("init validates the github.com connection even when no repo is open", async () => {
    mockInvoke.mockResolvedValueOnce(connected); // github_connection_status("github.com")
    mockInvoke.mockRejectedValueOnce(new Error("no 'origin' remote configured")); // detect_remote_info

    await useGithubStore.getState().init();

    expect(mockInvoke).toHaveBeenCalledWith("github_connection_status", { host: "github.com" });
    // init() awaited above always populates this key.
    expect(useGithubStore.getState().connections["github.com"]!.state).toBe("connected");
    expect(useGithubStore.getState().remoteInfo).toBeNull();
  });

  it("detectRemote populates remoteInfo and validates the connection", async () => {
    const remoteInfo = { host: "github.com", owner: "mike", repo: "gitclient", protocol: "https" as const };
    mockInvoke.mockResolvedValueOnce(remoteInfo); // detect_remote_info
    mockInvoke.mockResolvedValueOnce(connected); // github_connection_status

    await useGithubStore.getState().detectRemote();

    expect(mockInvoke).toHaveBeenCalledWith("detect_remote_info");
    expect(mockInvoke).toHaveBeenCalledWith("github_connection_status", { host: "github.com" });
    expect(useGithubStore.getState().remoteInfo).toEqual(remoteInfo);
    expect(useGithubStore.getState().connections["github.com"]).toEqual(connected);
  });

  it("checkConnection stores the validated status, and reports a failure as 'error'", async () => {
    mockInvoke.mockResolvedValueOnce({ state: "expired", login: null, message: null });
    await useGithubStore.getState().checkConnection("github.com");
    // checkConnection() awaited above always populates this key.
    expect(useGithubStore.getState().connections["github.com"]!.state).toBe("expired");

    mockInvoke.mockRejectedValueOnce(new Error("network down"));
    await useGithubStore.getState().checkConnection("github.com");
    const conn = useGithubStore.getState().connections["github.com"]!;
    expect(conn.state).toBe("error");
    expect(conn.message).toContain("network down");
  });

  it("detectRemote clears remoteInfo when no GitHub remote is configured", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("no recognised remote"));

    await useGithubStore.getState().detectRemote();

    expect(useGithubStore.getState().remoteInfo).toBeNull();
  });

  it("detectRemote discards a late response from before a repo switch", async () => {
    let resolveA: (v: { host: string; owner: string; repo: string; protocol: "https" }) => void;
    const pendingA = new Promise<{ host: string; owner: string; repo: string; protocol: "https" }>((r) => {
      resolveA = r;
    });
    mockInvoke.mockImplementationOnce(() => pendingA); // repo A's slow detect_remote_info

    const detectA = useGithubStore.getState().detectRemote();
    useRepoStore.setState({ activationEpoch: useRepoStore.getState().activationEpoch + 1 }); // repo switch happens

    const remoteInfoB = { host: "github.com", owner: "b", repo: "repoB", protocol: "https" as const };
    mockInvoke.mockResolvedValueOnce(remoteInfoB); // repo B's own (fast) detect_remote_info
    mockInvoke.mockResolvedValueOnce(connected); // checkConnection for B
    await useGithubStore.getState().detectRemote();

    resolveA!({ host: "github.com", owner: "a", repo: "repoA", protocol: "https" }); // repo A's late response
    await detectA;

    expect(useGithubStore.getState().remoteInfo).toEqual(remoteInfoB); // not clobbered by A's stale remote
  });

  it("detectRemote clears pullRequests when the remote changes to a different repo", async () => {
    useGithubStore.setState({
      remoteInfo: { host: "github.com", owner: "a", repo: "repoA", protocol: "https" },
      pullRequests: [
        {
          number: 1,
          title: "stale PR from repo A",
          author: "a",
          headRef: "h",
          baseRef: "main",
          url: "u",
          ciStatus: "none",
          approvalCount: 0,
        },
      ],
    });
    const remoteInfoB = { host: "github.com", owner: "b", repo: "repoB", protocol: "https" as const };
    mockInvoke.mockResolvedValueOnce(remoteInfoB); // detect_remote_info
    mockInvoke.mockResolvedValueOnce(connected); // checkConnection

    await useGithubStore.getState().detectRemote();

    expect(useGithubStore.getState().remoteInfo).toEqual(remoteInfoB);
    expect(useGithubStore.getState().pullRequests).toEqual([]);
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
    mockInvoke.mockResolvedValueOnce({ done: true, token: "gho_secret" }); // poll
    mockInvoke.mockResolvedValueOnce(connected); // checkConnection after success

    const result = await useGithubStore.getState().pollDeviceFlow("github.com");

    expect(result.done).toBe(true);
    expect(useGithubStore.getState().deviceFlowInit).toBeNull();
    expect(useGithubStore.getState().isAuthenticating).toBe(false);
    // pollDeviceFlow() awaited above always populates this key on success.
    expect(useGithubStore.getState().connections["github.com"]!.state).toBe("connected");
  });

  it("pollDeviceFlow clears isAuthenticating when the poll itself fails, not just completes", async () => {
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
    mockInvoke.mockRejectedValueOnce(new Error("network"));

    await expect(useGithubStore.getState().pollDeviceFlow("github.com")).rejects.toThrow("network");

    expect(useGithubStore.getState().isAuthenticating).toBe(false);
  });

  it("logout calls github_logout and marks the host disconnected", async () => {
    useGithubStore.setState({ connections: { "github.com": connected } });
    mockInvoke.mockResolvedValueOnce(undefined);

    await useGithubStore.getState().logout("github.com");

    expect(mockInvoke).toHaveBeenCalledWith("github_logout", { host: "github.com" });
    // setState above seeded this key, and logout() only updates it in place.
    expect(useGithubStore.getState().connections["github.com"]!.state).toBe("disconnected");
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
      assignees: [],
      labels: [],
    });
    expect(result).toEqual(pr);
    expect(useGithubStore.getState().pullRequests[0]).toEqual(pr);
  });
});
