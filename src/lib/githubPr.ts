/**
 * Helpers for the "open a pull request" flow.
 *
 * `compareUrl` builds GitHub's "open a PR" compare page URL so the user can
 * finish creating the PR on GitHub.com / GHE instead of submitting through the
 * API. `headBranchIsOnRemote` tells the form whether a chosen head branch has
 * been pushed yet (GitHub rejects a PR whose head it has never seen).
 */

/** The minimal branch shape `headBranchIsOnRemote` needs. */
export interface BranchRef {
  name: string;
  isRemote: boolean;
  upstream: string | null;
}

/** Strip the remote name (first path segment) from a remote-tracking ref. */
function shortRemoteName(name: string): string {
  const slash = name.indexOf("/");
  return slash === -1 ? name : name.slice(slash + 1);
}

/**
 * Whether the local branch `head` already exists on the remote — i.e. it has a
 * configured upstream, or a remote-tracking branch of the same short name is
 * present. Used to decide between "Create" and "Push & create PR": GitHub 422s
 * a PR whose head branch it hasn't seen, so an unpushed branch must be pushed
 * first.
 */
export function headBranchIsOnRemote(head: string, branches: BranchRef[]): boolean {
  if (!head) return false;
  const local = branches.find((b) => !b.isRemote && b.name === head);
  if (local?.upstream) return true;
  return branches.some((b) => b.isRemote && shortRemoteName(b.name) === head);
}

/**
 * GitHub's compare page pre-fills a PR from the same fields we collect, so
 * "Continue on GitHub" hands the draft over without losing what's been typed.
 * Works for both github.com and GHE (the host is taken from the remote).
 */
export function compareUrl(opts: {
  host: string;
  owner: string;
  repo: string;
  base: string;
  head: string;
  title?: string;
  body?: string;
  assignees?: string[];
  labels?: string[];
}): string {
  const { host, owner, repo, base, head } = opts;
  const params = new URLSearchParams({ expand: "1" });
  if (opts.title?.trim()) params.set("title", opts.title);
  if (opts.body?.trim()) params.set("body", opts.body);
  if (opts.assignees?.length) params.set("assignees", opts.assignees.join(","));
  if (opts.labels?.length) params.set("labels", opts.labels.join(","));
  const range = `${encodeURIComponent(base)}...${encodeURIComponent(head)}`;
  return `https://${host}/${owner}/${repo}/compare/${range}?${params.toString()}`;
}
