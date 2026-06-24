import { ThemeManager } from "./ThemeManager";
import { NotificationSettings } from "./NotificationSettings";
import { GithubSettings } from "./GithubSettings";
import { FontSettings } from "./FontSettings";
import { GraphColorSettings } from "./GraphColorSettings";

const sectionTitleStyle: React.CSSProperties = {
  fontSize: "var(--font-size-md)",
  fontWeight: "var(--font-weight-semibold)",
  color: "var(--color-text-primary)",
  marginBottom: "var(--space-3)",
};

export function SettingsView() {
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "var(--space-5)" }}>
      <h1
        style={{
          margin: 0,
          marginBottom: "var(--space-5)",
          fontSize: "var(--font-size-xl)",
          fontWeight: "var(--font-weight-semibold)",
          color: "var(--color-text-primary)",
        }}
      >
        Settings
      </h1>

      <section style={{ maxWidth: 640, marginBottom: "var(--space-6)" }}>
        <h2 style={sectionTitleStyle}>GitHub</h2>
        <GithubSettings />
      </section>

      <section style={{ maxWidth: 640, marginBottom: "var(--space-6)" }}>
        <h2 style={sectionTitleStyle}>Themes</h2>
        <ThemeManager />
      </section>

      <section style={{ maxWidth: 640, marginBottom: "var(--space-6)" }}>
        <h2 style={sectionTitleStyle}>Fonts</h2>
        <FontSettings />
      </section>

      <section style={{ maxWidth: 640, marginBottom: "var(--space-6)" }}>
        <h2 style={sectionTitleStyle}>Graph colours</h2>
        <GraphColorSettings />
      </section>

      <section style={{ maxWidth: 640 }}>
        <h2 style={sectionTitleStyle}>Notifications</h2>
        <NotificationSettings />
      </section>
    </div>
  );
}
