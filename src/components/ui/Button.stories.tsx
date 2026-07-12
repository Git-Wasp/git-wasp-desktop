import type { Story } from "@ladle/react";
import { Button } from "./Button";

export const Variants: Story = () => (
  <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center" }}>
    <Button variant="primary">Primary</Button>
    <Button variant="secondary">Secondary</Button>
    <Button variant="tertiary">Tertiary</Button>
    <Button variant="danger">Danger</Button>
  </div>
);

export const States: Story = () => (
  <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center" }}>
    <Button variant="primary">Default</Button>
    <Button variant="primary" disabled>
      Disabled
    </Button>
    <Button variant="primary" loading>
      Loading
    </Button>
    <Button variant="primary" size="md">
      Medium
    </Button>
  </div>
);

interface PlaygroundArgs {
  variant: "primary" | "secondary" | "tertiary" | "danger";
  label: string;
  disabled: boolean;
  loading: boolean;
  fullWidth: boolean;
}

export const Playground: Story<PlaygroundArgs> = ({
  variant,
  label,
  disabled,
  loading,
  fullWidth,
}) => (
  <Button variant={variant} disabled={disabled} loading={loading} fullWidth={fullWidth}>
    {label}
  </Button>
);

Playground.args = {
  label: "Save changes",
  disabled: false,
  loading: false,
  fullWidth: false,
};

Playground.argTypes = {
  variant: {
    options: ["primary", "secondary", "tertiary", "danger"],
    control: { type: "select" },
    defaultValue: "primary",
  },
};
