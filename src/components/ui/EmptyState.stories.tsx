import type { Story } from "@ladle/react";
import { EmptyState } from "./EmptyState";
import { Button } from "./Button";

export const MessageOnly: Story = () => <EmptyState message="No changes" />;

export const WithAction: Story = () => (
  <EmptyState
    message="No repositories open"
    action={<Button variant="primary">Open a repository</Button>}
  />
);
