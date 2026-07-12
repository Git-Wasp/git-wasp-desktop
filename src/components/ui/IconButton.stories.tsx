import type { Story } from "@ladle/react";
import { IconButton } from "./IconButton";
import { CloseIcon, RefreshIcon, SettingsIcon } from "./icons";

export const Variants: Story = () => (
  <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center" }}>
    <IconButton aria-label="Close">
      <CloseIcon />
    </IconButton>
    <IconButton aria-label="Refresh">
      <RefreshIcon />
    </IconButton>
    <IconButton aria-label="Settings" size="md">
      <SettingsIcon />
    </IconButton>
    <IconButton aria-label="Disabled" disabled>
      <CloseIcon />
    </IconButton>
  </div>
);
