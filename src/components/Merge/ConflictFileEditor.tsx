import { useEffect, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";
import type { ConflictBlock, ConflictedFile } from "../../types/merge";
import { acceptBlockEdit, isBlockResolved } from "../../lib/conflictBlocks";

interface ConflictFileEditorProps {
  file: ConflictedFile;
  onMarkResolved: (path: string, content: string) => void;
}

const paneTheme = EditorView.theme({
  "&": {
    backgroundColor: "var(--color-bg-surface)",
    fontFamily: "var(--font-family-mono)",
    fontSize: "var(--font-size-sm)",
    height: "100%",
  },
  ".cm-scroller": { overflow: "auto" },
  ".cm-gutters": { backgroundColor: "var(--color-bg-elevated)", border: "none" },
});

const paneLabelStyle: React.CSSProperties = {
  padding: "var(--space-1) var(--space-2)",
  fontSize: "var(--font-size-sm)",
  fontWeight: 500,
  color: "var(--color-text-secondary)",
  borderBottom: "1px solid var(--color-border-subtle)",
};

const acceptButtonStyle: React.CSSProperties = {
  padding: "var(--space-1) var(--space-2)",
  fontSize: "var(--font-size-sm)",
  border: "1px solid var(--color-border-subtle)",
  borderRadius: "var(--radius-sm)",
  background: "transparent",
  color: "var(--color-text-secondary)",
  cursor: "pointer",
};

function ReadOnlyPane({ label, content }: { label: string; content: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const view = new EditorView({
      state: EditorState.create({
        doc: content,
        extensions: [lineNumbers(), oneDark, paneTheme, EditorState.readOnly.of(true), EditorView.lineWrapping],
      }),
      parent: containerRef.current,
    });

    return () => view.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={paneLabelStyle}>{label}</div>
      <div ref={containerRef} style={{ flex: 1, minHeight: 0, overflow: "hidden" }} />
    </div>
  );
}

export function ConflictFileEditor({ file, onMarkResolved }: ConflictFileEditorProps) {
  const seeded = file.seededResult ?? "";
  const resultContainerRef = useRef<HTMLDivElement>(null);
  const resultViewRef = useRef<EditorView | null>(null);
  const [resultContent, setResultContent] = useState(seeded);

  useEffect(() => {
    if (!resultContainerRef.current) return;

    const view = new EditorView({
      state: EditorState.create({
        doc: seeded,
        extensions: [
          lineNumbers(),
          oneDark,
          paneTheme,
          EditorView.lineWrapping,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              setResultContent(update.state.doc.toString());
            }
          }),
        ],
      }),
      parent: resultContainerRef.current,
    });
    resultViewRef.current = view;

    return () => {
      view.destroy();
      resultViewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.path]);

  function acceptSide(block: ConflictBlock, side: "ours" | "theirs") {
    const view = resultViewRef.current;
    if (!view) return;

    const edit = acceptBlockEdit(view.state.doc.toString(), seeded, block, side);
    if (!edit) return;

    view.dispatch({ changes: edit });
  }

  function handleMarkResolved() {
    onMarkResolved(file.path, resultViewRef.current?.state.doc.toString() ?? resultContent);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          height: "50%",
          minHeight: 0,
          gap: "1px",
          background: "var(--color-border-subtle)",
        }}
      >
        <ReadOnlyPane label="Source" content={file.theirsContent ?? ""} />
        <ReadOnlyPane label="Current" content={file.oursContent ?? ""} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", height: "50%", minHeight: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "var(--space-1) var(--space-2)",
            borderBottom: "1px solid var(--color-border-subtle)",
            borderTop: "1px solid var(--color-border-subtle)",
          }}
        >
          <span style={{ fontSize: "var(--font-size-sm)", fontWeight: 500, color: "var(--color-text-secondary)" }}>
            Result
          </span>
          <button
            type="button"
            onClick={handleMarkResolved}
            style={{
              padding: "var(--space-1) var(--space-2)",
              fontSize: "var(--font-size-sm)",
              background: "var(--color-accent-primary)",
              color: "#fff",
              border: "none",
              borderRadius: "var(--radius-sm)",
              cursor: "pointer",
            }}
          >
            Mark resolved
          </button>
        </div>
        {file.conflictBlocks.length > 0 && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "var(--space-3)",
              padding: "var(--space-1) var(--space-2)",
              borderBottom: "1px solid var(--color-border-subtle)",
            }}
          >
            {file.conflictBlocks.map((block, index) => {
              const resolved = isBlockResolved(resultContent, seeded, block);
              return (
                <div key={index} style={{ display: "flex", alignItems: "center", gap: "var(--space-1)" }}>
                  <span style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-secondary)" }}>
                    Conflict {index + 1}
                    {resolved ? " — resolved" : ""}
                  </span>
                  <button type="button" onClick={() => acceptSide(block, "theirs")} style={acceptButtonStyle}>
                    Accept source
                  </button>
                  <button type="button" onClick={() => acceptSide(block, "ours")} style={acceptButtonStyle}>
                    Accept current
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <div ref={resultContainerRef} data-testid="result-pane" style={{ flex: 1, minHeight: 0, overflow: "hidden" }} />
      </div>
    </div>
  );
}
