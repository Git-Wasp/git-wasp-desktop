import { useEffect, useRef, useState } from "react";
import { useGraphStore } from "../../stores/graphStore";
import { Input } from "../ui/Input";
import { IconButton } from "../ui/IconButton";
import { ChevronDownIcon, ChevronUpIcon, CloseIcon } from "../ui/icons";

// Debounce between keystroke and backend search, so typing doesn't fire a query
// per character.
const SEARCH_DEBOUNCE_MS = 150;

/**
 * The floating commit-graph search panel: a text field (message / hash / author),
 * a match count, previous/next steppers, and a close button. Hovers at the
 * top-right of the graph so the action bar stays visible. Enter → next match,
 * Shift+Enter → previous, Esc → close.
 */
export function GraphSearch() {
  const runSearch = useGraphStore((s) => s.runSearch);
  const nextMatch = useGraphStore((s) => s.nextMatch);
  const prevMatch = useGraphStore((s) => s.prevMatch);
  const closeSearch = useGraphStore((s) => s.closeSearch);
  const storedQuery = useGraphStore((s) => s.searchQuery);
  const hitCount = useGraphStore((s) => s.searchHits.length);
  const searchIndex = useGraphStore((s) => s.searchIndex);

  const [text, setText] = useState(storedQuery);
  const inputRef = useRef<HTMLInputElement>(null);

  // Autofocus + select on open so the user can type (or replace) immediately.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Debounced search on input change.
  useEffect(() => {
    const id = window.setTimeout(() => void runSearch(text), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [text, runSearch]);

  const hasQuery = text.trim().length > 0;
  const countLabel = hitCount > 0 ? `${searchIndex + 1} / ${hitCount}` : hasQuery ? "No matches" : "";

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) prevMatch();
      else nextMatch();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeSearch();
    }
  };

  return (
    <div
      role="search"
      style={{
        position: "absolute",
        top: "var(--space-2)",
        right: "var(--space-3)",
        zIndex: 5,
        display: "flex",
        alignItems: "center",
        gap: "var(--space-1)",
        padding: "var(--space-1) var(--space-2)",
        background: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border-default)",
        borderRadius: "var(--radius-md)",
        boxShadow: "var(--shadow-md)",
      }}
    >
      <Input
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Search message, hash, author…"
        aria-label="Search commits"
        style={{ width: 240, height: "var(--control-height-sm)" }}
      />
      <span
        aria-live="polite"
        style={{
          minWidth: 56,
          textAlign: "center",
          fontSize: "var(--font-size-xs)",
          fontFamily: "var(--font-family-mono)",
          color: "var(--color-text-muted)",
          whiteSpace: "nowrap",
        }}
      >
        {countLabel}
      </span>
      <IconButton aria-label="Previous match" onClick={prevMatch} disabled={hitCount === 0}>
        <ChevronUpIcon />
      </IconButton>
      <IconButton aria-label="Next match" onClick={nextMatch} disabled={hitCount === 0}>
        <ChevronDownIcon />
      </IconButton>
      <IconButton aria-label="Close search" onClick={closeSearch}>
        <CloseIcon />
      </IconButton>
    </div>
  );
}
