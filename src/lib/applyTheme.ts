import { setEditorAppearance, type Appearance } from "./editorTheme";

export const CUSTOM_STYLE_ID = "app-custom-theme";
export const THEME_CHANGE_EVENT = "app-theme-change";
const THEME_CACHE_KEY = "activeTheme";

export interface AppliedTheme {
  id: string;
  appearance: Appearance;
  builtin: boolean;
  /** Required for custom (non-builtin) themes. */
  css?: string;
}

/**
 * Strip CSS comments so a comment can't be used to split a dangerous keyword
 * across tokens (e.g. "@im", a comment, then "port"). Comments carry no visual
 * meaning, so dropping them entirely is safe — this is not attempting to respect comment
 * syntax that happens to appear inside a quoted string (a real CSS parser
 * wouldn't start a comment there either, but our regex can't tell the
 * difference; accepted as an over-strip risk, not a security gap).
 */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Build a regex fragment matching a single ASCII letter either literally or as
 * the CSS hex-escape sequence that decodes to it (e.g. `r`, or `\72` / `\072`
 * with up to a few leading zeros), optionally followed by the single
 * whitespace character that terminates a short hex escape. Confines
 * escape-decoding to the specific keywords we scan for (`@import`, `url(`)
 * rather than decoding the whole stylesheet, so legitimate escaped selectors
 * elsewhere in the file (e.g. `.hover\:bg-red`) are left untouched.
 */
function flexLetter(letter: string): string {
  const hex = letter.codePointAt(0)!.toString(16);
  return `(?:${letter}|\\\\0{0,4}${hex}[ \\t\\n\\r\\f]?)`;
}

function flexKeyword(word: string): string {
  return word.split("").map(flexLetter).join("");
}

const IMPORT_RE = new RegExp(`${flexLetter("@")}${flexKeyword("import")}[^;]*;?`, "gi");
const URL_OPEN_RE = new RegExp(`${flexKeyword("url")}\\(`, "gi");
const DANGEROUS_SCHEME_RE = /^(?:https?:)?\/\//i;
const WHITESPACE_RE = /\s/;

/**
 * Decode CSS escape sequences (hex, e.g. `\0068` → `h`, and identity escapes,
 * e.g. `\/` → `/`) so a scheme name hidden behind escapes (e.g.
 * `\0068ttps://evil.example`) resolves to the same string a real CSS parser
 * would resolve it to, before we check it against `DANGEROUS_SCHEME_RE`. A
 * literal-string scheme check alone can't see through this — that's exactly
 * how a bypass was found before this decoding step was added.
 *
 * A hex escape can spell a codepoint outside the valid Unicode range (e.g.
 * `\FFFFFF`) or a surrogate codepoint — `String.fromCodePoint` throws a
 * `RangeError` for both, which would otherwise crash theme application on a
 * malformed theme file. Per the CSS spec's own handling of invalid escapes,
 * substitute U+FFFD (replacement character) instead of throwing.
 */
function decodeCssEscapes(text: string): string {
  return text.replace(/\\([0-9a-f]{1,6})[ \t\n\r\f]?|\\(.)/gi, (_match, hex: string, literal: string) => {
    if (hex !== undefined) {
      const code = parseInt(hex, 16);
      const isValidCodePoint = !Number.isNaN(code) && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff);
      return isValidCodePoint ? String.fromCodePoint(code) : "�";
    }
    return literal;
  });
}

/**
 * Scans forward from `start` (the index immediately after "url(") for the
 * argument's extent, handling both quoted and unquoted forms. Returns the
 * raw (undecoded) argument text and the index just past the closing ")", or
 * `null` if the argument runs off the end of the string without a clean
 * close — an unterminated quoted string (no matching quote before EOF) or
 * trailing garbage between a closing quote and ")". The caller treats a
 * `null` result as unsafe and drops the rest of the stylesheet from `start`
 * onward, rather than guessing at where a malformed construct "really" ends.
 *
 * A hand-written linear scan, not a backtracking regex: a backtracking
 * pattern expressive enough to tell an escaped quote (`\"`, which does NOT
 * terminate the string) apart from a real closing quote is exactly the
 * shape that suffers catastrophic backtracking on a long run of backslashes
 * before an unterminated string — this scanner is O(n) with no ambiguity to
 * backtrack over.
 */
function scanUrlArgument(css: string, start: number): { arg: string; end: number } | null {
  let i = start;
  while (i < css.length && WHITESPACE_RE.test(css[i])) i++;
  const quote = css[i] === '"' || css[i] === "'" ? css[i] : null;
  if (quote) {
    const argStart = i + 1;
    i = argStart;
    while (i < css.length && css[i] !== quote) {
      i += css[i] === "\\" ? 2 : 1;
    }
    if (i >= css.length) return null; // no closing quote before EOF
    const arg = css.slice(argStart, i);
    i++; // skip the closing quote
    while (i < css.length && WHITESPACE_RE.test(css[i])) i++;
    if (css[i] !== ")") return null; // trailing garbage before the close
    return { arg, end: i + 1 };
  }
  const argStart = i;
  while (i < css.length && css[i] !== ")" && css[i] !== "(") i++;
  if (css[i] !== ")") return null;
  return { arg: css.slice(argStart, i).trimEnd(), end: i + 1 };
}

