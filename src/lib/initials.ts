/**
 * Author initials for avatar markers: the first letter of the first word plus
 * the first letter of the last word, uppercased (e.g. "Priya Natarajan" → "PN").
 * A single-word name yields one letter; an empty name yields "?". Used both by
 * the DOM author cell and the canvas commit-dot fallback so they always agree.
 */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : "";
  return (first + last).toUpperCase();
}
