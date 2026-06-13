import { describe, expect, it, beforeEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  editorThemeExtension,
  getEditorAppearance,
  registerEditorView,
  setEditorAppearance,
} from "./editorTheme";

beforeEach(() => {
  setEditorAppearance("dark");
});

function mountView() {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    state: EditorState.create({ doc: "hello", extensions: [editorThemeExtension()] }),
    parent,
  });
  return view;
}

describe("editorTheme", () => {
  it("defaults to dark appearance", () => {
    expect(getEditorAppearance()).toBe("dark");
  });

  it("tracks the current appearance", () => {
    setEditorAppearance("light");
    expect(getEditorAppearance()).toBe("light");
  });

  it("reconfigures a registered view without error", () => {
    const view = mountView();
    const unregister = registerEditorView(view);

    expect(() => setEditorAppearance("light")).not.toThrow();
    expect(() => setEditorAppearance("dark")).not.toThrow();
    expect(view.state.doc.toString()).toBe("hello");

    unregister();
    expect(() => setEditorAppearance("light")).not.toThrow();
    view.destroy();
  });
});
