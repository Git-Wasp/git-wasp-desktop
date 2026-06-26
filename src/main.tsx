import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/globals.css";
import { applyCachedTheme } from "./lib/applyTheme";
import { applyFontPrefs, loadFontPrefs } from "./lib/fonts";
import { applyGraphPalette, loadGraphPaletteId } from "./lib/graphPalettes";

// Apply visual preferences synchronously, before the first paint, so the app
// opens in the user's theme/fonts/palette rather than flashing the defaults and
// switching once the async startup load completes. The backend remains the
// source of truth and re-applies the authoritative theme on init.
applyCachedTheme();
applyFontPrefs(loadFontPrefs());
applyGraphPalette(loadGraphPaletteId());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
