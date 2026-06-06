import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { StreamLanguage } from "@codemirror/language";
import { diff } from "@codemirror/legacy-modes/mode/diff";
import { oneDark } from "@codemirror/theme-one-dark";

interface DiffViewerProps {
  content: string;
}

const diffLang = StreamLanguage.define(diff);

const tokenTheme = EditorView.theme({
  "&": {
    backgroundColor: "var(--color-bg-surface)",
    fontFamily: "var(--font-family-mono)",
    fontSize: "var(--font-size-sm)",
    height: "100%",
  },
  ".cm-scroller": { overflow: "auto" },
  ".cm-gutters": { backgroundColor: "var(--color-bg-elevated)", border: "none" },
});

export function DiffViewer({ content }: DiffViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  // Mount the editor once.
  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        diffLang,
        oneDark,
        tokenTheme,
        EditorState.readOnly.of(true),
        EditorView.lineWrapping,
      ],
    });

    viewRef.current = new EditorView({
      state,
      parent: containerRef.current,
    });

    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update content without recreating the view.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content },
    });
  }, [content]);

  return (
    <div
      ref={containerRef}
      style={{ height: "100%", overflow: "hidden" }}
    />
  );
}
