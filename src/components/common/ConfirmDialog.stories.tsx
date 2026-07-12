import type { Story } from "@ladle/react";
import { ConfirmDialog } from "./ConfirmDialog";

const noop = () => console.log("action");

export const Destructive: Story = () => (
  <ConfirmDialog
    title="Discard all changes?"
    message="This will permanently discard every uncommitted change in the working tree."
    confirmLabel="Discard"
    danger
    onConfirm={noop}
    onCancel={noop}
  />
);

export const NonDestructive: Story = () => (
  <ConfirmDialog
    title="Apply stash?"
    message="Apply the selected stash onto the current working tree."
    confirmLabel="Apply"
    danger={false}
    onConfirm={noop}
    onCancel={noop}
  />
);
