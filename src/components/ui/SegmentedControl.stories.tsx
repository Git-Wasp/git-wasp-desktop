import { useState } from "react";
import type { Story } from "@ladle/react";
import { SegmentedControl } from "./SegmentedControl";

export const TwoOptions: Story = () => {
  const [value, setValue] = useState<"write" | "preview">("write");
  return (
    <SegmentedControl
      ariaLabel="Editor mode"
      value={value}
      onChange={setValue}
      options={[
        { value: "write", label: "Write" },
        { value: "preview", label: "Preview" },
      ]}
    />
  );
};
