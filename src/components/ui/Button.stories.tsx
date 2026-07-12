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
