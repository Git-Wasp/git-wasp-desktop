import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useGithubStore } from "../../stores/githubStore";
import { Button } from "../ui/Button";

export function DeviceFlowModal({
  host,
  onClose,
}: {
  host: string;
  onClose: () => void;
}) {
  const { deviceFlowInit, startDeviceFlow, pollDeviceFlow, cancelDeviceFlow } = useGithubStore();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!deviceFlowInit) {
      startDeviceFlow(host).catch((e) => setError(String(e)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host]);

  useEffect(() => {
    if (!deviceFlowInit) return;
    let cancelled = false;
    let delayMs = deviceFlowInit.interval * 1000;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      try {
        const result = await pollDeviceFlow(host);
        // Completion clears deviceFlowInit in the store, which re-runs this
        // effect and marks `cancelled` before we get back here — onClose
        // must fire regardless, or the success path would never complete.
        if (result.done) {
          onClose();
          return;
        }
        if (cancelled) return;
        // RFC 8628: a slow_down response means we must increase the polling
        // interval by at least 5 seconds, for this and all subsequent polls.
        if (result.slowDown) delayMs += 5_000;
        timer = setTimeout(tick, delayMs);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    };

    timer = setTimeout(tick, delayMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [deviceFlowInit, host, pollDeviceFlow, onClose]);

  const handleCancel = () => {
    cancelDeviceFlow();
    onClose();
  };

  const handleOpenBrowser = () => {
    if (deviceFlowInit) openUrl(deviceFlowInit.verificationUri);
  };

  return (
    <div
      role="dialog"
      aria-label="Connect GitHub account"
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.5)",
        zIndex: 100,
      }}
    >
      <div
        style={{
          width: 360,
          padding: "var(--space-5)",
          background: "var(--color-bg-panel)",
          border: "1px solid var(--color-border-subtle)",
          borderRadius: "var(--radius-md)",
          color: "var(--color-text-primary)",
        }}
      >
        <h2
          style={{
            margin: 0,
            marginBottom: "var(--space-3)",
            fontSize: "var(--font-size-base)",
            fontWeight: "var(--font-weight-semibold)",
          }}
        >
          Connect GitHub account
        </h2>

        {error && (
          <div style={{ color: "var(--color-danger)", fontSize: "var(--font-size-sm)", marginBottom: "var(--space-3)" }}>
            {error}
          </div>
        )}

        {deviceFlowInit ? (
          <>
            <p style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-secondary)" }}>
              Enter this code at <strong>{deviceFlowInit.verificationUri}</strong>:
            </p>
            <div
              style={{
                fontFamily: "var(--font-family-mono)",
                fontSize: "var(--font-size-lg)",
                fontWeight: "var(--font-weight-semibold)",
                letterSpacing: "0.15em",
                textAlign: "center",
                padding: "var(--space-3)",
                margin: "var(--space-3) 0",
                background: "var(--color-bg-elevated)",
                borderRadius: "var(--radius-sm)",
              }}
            >
              {deviceFlowInit.userCode}
            </div>
            <Button variant="primary" fullWidth onClick={handleOpenBrowser}>
              Open in browser
            </Button>
            <p
              style={{
                marginTop: "var(--space-3)",
                fontSize: "var(--font-size-xs)",
                color: "var(--color-text-muted)",
                textAlign: "center",
              }}
            >
              Waiting for authorization…
            </p>
          </>
        ) : (
          <p style={{ fontSize: "var(--font-size-sm)", color: "var(--color-text-muted)" }}>
            Starting device flow…
          </p>
        )}

        <Button variant="secondary" fullWidth onClick={handleCancel} style={{ marginTop: "var(--space-2)" }}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
