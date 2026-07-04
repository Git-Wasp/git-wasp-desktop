/**
 * A deliberately small, dependency-free markdown renderer for commit-message
 * previews. It supports the "basic" subset: headings, bold/italic, inline code,
 * fenced code blocks, ordered/unordered lists, links and paragraphs.
 *
 * Safety: the input is HTML-escaped *first*, then our own tags are introduced,
 * so user text can never inject markup. Link schemes are allow-listed to keep
 * `javascript:` and friends out.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Placeholder wrapping links/code while bold/italic run, so their attributes
// aren't reprocessed. Uses plain text (no control chars) that won't appear in
// real input.
const STASH_OPEN = "MD";
const STASH_CLOSE = "MD";

function inline(text: string): string {
  const stashed: string[] = [];
  const stash = (html: string) => {
    stashed.push(html);
    return `${STASH_OPEN}${stashed.length - 1}${STASH_CLOSE}`;
  };

  // Links — stashed so their attributes aren't reprocessed by bold/italic.
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label: string, url: string) => {
    const href = url.trim();
    if (!/^(https?:|mailto:|\/|#)/i.test(href)) return label; // drop unsafe schemes
    return stash(`<a href="${href}" rel="noreferrer noopener">${label}</a>`);
  });

  // Inline code — stashed so its contents stay literal.
  text = text.replace(/`([^`]+)`/g, (_m, code: string) => stash(`<code>${code}</code>`));

  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/_([^_]+)_/g, "<em>$1</em>");
  text = text.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  return text.replace(
    new RegExp(`${STASH_OPEN}(\\d+)${STASH_CLOSE}`, "g"),
    (_m, i: string) => stashed[Number(i)],
  );
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const UL_ITEM = /^[-*]\s+/;
const OL_ITEM = /^\d+\.\s+/;

/** The two tabs of a markdown editor (compose vs. rendered preview). Shared by
 *  the commit form and the PR form, which both use `renderMarkdown` for preview. */
export type MarkdownTab = "write" | "preview";

export function renderMarkdown(src: string): string {
  if (!src || !src.trim()) return "";

  const lines = escapeHtml(src).replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    if (line.trim().startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        body.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      blocks.push(`<pre><code>${body.join("\n")}</code></pre>`);
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${inline(heading[2].trim())}</h${level}>`);
      i++;
      continue;
    }

    if (UL_ITEM.test(line)) {
      const items: string[] = [];
      while (i < lines.length && UL_ITEM.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(UL_ITEM, ""))}</li>`);
        i++;
      }
      blocks.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    if (OL_ITEM.test(line)) {
      const items: string[] = [];
      while (i < lines.length && OL_ITEM.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(OL_ITEM, ""))}</li>`);
        i++;
      }
      blocks.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !HEADING.test(lines[i]) &&
      !UL_ITEM.test(lines[i]) &&
      !OL_ITEM.test(lines[i]) &&
      !lines[i].trim().startsWith("```")
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(`<p>${inline(para.join("<br>"))}</p>`);
  }

  return blocks.join("\n");
}
