import { MaterialIcon } from "../ui/MaterialIcon";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";

/**
 * Persistent strip while the collaboration socket is down or reconnecting.
 * Only shown after the workspace API load succeeded.
 */
export function ConnectionStatusBanner() {
  const backendStatus = useWorkspaceStore((s) => s.backendStatus);
  const connectionStatus = useWorkspaceStore((s) => s.connectionStatus);

  if (backendStatus !== "available" || connectionStatus === "connected") {
    return null;
  }

  const isConnecting = connectionStatus === "connecting";

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="connection-status-banner"
      data-connection-status={connectionStatus}
      className={[
        "flex items-center justify-center gap-2 px-4 py-1.5 text-[12px] font-medium",
        isConnecting
          ? "bg-tertiary/15 text-tertiary"
          : "bg-error/15 text-error",
      ].join(" ")}
    >
      <MaterialIcon
        name={isConnecting ? "sync" : "wifi_off"}
        className={["text-[14px]", isConnecting ? "animate-spin" : ""].join(" ")}
        aria-hidden
      />
      <span>
        {isConnecting
          ? "Connecting to collaboration server…"
          : "Connection lost — reconnecting…"}
      </span>
    </div>
  );
}
