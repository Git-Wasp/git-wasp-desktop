import type { Story } from "@ladle/react";
import { ContextMenu, type MenuItem } from "./ContextMenu";

const items: MenuItem[] = [
  { label: "Checkout", onSelect: () => console.log("checkout") },
  { label: "Rename", onSelect: () => console.log("rename") },
  { separator: true },
  { label: "Delete branch", onSelect: () => console.log("delete"), danger: true },
];

export const Default: Story = () => (
  <div style={{ position: "relative", height: 220 }}>
    <ContextMenu x={40} y={20} items={items} onClose={() => console.log("close")} />
  </div>
);
