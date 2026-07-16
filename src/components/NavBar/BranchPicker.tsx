import { useMemo, useState } from "react";
import { useRepoStore } from "../../stores/repoStore";
import { useGraphStore } from "../../stores/graphStore";
import { Dropdown, DropdownItem } from "../ui/Dropdown";
import { Input } from "../ui/Input";
import { BranchIcon, CheckIcon, GitHubIcon, LaptopIcon } from "../ui/icons";

// Show the filter box only once the list is long enough to warrant it.
const FILTER_THRESHOLD = 8;

interface BranchEntry {
  /** The ref to act on: a local branch name, or a remote ref like "origin/x". */
  name: string;
  kind: "local" | "remote";
  isCurrent: boolean;
}

/** The branch short name of a remote ref ("origin/feature/x" -> "feature/x"). */
function shortName(remoteRef: string): string {
  const i = remoteRef.indexOf("/");
  return i === -1 ? remoteRef : remoteRef.slice(i + 1);
}

/**
 * NavBar branch picker: the trigger shows the current checked-out branch. The
 * panel lists local branches (current one first) followed by remote-only
 * branches — remotes whose short name already exists locally are hidden to avoid
 * duplicates. Local/remote rows carry the same icons as the graph's branch pills
 * (laptop / GitHub); the current branch shows a check. Selecting a local branch
 * checks it out; selecting a remote one creates a local tracking branch and
 * checks that out. Hidden when no repo is open.
 */
export function BranchPicker() {
  const currentRepo = useRepoStore((s) => s.currentRepo);
  const branches = useRepoStore((s) => s.branches);
  const checkoutBranch = useRepoStore((s) => s.checkoutBranch);
  const checkoutRemoteBranch = useRepoStore((s) => s.checkoutRemoteBranch);
  const refresh = useGraphStore((s) => s.refresh);
  const [filter, setFilter] = useState("");

  const current = currentRepo?.headBranch ?? null;

  const entries = useMemo<BranchEntry[]>(() => {
    const locals = branches.filter((b) => !b.isRemote);
    const localNames = new Set(locals.map((b) => b.name));
    const localEntries: BranchEntry[] = locals.map((b) => ({
      name: b.name,
      kind: "local",
      isCurrent: b.name === current,
    }));
    // Current branch first, then the rest in their existing order.
    localEntries.sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent));

    const remoteEntries: BranchEntry[] = branches
      .filter((b) => b.isRemote)
      .filter((b) => {
        const s = shortName(b.name);
        // Drop the symbolic origin/HEAD and any remote already represented by a
        // local branch of the same short name.
        return s !== "HEAD" && !localNames.has(s);
      })
      .map((b) => ({ name: b.name, kind: "remote", isCurrent: false }));

    return [...localEntries, ...remoteEntries];
  }, [branches, current]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? entries.filter((e) => e.name.toLowerCase().includes(q)) : entries;
  }, [entries, filter]);

  if (!currentRepo) return null;

  const handleSelect = async (entry: BranchEntry) => {
    if (entry.isCurrent) return;
    if (entry.kind === "local") {
      // checkoutBranch now refreshes the graph internally — an explicit
      // refresh() here would just refresh a second time.
      await checkoutBranch(entry.name);
    } else {
      // checkoutRemoteBranch isn't one of the self-refreshing repoStore
      // actions, so it still needs an explicit refresh.
      await checkoutRemoteBranch(entry.name);
      await refresh();
    }
  };

  return (
    <Dropdown
      ariaLabel="Branch picker"
      panelMinWidth={240}
      onOpenChange={(open) => {
        if (open) setFilter("");
      }}
      trigger={
        <>
          <BranchIcon size={12} />
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontFamily: "var(--font-family-mono)",
            }}
          >
            {current ?? "detached"}
          </span>
        </>
      }
    >
      {(close) => (
        <>
          {entries.length >= FILTER_THRESHOLD && (
            <div style={{ padding: "var(--space-1)" }}>
              <Input
                autoFocus
                fullWidth
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter branches…"
                aria-label="Filter branches"
                style={{ fontFamily: "var(--font-family-mono)" }}
              />
            </div>
          )}
          {filtered.length === 0 ? (
            <div
              style={{
                padding: "var(--space-2)",
                fontSize: "var(--font-size-sm)",
                color: "var(--color-text-muted)",
                fontStyle: "italic",
              }}
            >
              No matching branches
            </div>
          ) : (
            filtered.map((entry) => (
              <DropdownItem
                key={`${entry.kind}:${entry.name}`}
                active={entry.isCurrent}
                title={entry.name}
                leading={
                  entry.isCurrent ? (
                    <CheckIcon />
                  ) : entry.kind === "remote" ? (
                    <GitHubIcon />
                  ) : (
                    <LaptopIcon />
                  )
                }
                onSelect={() => {
                  close();
                  void handleSelect(entry);
                }}
              >
                <span style={{ fontFamily: "var(--font-family-mono)" }}>{entry.name}</span>
              </DropdownItem>
            ))
          )}
        </>
      )}
    </Dropdown>
  );
}
