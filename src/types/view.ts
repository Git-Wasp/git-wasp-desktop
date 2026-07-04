// Shared UI-view string-union types.
//
// Convention: string-union types (and sentinels) that cross module boundaries
// — or that pair with a backend value — live in `src/types/` and are imported
// where needed, so there's a single source of truth and no drift between
// duplicate definitions. Single-file discriminated unions (e.g. a component's
// local `PromptState` / `ViewMode`) stay local, since TypeScript already
// type-checks their literals at every use site.

/** The top-level NavBar view. */
export type View = "history" | "prs" | "settings";

/**
 * In the history view, the right panel shows either a commit's detail or the
 * uncommitted-changes list (when the working-tree node is active).
 */
export type HistoryRightMode = "commit" | "uncommitted";
