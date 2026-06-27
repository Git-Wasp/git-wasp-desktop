import { useState, type ReactNode } from "react";
import { Dropdown, DropdownItem } from "./Dropdown";
import { Input } from "./Input";
import { CheckIcon } from "./icons";

export interface MultiSelectOption {
  /** The stable value stored in `selected` and emitted by `onChange`. */
  value: string;
  /** Optional custom rendering for the row (e.g. a label colour swatch). */
  render?: ReactNode;
}

/**
 * A token-styled multi-select built on `Dropdown`: the trigger summarises the
 * current selection, the panel lists options as toggleable rows (a check marks
 * the selected ones) and a filter appears once the list is long. Used by the
 * PR form for assignees and labels, both populated from GitHub.
 */
export function MultiSelect({
  options,
  selected,
  onChange,
  ariaLabel,
  placeholder = "None selected",
  emptyLabel = "No options",
  disabled = false,
  filterThreshold = 8,
}: {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  ariaLabel: string;
  placeholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  filterThreshold?: number;
}) {
  const [filter, setFilter] = useState("");

  const toggle = (value: string) => {
    onChange(
      selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value],
    );
  };

  const summary =
    selected.length === 0
      ? placeholder
      : selected.length <= 3
        ? selected.join(", ")
        : `${selected.length} selected`;

  const visible =
    filter.trim() === ""
      ? options
      : options.filter((o) => o.value.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <Dropdown
      ariaLabel={ariaLabel}
      disabled={disabled}
      fullWidth
      panelMinWidth={220}
      onOpenChange={(open) => !open && setFilter("")}
      triggerStyle={{
        justifyContent: "space-between",
        background: "var(--color-bg-input)",
        border: "1px solid var(--color-border-subtle)",
      }}
      trigger={
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            color: selected.length === 0 ? "var(--color-text-muted)" : "var(--color-text-primary)",
            fontSize: "var(--font-size-sm)",
          }}
        >
          {summary}
        </span>
      }
    >
      {() => (
        <>
          {options.length >= filterThreshold && (
            <div style={{ padding: "var(--space-1)" }}>
              <Input
                fullWidth
                autoFocus
                placeholder="Filter…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
          )}
          {options.length === 0 ? (
            <div
              style={{
                padding: "var(--space-2)",
                fontSize: "var(--font-size-sm)",
                color: "var(--color-text-muted)",
              }}
            >
              {emptyLabel}
            </div>
          ) : (
            visible.map((o) => {
              const isSelected = selected.includes(o.value);
              return (
                <DropdownItem
                  key={o.value}
                  active={isSelected}
                  onSelect={() => toggle(o.value)}
                  leading={isSelected ? <CheckIcon size={12} /> : null}
                >
                  {o.render ?? o.value}
                </DropdownItem>
              );
            })
          )}
        </>
      )}
    </Dropdown>
  );
}
