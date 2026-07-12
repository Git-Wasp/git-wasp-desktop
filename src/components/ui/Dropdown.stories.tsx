import type { Story } from "@ladle/react";
import { Dropdown, DropdownItem, DropdownLabel, DropdownDivider } from "./Dropdown";

export const WithSections: Story = () => (
  <Dropdown ariaLabel="Choose an action" trigger={<span>Actions</span>}>
    {(close) => (
      <>
        <DropdownLabel>Branch</DropdownLabel>
        <DropdownItem onSelect={close}>Checkout</DropdownItem>
        <DropdownItem onSelect={close}>Rename</DropdownItem>
        <DropdownDivider />
        <DropdownLabel>Danger zone</DropdownLabel>
        <DropdownItem onSelect={close}>Delete</DropdownItem>
      </>
    )}
  </Dropdown>
);
