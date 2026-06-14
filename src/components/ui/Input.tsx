import type { InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  fullWidth?: boolean;
}

/** The shared text input primitive (token-styled, focus-ring via :focus-visible). */
export function Input({ fullWidth, style, ...rest }: InputProps) {
  return (
    <input
      {...rest}
      style={{
        height: "var(--control-height-md)",
        width: fullWidth ? "100%" : undefined,
        boxSizing: "border-box",
        padding: "0 var(--space-2)",
        fontSize: "var(--font-size-sm)",
        fontFamily: "inherit",
        background: "var(--color-bg-input)",
        border: "1px solid var(--color-border-subtle)",
        borderRadius: "var(--radius-sm)",
        color: "var(--color-text-primary)",
        outline: "none",
        ...style,
      }}
    />
  );
}
