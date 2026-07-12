import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

// Ladle merges this with its internal Vite config. We only need the Tailwind 4
// plugin so the app's globals.css (@import "tailwindcss") compiles; Ladle
// supplies the React plugin itself.
export default defineConfig({
  plugins: [tailwindcss()],
});
