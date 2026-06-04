import { useEffect, useState } from "react";
import { useWorkspaceStore } from "../store/useWorkspaceStore";

/** Returns true once the backend status is resolved (available or unavailable)
 *  AND a minimum visual delay has passed so the skeleton never flickers. */
export function useWorkspaceReady(minDelayMs = 200): boolean {
  const backendStatus = useWorkspaceStore((s) => s.backendStatus);
  const [minDelayPassed, setMinDelayPassed] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setMinDelayPassed(true), minDelayMs);
    return () => window.clearTimeout(t);
  }, [minDelayMs]);

  return minDelayPassed && backendStatus !== "pending";
}
