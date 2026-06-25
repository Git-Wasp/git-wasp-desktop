import { useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useRepoStore } from "../../stores/repoStore";
import { Dropdown, DropdownDivider, DropdownItem, DropdownLabel } from "../ui/Dropdown";
import { CheckIcon } from "../ui/icons";

/**
 * NavBar repo picker: the trigger shows the current repository name (or a prompt
 * when none is open) and the panel lists recent repositories plus an "Open
 * repository…" folder action. Replaces the standalone Open Repository button.
 */
export function RepoPicker() {
  const currentRepo = useRepoStore((s) => s.currentRepo);
  const recentRepos = useRepoStore((s) => s.recentRepos);
  const loadRecentRepos = useRepoStore((s) => s.loadRecentRepos);
  const openRepo = useRepoStore((s) => s.openRepo);

  useEffect(() => {
    loadRecentRepos();
  }, [loadRecentRepos]);

  const handleOpenFolder = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") await openRepo(selected);
  };

  return (
    <Dropdown
      ariaLabel="Repository picker"
      panelMinWidth={260}
      trigger={
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: "var(--font-weight-semibold)" }}>
          {currentRepo?.name ?? "Open a repository"}
        </span>
      }
    >
      {(close) => (
        <>
          {recentRepos.length > 0 && <DropdownLabel>Recent</DropdownLabel>}
          {recentRepos.map((r) => (
            <DropdownItem
              key={r.path}
              title={r.path}
              active={r.path === currentRepo?.path}
              leading={r.path === currentRepo?.path ? <CheckIcon /> : null}
              onSelect={() => {
                close();
                if (r.path !== currentRepo?.path) void openRepo(r.path);
              }}
            >
              {r.name}
            </DropdownItem>
          ))}
          {recentRepos.length > 0 && <DropdownDivider />}
          <DropdownItem
            onSelect={() => {
              close();
              void handleOpenFolder();
            }}
          >
            Open repository…
          </DropdownItem>
        </>
      )}
    </Dropdown>
  );
}
