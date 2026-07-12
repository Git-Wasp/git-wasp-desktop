import type { Story } from "@ladle/react";
import { Tooltip } from "./Tooltip";
import { Button } from "./Button";

export const HoverToReveal: Story = () => (
  <p style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-secondary)" }}>
    Hover the button to reveal its tooltip:{" "}
    <Tooltip label="Fetches from all remotes">
      <Button variant="secondary">Fetch</Button>
    </Tooltip>
  </p>
);
