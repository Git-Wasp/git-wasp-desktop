import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";
import { GraphSearch } from "./GraphSearch";
import { useGraphStore } from "../../stores/graphStore";

const runSearch = vi.fn();
const nextMatch = vi.fn();
const prevMatch = vi.fn();
const closeSearch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  useGraphStore.setState({
    searchOpen: true,
    searchQuery: "",
    searchHits: [],
    searchMatchOids: new Set(),
    searchIndex: -1,
    runSearch,
    nextMatch,
    prevMatch,
    closeSearch,
  });
});

describe("GraphSearch", () => {
  it("debounces typing into a single backend search", async () => {
    render(<GraphSearch />);
    fireEvent.change(screen.getByLabelText("Search commits"), { target: { value: "fix" } });
    await waitFor(() => expect(runSearch).toHaveBeenCalledWith("fix"));
  });

  it("shows the current match position and total", () => {
    useGraphStore.setState({
      searchQuery: "fix",
      searchHits: [
        { row: 1, oid: "a" },
        { row: 2, oid: "b" },
        { row: 3, oid: "c" },
      ],
      searchIndex: 1,
    });
    render(<GraphSearch />);
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
  });

  it("says 'No matches' for a query with no results", () => {
    useGraphStore.setState({ searchQuery: "zzz", searchHits: [], searchIndex: -1 });
    render(<GraphSearch />);
    expect(screen.getByText("No matches")).toBeInTheDocument();
  });

  it("next/previous steppers are disabled with no matches and call the store when enabled", () => {
    const { rerender } = render(<GraphSearch />);
    expect(screen.getByRole("button", { name: "Next match" })).toBeDisabled();

    useGraphStore.setState({ searchHits: [{ row: 1, oid: "a" }], searchIndex: 0 });
    rerender(<GraphSearch />);
    fireEvent.click(screen.getByRole("button", { name: "Next match" }));
    expect(nextMatch).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Previous match" }));
    expect(prevMatch).toHaveBeenCalled();
  });

  it("Enter goes to the next match, Shift+Enter the previous, Esc closes", () => {
    useGraphStore.setState({ searchHits: [{ row: 1, oid: "a" }], searchIndex: 0 });
    render(<GraphSearch />);
    const input = screen.getByLabelText("Search commits");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(nextMatch).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(prevMatch).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(closeSearch).toHaveBeenCalledTimes(1);
  });

  it("the close button closes the search", () => {
    render(<GraphSearch />);
    fireEvent.click(screen.getByRole("button", { name: "Close search" }));
    expect(closeSearch).toHaveBeenCalled();
  });
});
