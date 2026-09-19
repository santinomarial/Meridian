import { useCallback, useRef } from "react";
import { useNavigate } from "react-router";
import { ApiError, logout } from "../lib/api";
import { useWorkspaceStore } from "../store/useWorkspaceStore";
import { toast } from "../components/ui/Toast";

/** Only report sign-out once the server has revoked or rejected the session. */
export function useSignOut() {
  const navigate = useNavigate();
  const pending = useRef(false);

  return useCallback(async (): Promise<void> => {
    if (pending.current) return;
    pending.current = true;
    try {
      try {
        await logout();
      } catch (error) {
        // A missing/expired session is already signed out. Other failures leave
        // the HttpOnly cookie potentially valid; JavaScript cannot clear it.
        if (!(error instanceof ApiError && error.status === 401)) {
          toast("Could not sign out. Check your connection and try again.", "error");
          return;
        }
      }
      useWorkspaceStore.getState().resetWorkspace();
      navigate("/", { replace: true });
      toast("Signed out.");
    } finally {
      pending.current = false;
    }
  }, [navigate]);
}
