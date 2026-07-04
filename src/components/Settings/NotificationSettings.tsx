import {
  useToastStore,
  type ToastHorizontal,
  type ToastVertical,
} from "../../stores/toastStore";
import { Button } from "../ui/Button";
import { SegmentedControl, type SegmentOption } from "../ui/SegmentedControl";

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const toOptions = <T extends string>(values: T[]): SegmentOption<T>[] =>
  values.map((value) => ({ value, label: capitalize(value) }));

const VERTICALS = toOptions<ToastVertical>(["top", "middle", "bottom"]);
const HORIZONTALS = toOptions<ToastHorizontal>(["left", "right"]);

const labelStyle: React.CSSProperties = {
  fontSize: "var(--font-size-sm)",
  color: "var(--color-text-secondary)",
  width: 80,
  flexShrink: 0,
};

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
        <SegmentedControl
          ariaLabel="Vertical placement"
          options={VERTICALS}
          value={placement.vertical}
          onChange={(vertical) => setPlacement({ vertical })}
        />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
        <span style={labelStyle}>Horizontal</span>
        <SegmentedControl
          ariaLabel="Horizontal placement"
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
