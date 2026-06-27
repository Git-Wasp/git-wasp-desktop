/**
 * Helpers for the "open a pull request" flow.
 *
 * `compareUrl` builds GitHub's "open a PR" compare page URL so the user can
 * finish creating the PR on GitHub.com / GHE instead of submitting through the
 * API.
 */

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
