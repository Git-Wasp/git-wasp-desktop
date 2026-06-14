import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import type { ButtonSize } from "./Button";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required — icon buttons have no text label. */
  "aria-label": string;
  size?: ButtonSize;
  children: ReactNode;
}

const dim: Record<ButtonSize, CSSProperties> = {
  sm: { width: "var(--control-height-sm)", height: "var(--control-height-sm)", fontSize: "var(--font-size-sm)" },
  md: { width: "var(--control-height-md)", height: "var(--control-height-md)", fontSize: "var(--font-size-md)" },
};

/** A square, icon/glyph-only button (menu triggers, close `✕`, etc.). */
export function IconButton({ size = "sm", disabled, style, children, onMouseEnter, onMouseLeave, ...rest }: IconButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = "var(--color-bg-hover)";
        onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        onMouseLeave?.(e);
      }}
      style={{
        ...dim[size],
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
        background: "transparent",
        border: "none",
        borderRadius: "var(--radius-sm)",
        color: "var(--color-text-secondary)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.6 : 1,
        transition: "background var(--duration-fast) var(--ease-default)",
        ...style,
      }}
    >
      {children}
    </button>
  );
}
