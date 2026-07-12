import { useLayoutEffect } from "react";
import type { GlobalProvider } from "@ladle/react";
// The real app token layer: tokens.css + tailwind + @theme mappings. Importing
// this one file styles every story exactly like the app.
import "../src/styles/globals.css";
import { applyTheme } from "../src/lib/applyTheme";

/**
 * Wraps every story. Maps Ladle's built-in light/dark toggle onto the app's real
 * theme system (applyTheme sets/removes [data-theme] on <html>), and paints an
 * app-like background so components are legible in both themes.
 */
export const Provider: GlobalProvider = ({ children, globalState }) => {
  const light = globalState.theme === "light";
  useLayoutEffect(() => {
    // Reuse the canonical mechanism — "dark" clears the attribute (:root default),
    // "light" sets [data-theme="light"]. "auto" maps to dark for predictability.
    applyTheme(
      light
        ? { id: "light", appearance: "light", builtin: true }
        : { id: "dark", appearance: "dark", builtin: true },
    );
  }, [light]);

  return (
    <div
      style={{
        background: "var(--color-bg-app)",
        color: "var(--color-text-primary)",
        fontFamily: "var(--font-family-sans)",
        minHeight: "100vh",
        padding: "var(--space-6)",
      }}
    >
      {children}
    </div>
  );
};