/**
 * Replace `url(...)` calls whose argument resolves (after decoding any CSS
 * escapes within it) to an external scheme with a neutered `url()`. Decoding
 * is scoped strictly to each call's own argument — never the whole
 * stylesheet — so legitimate escaped selectors elsewhere (e.g.
 * `.hover\:bg-red`) are left untouched. Keeps `url(data:...)` (inline assets)
 * and same-origin-relative `url()` intact. A `url(` whose argument can't be
 * cleanly resolved (an unterminated quoted string, most notably) is treated
 * as unsafe: everything from that `url(` to the end of the stylesheet is
 * dropped, rather than assuming a browser's own malformed-CSS recovery makes
 * it inert.
 */
function sanitizeUrlFunctions(css: string): string {
  let result = "";
  let cursor = 0;
  URL_OPEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_OPEN_RE.exec(css))) {
    const argStart = m.index + m[0].length;
    const scanned = scanUrlArgument(css, argStart);
    if (!scanned) {
      return result + css.slice(cursor, m.index) + "url()";
    }
    const decoded = decodeCssEscapes(scanned.arg).trim();
    const replacement = DANGEROUS_SCHEME_RE.test(decoded) ? "url()" : css.slice(m.index, scanned.end);
    result += css.slice(cursor, m.index) + replacement;
    cursor = scanned.end;
    URL_OPEN_RE.lastIndex = scanned.end;
  }
  return result + css.slice(cursor);
}

/**
 * Strip constructs a malicious theme file could use to exfiltrate data or make
 * arbitrary network requests even under a strict CSP applied to the page itself
 * (CSS `@import`/`url()` are not gated by the page's `style-src` the same way a
 * `<script src>` is) — full external URLs in `@import` and `url(...)`. Keeps
 * `url(data:...)` (inline assets) and same-origin-relative `url()` intact.
 *
 * Hardened beyond a literal `@import`/`url(` string match against: case
 * variation, whitespace/newlines inside `url(...)`, protocol-relative URLs
 * (`//evil.example`), a CSS comment splitting the keyword mid-token (e.g. "@im",
 * a comment, then "port"), CSS unicode-escape obfuscation of the keyword itself
 * (e.g. `\75rl(`, `\40 \69mport`), CSS unicode-escape obfuscation of the
 * URL's own scheme/value (e.g. `url(\0068ttps://evil.example)`), and an
 * unterminated quoted argument used to smuggle a scheme past the argument
 * matcher entirely. A full CSS parser is out of scope; this is targeted
 * hardening (regex for keyword/comment handling, a linear hand-written scan
 * for `url()` argument extraction — see `scanUrlArgument`) against the
 * specific bypass classes above, not a guarantee against every conceivable
 * obfuscation.
 */
export function sanitizeThemeCss(css: string): string {
  const normalized = stripCssComments(css);
  return sanitizeUrlFunctions(normalized.replace(IMPORT_RE, ""));
}

function customStyleElement(): HTMLStyleElement {
  let el = document.getElementById(CUSTOM_STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = CUSTOM_STYLE_ID;
    document.head.appendChild(el);
  }
  return el;
}

/**
 * Applies a theme to the document. Built-in themes select a `data-theme` block
 * in the bundled token layer by id (e.g. "light", "github-dark"); "dark" is the
 * `:root` default, so it clears the attribute instead. Custom themes inject their
 * CSS into a single `<style>` element appended after the token layer so the later
 * cascade wins. Editor syntax appearance is updated to match.
 */
export function applyTheme(theme: AppliedTheme): void {
  const root = document.documentElement;

  if (theme.builtin) {
    document.getElementById(CUSTOM_STYLE_ID)?.remove();
    if (theme.id === "dark") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme.id);
  } else {
    root.removeAttribute("data-theme");
    customStyleElement().textContent = sanitizeThemeCss(theme.css ?? "");
  }

  setEditorAppearance(theme.appearance);

  // Canvas-rendered surfaces (the commit graph) read their colours from CSS
  // tokens, so they need a nudge to re-resolve and redraw on a theme change.
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

/**
 * Remember the active theme locally so it can be applied synchronously on the
 * next launch (see [`applyCachedTheme`]). The authoritative value still lives in
 * the backend; this is only a fast-path cache to avoid the default-theme flash
 * while that async load completes. Custom themes cache their CSS too.
 */
export function cacheActiveTheme(theme: AppliedTheme): void {
  try {
    localStorage.setItem(THEME_CACHE_KEY, JSON.stringify(theme));
  } catch {
    /* caching is best-effort */
  }
}

/**
 * Apply the cached theme (if any) immediately — call this before the first React
 * render so the app paints in the user's theme rather than flashing the default
 * and switching once the backend load resolves. A no-op when nothing is cached.
 */
export function applyCachedTheme(): void {
  try {
    const raw = localStorage.getItem(THEME_CACHE_KEY);
    if (!raw) return;
    const theme = JSON.parse(raw) as AppliedTheme;
    if (theme && typeof theme.id === "string" && typeof theme.appearance === "string") {
      applyTheme(theme);
    }
  } catch {
    /* ignore a malformed cache — the backend load will set the real theme */
  }
}
