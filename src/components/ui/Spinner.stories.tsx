import type { Story } from "@ladle/react";
import { Spinner } from "./Spinner";

export const Sizes: Story = () => (
  <div style={{ display: "flex", gap: "var(--space-4)", alignItems: "center" }}>
    <Spinner />
    <Spinner size={24} />
    <Spinner size="2em" />
    <span style={{ color: "var(--color-accent-primary)" }}>
      <Spinner size={20} />
    </span>
  </div>
);
