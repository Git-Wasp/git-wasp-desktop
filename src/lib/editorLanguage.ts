import { StreamLanguage, type StreamParser } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { javascript, json, typescript } from "@codemirror/legacy-modes/mode/javascript";
import {
  c,
  cpp,
  csharp,
  dart,
  java,
  kotlin,
  objectiveC,
  scala,
} from "@codemirror/legacy-modes/mode/clike";
import { python } from "@codemirror/legacy-modes/mode/python";
import { rust } from "@codemirror/legacy-modes/mode/rust";
import { go } from "@codemirror/legacy-modes/mode/go";
import { css, less, sCSS } from "@codemirror/legacy-modes/mode/css";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { html, xml } from "@codemirror/legacy-modes/mode/xml";
import { standardSQL } from "@codemirror/legacy-modes/mode/sql";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { haskell } from "@codemirror/legacy-modes/mode/haskell";
import { perl } from "@codemirror/legacy-modes/mode/perl";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { powerShell } from "@codemirror/legacy-modes/mode/powershell";

// Map a lowercased file extension → legacy stream-mode parser. These ship in
// the already-bundled `@codemirror/legacy-modes`, so no new dependency.
const MODE_BY_EXT: Record<string, StreamParser<unknown>> = {
  js: javascript,
  mjs: javascript,
  cjs: javascript,
  jsx: javascript,
  ts: typescript,
  tsx: typescript,
  json: json,
  py: python,
  rs: rust,
  go: go,
  c: c,
  h: c,
  cc: cpp,
  cpp: cpp,
  cxx: cpp,
  hpp: cpp,
  hh: cpp,
  java: java,
  cs: csharp,
  kt: kotlin,
  kts: kotlin,
  scala: scala,
  sbt: scala,
  m: objectiveC,
  dart: dart,
  css: css,
  scss: sCSS,
  less: less,
  rb: ruby,
  sh: shell,
  bash: shell,
  zsh: shell,
  yaml: yaml,
  yml: yaml,
  toml: toml,
  xml: xml,
  svg: xml,
  html: html,
  htm: html,
  sql: standardSQL,
  swift: swift,
  lua: lua,
  hs: haskell,
  pl: perl,
  pm: perl,
  ps1: powerShell,
  ini: properties,
  conf: properties,
  properties: properties,
};

// Extension-less files keyed by their (lowercased) base name.
const MODE_BY_FILENAME: Record<string, StreamParser<unknown>> = {
  dockerfile: dockerFile,
};

function baseName(path: string): string {
  const normalised = path.replace(/\\/g, "/");
  return normalised.slice(normalised.lastIndexOf("/") + 1);
}

/** The lowercased extension of a path (without the dot), or "" if none. */
export function fileExtension(path: string): string {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  // dot > 0 so dotfiles (".gitignore") aren't treated as all-extension.
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/**
 * A CodeMirror language extension for a file path's type, or `null` when no mode
 * is known (the editor then renders plain, un-highlighted text). Recognised
 * extension-less filenames (e.g. `Dockerfile`) are matched first.
 */
export function languageForPath(path: string): Extension | null {
  const byName = MODE_BY_FILENAME[baseName(path).toLowerCase()];
  if (byName) return StreamLanguage.define(byName);
  const mode = MODE_BY_EXT[fileExtension(path)];
  return mode ? StreamLanguage.define(mode) : null;
}
