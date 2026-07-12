import type { Story } from "@ladle/react";
import { Input } from "./Input";

export const Default: Story = () => (
  <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", maxWidth: 320 }}>
    <Input placeholder="Placeholder text" />
    <Input defaultValue="With a value" />
    <Input placeholder="Disabled" disabled />
    <Input placeholder="Full width" fullWidth />
  </div>
);
