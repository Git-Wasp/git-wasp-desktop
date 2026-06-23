import { describe, expect, it } from "vitest";
import { fileExtension, languageForPath } from "./editorLanguage";

describe("fileExtension", () => {
  it("returns the lowercased extension", () => {
    expect(fileExtension("src/App.TSX")).toBe("tsx");
    expect(fileExtension("a/b/c.rs")).toBe("rs");
  });

  it("handles paths with no extension and dotfiles", () => {
    expect(fileExtension("Makefile")).toBe("");
    expect(fileExtension(".gitignore")).toBe("");
  });

  it("uses only the final path segment", () => {
    expect(fileExtension("a.dir/file")).toBe("");
    expect(fileExtension("weird.folder/main.go")).toBe("go");
  });
});

describe("languageForPath", () => {
  it("returns a language extension for known file types", () => {
    for (const path of ["a.ts", "a.tsx", "a.js", "main.rs", "x.py", "s.css", "c.go", "q.sql"]) {
      expect(languageForPath(path)).not.toBeNull();
    }
  });

  it("matches recognised extension-less filenames", () => {
    expect(languageForPath("services/Dockerfile")).not.toBeNull();
  });

  it("returns null for unknown or extension-less files", () => {
    expect(languageForPath("notes.unknownext")).toBeNull();
    expect(languageForPath("LICENSE")).toBeNull();
  });
});
