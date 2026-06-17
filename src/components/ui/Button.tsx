import { forwardRef } from "react";
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  loading?: boolean;
  children?: ReactNode;
}

const sizeStyles: Record<ButtonSize, CSSProperties> = {
  sm: { height: "var(--control-height-sm)", padding: "0 var(--space-2)", fontSize: "var(--font-size-xs)" },
  md: { height: "var(--control-height-md)", padding: "0 var(--space-3)", fontSize: "var(--font-size-sm)" },
};

function variantStyles(variant: ButtonVariant): CSSProperties {
  switch (variant) {
    case "primary":
      return {
        background: "var(--color-accent-primary)",
        color: "#fff",
        border: "1px solid var(--color-accent-secondary)",
        boxShadow: "var(--shadow-sm)",
      };
    case "danger":
      return {
        background: "transparent",
        color: "var(--color-danger)",
        border: "1px solid var(--color-danger)",
      };
    case "ghost":
      return { background: "transparent", color: "var(--color-text-secondary)", border: "1px solid transparent" };
    case "secondary":
    default:
      // A faint fill (not fully transparent) so secondary buttons read as real,
      // tappable controls rather than plain text with a hairline border.
      return {
        background: "var(--color-bg-elevated)",
        color: "var(--color-text-primary)",
        border: "1px solid var(--color-border-subtle)",
      };
  }
}

function hoverBackground(variant: ButtonVariant): string {
  if (variant === "primary") return "var(--color-accent-hover)";
  if (variant === "danger") return "var(--color-diff-del-bg)";
  return "var(--color-bg-hover)";
}

/**
 * The shared button primitive. Encodes the variant/size/disabled/hover/focus
 * styling so every button across the app reads the same. Forwards all native
 * button props (onClick, type, disabled, aria-label, title…).
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "md",
    fullWidth,
    loading,
    disabled,
    style,
    className,
    children,
    onMouseEnter,
    onMouseLeave,
    ...rest
  },
  ref,
) {
  const isDisabled = disabled || loading;
  const base = variantStyles(variant);

  return (
    <button
      ref={ref}
      {...rest}
      className={["ui-button", className].filter(Boolean).join(" ")}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      onMouseEnter={(e) => {
        if (!isDisabled) e.currentTarget.style.background = hoverBackground(variant);
        onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = base.background as string;
        onMouseLeave?.(e);
      }}
      style={{
        ...base,
        ...sizeStyles[size],
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-1)",
        width: fullWidth ? "100%" : undefined,
        borderRadius: "var(--radius-sm)",
        fontWeight: "var(--font-weight-medium)",
        fontFamily: "inherit",
        whiteSpace: "nowrap",
        cursor: isDisabled ? "default" : "pointer",
        opacity: isDisabled ? 0.6 : 1,
        transition:
          "background var(--duration-fast) var(--ease-default), border-color var(--duration-fast) var(--ease-default), box-shadow var(--duration-fast) var(--ease-default), transform var(--duration-fast) var(--ease-default)",
        ...style,
      }}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
});
