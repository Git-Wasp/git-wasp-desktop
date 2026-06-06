// Phase 4: pauseable async state machine for multi-step Git operations
// (merge with conflicts, future interactive rebase). Holds operation state
// server-side and exposes resume/abort/status commands to the frontend.
// Recovery state is persisted to .git/ for clean restart after shutdown.
