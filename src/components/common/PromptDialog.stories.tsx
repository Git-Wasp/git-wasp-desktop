import type { Story } from "@ladle/react";
import { PromptDialog } from "./PromptDialog";

const log = (value: string) => console.log("confirm:", value);
const cancel = () => console.log("cancel");

export const NewBranch: Story = () => (
  <PromptDialog
    title="New branch"
    label="Branch name"
    confirmLabel="Create"
    onConfirm={log}
    onCancel={cancel}
  />
);

export const Prefilled: Story = () => (
  <PromptDialog
    title="Rename branch"
    label="Branch name"
    initialValue="feat/old-name"
    confirmLabel="Rename"
    onConfirm={log}
    onCancel={cancel}
  />
);
