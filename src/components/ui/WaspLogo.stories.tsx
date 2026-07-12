import type { Story } from "@ladle/react";
import { WaspLogo } from "./WaspLogo";

export const Sizes: Story = () => (
  <div style={{ display: "flex", gap: "var(--space-5)", alignItems: "center" }}>
    <WaspLogo size={48} />
    <WaspLogo size={96} />
  </div>
);
