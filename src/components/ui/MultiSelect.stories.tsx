import { useState } from "react";
import type { Story } from "@ladle/react";
import { MultiSelect } from "./MultiSelect";

const OPTIONS = [
  { value: "bug" },
  { value: "enhancement" },
  { value: "documentation" },
  { value: "good first issue" },
];

export const Default: Story = () => {
  const [selected, setSelected] = useState<string[]>(["bug"]);
  return (
    <div style={{ maxWidth: 320 }}>
      <MultiSelect
        ariaLabel="Labels"
        options={OPTIONS}
        selected={selected}
        onChange={setSelected}
      />
    </div>
  );
};
