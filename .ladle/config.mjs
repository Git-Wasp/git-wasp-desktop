/** @type {import('@ladle/react').UserConfig} */
export default {
  stories: "src/**/*.stories.{ts,tsx}",
  addons: {
    // Dark is the app's default theme (:root); Ladle's toggle flips to light.
    theme: { enabled: true, defaultState: "dark" },
    // Live prop editing for "refining" component states.
    control: { enabled: true },
    // Responsive width presets.
    width: { enabled: true },
    // Accessibility checks while refining.
    a11y: { enabled: true },
    // "Show code" for each story.
    source: { enabled: true },
  },
};
