import { useEffect, useState } from "react";

export function useWorkspaceReady(delayMs = 320): boolean {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const timerId = window.setTimeout(() => setIsReady(true), delayMs);
    return () => window.clearTimeout(timerId);
  }, [delayMs]);

  return isReady;
}
