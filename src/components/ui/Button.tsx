import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";

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
      return { background: "var(--color-accent-primary)", color: "#fff", border: "1px solid transparent" };
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
      return {
        background: "transparent",
        color: "var(--color-text-secondary)",
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
export function Button({
  variant = "secondary",
  size = "md",
  fullWidth,
  loading,
  disabled,
  style,
  children,
  onMouseEnter,
  onMouseLeave,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const base = variantStyles(variant);

  return (
    <button
      {...rest}
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
        transition: "background var(--duration-fast) var(--ease-default), border-color var(--duration-fast) var(--ease-default)",
        ...style,
      }}
    >
      {loading ? "…" : children}
    </button>
  );
}
