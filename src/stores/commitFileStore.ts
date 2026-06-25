import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { StageFileContents } from "../types/workingTree";

// Holds the file currently open in the read-only commit diff viewer (the
// main-panel staging editor surface, in read-only mode). The right-hand
// CommitDetail panel drives selection; App reads `contents` to render the diff.
interface CommitFileStore {
  /** The commit the open file belongs to (null when nothing is open). */
  oid: string | null;
  path: string | null;
  contents: StageFileContents | null;

  selectFile: (oid: string, path: string, oldPath: string | null) => Promise<void>;
  clear: () => void;
}

export const useCommitFileStore = create<CommitFileStore>((set, get) => ({
  oid: null,
  path: null,
  contents: null,

  selectFile: async (oid, path, oldPath) => {
    set({ oid, path, contents: null });
    const contents = await invoke<StageFileContents>("get_commit_file_contents", {
      oid,
      path,
      oldPath,
    });
    // Drop a late response if the selection has since moved on.
    if (get().oid === oid && get().path === path) set({ contents });
  },

  clear: () => set({ oid: null, path: null, contents: null }),
}));
