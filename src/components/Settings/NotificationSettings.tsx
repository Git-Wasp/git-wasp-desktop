import {
  useToastStore,
  type ToastHorizontal,
  type ToastVertical,
} from "../../stores/toastStore";
import { Button } from "../ui/Button";

const VERTICALS: ToastVertical[] = ["top", "middle", "bottom"];
const HORIZONTALS: ToastHorizontal[] = ["left", "right"];

const labelStyle: React.CSSProperties = {
  fontSize: "var(--font-size-sm)",
  color: "var(--color-text-secondary)",
  width: 80,
  flexShrink: 0,
};

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: T[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div
      role="group"
      style={{
        display: "inline-flex",
        border: "1px solid var(--color-border-subtle)",
        borderRadius: "var(--radius-sm)",
        overflow: "hidden",
      }}
    >
      {options.map((opt) => {
        const active = opt === value;
        return (
          <button
            key={opt}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt)}
            style={{
              padding: "var(--space-1) var(--space-3)",
              fontSize: "var(--font-size-sm)",
              textTransform: "capitalize",
              border: "none",
              cursor: "pointer",
              background: active ? "var(--color-accent-primary)" : "transparent",
              color: active ? "#fff" : "var(--color-text-secondary)",
            }}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Lets the user choose where toast notifications appear and preview one. The
 * placement is persisted by the toast store.
 */
export function NotificationSettings() {
  const placement = useToastStore((s) => s.placement);
  const setPlacement = useToastStore((s) => s.setPlacement);
  const success = useToastStore((s) => s.success);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
        <span style={labelStyle}>Vertical</span>
        <Segmented
          options={VERTICALS}
          value={placement.vertical}
          onChange={(vertical) => setPlacement({ vertical })}
        />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
        <span style={labelStyle}>Horizontal</span>
        <Segmented
          options={HORIZONTALS}
          value={placement.horizontal}
          onChange={(horizontal) => setPlacement({ horizontal })}
        />
      </div>
      <div>
        <Button
          type="button"
          onClick={() =>
            success("This is where your notifications will appear.", {
              title: "Test notification",
            })
          }
        >
          Send a test notification
        </Button>
      </div>
    </div>
  );
}
