/**
 * A compact, log-file-friendly relative date for the commit graph's date column
 * (e.g. "2 hours ago", "Yesterday", "3 days ago"). Anything older than a week
 * falls back to a short absolute date so distant history stays unambiguous.
 *
 * `unixSeconds` is a Git author/commit timestamp (seconds since the epoch, as the
 * backend returns it). `now` is injectable so tests are deterministic.
 */
export function formatRelativeDate(unixSeconds: number, now: number = Date.now()): string {
  const then = unixSeconds * 1000;
  const diffMs = now - then;
  const sec = Math.floor(diffMs / 1000);

  if (sec < 0) return "just now"; // clock skew — commit dated in the future
  if (sec < 60) return "just now";

  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;

  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;

  const day = Math.floor(hr / 24);
  if (day === 1) return "Yesterday";
  if (day < 7) return `${day} days ago`;

  // Older than a week — a short absolute date. Include the year only when it
  // differs from the current one, matching how a log tends to read.
  const d = new Date(then);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
