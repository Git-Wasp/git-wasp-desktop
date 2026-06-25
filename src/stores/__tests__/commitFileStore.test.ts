import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useCommitFileStore } from "../commitFileStore";
import type { StageFileContents } from "../../types/workingTree";

const mockInvoke = vi.mocked(invoke);

const contents: StageFileContents = {
  headContent: "old\n",
  worktreeContent: "new\n",
  isBinary: false,
  worktreeExists: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  useCommitFileStore.setState({ oid: null, path: null, contents: null });
});

describe("commitFileStore", () => {
  it("loads the file contents for a commit path", async () => {
    mockInvoke.mockResolvedValueOnce(contents);

    await useCommitFileStore.getState().selectFile("abc", "src/main.rs", null);

    expect(mockInvoke).toHaveBeenCalledWith("get_commit_file_contents", {
      oid: "abc",
      path: "src/main.rs",
      oldPath: null,
    });
    const state = useCommitFileStore.getState();
    expect(state.oid).toBe("abc");
    expect(state.path).toBe("src/main.rs");
    expect(state.contents).toEqual(contents);
  });

  it("passes the pre-rename path through", async () => {
    mockInvoke.mockResolvedValueOnce(contents);

    await useCommitFileStore.getState().selectFile("abc", "new.rs", "old.rs");

    expect(mockInvoke).toHaveBeenCalledWith("get_commit_file_contents", {
      oid: "abc",
      path: "new.rs",
      oldPath: "old.rs",
    });
  });

  it("clears the open file", async () => {
    mockInvoke.mockResolvedValueOnce(contents);
    await useCommitFileStore.getState().selectFile("abc", "f.rs", null);

    useCommitFileStore.getState().clear();

    const state = useCommitFileStore.getState();
    expect(state.oid).toBeNull();
    expect(state.path).toBeNull();
    expect(state.contents).toBeNull();
  });

  it("drops a stale response when the selection has moved on", async () => {
    let resolveFirst: (v: StageFileContents) => void = () => {};
    mockInvoke.mockImplementationOnce(
      () => new Promise<StageFileContents>((r) => (resolveFirst = r)),
    );
    mockInvoke.mockResolvedValueOnce({ ...contents, worktreeContent: "second\n" });

    const first = useCommitFileStore.getState().selectFile("abc", "first.rs", null);
    await useCommitFileStore.getState().selectFile("abc", "second.rs", null);
    // The first request resolves late — it must not clobber the current file.
    resolveFirst(contents);
    await first;

    const state = useCommitFileStore.getState();
    expect(state.path).toBe("second.rs");
    expect(state.contents?.worktreeContent).toBe("second\n");
  });
});
