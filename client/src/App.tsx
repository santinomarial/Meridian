import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { LandingPage } from "./pages/LandingPage";
import { ToastContainer } from "./components/ui/Toast";

const WorkspacePage = lazy(() =>
  import("./pages/WorkspacePage").then((module) => ({
    default: module.WorkspacePage,
  })),
);
const InvitePage = lazy(() =>
  import("./pages/InvitePage").then((module) => ({ default: module.InvitePage })),
);
const ResetPasswordPage = lazy(() =>
  import("./pages/ResetPasswordPage").then((module) => ({
    default: module.ResetPasswordPage,
  })),
);

function PageFallback() {
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-background text-sm text-on-background"
      role="status"
      aria-live="polite"
    >
      <span className="animate-pulse">Loading Meridian…</span>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/forgot-password" element={<LandingPage />} />
          <Route path="/workspace" element={<WorkspacePage />} />
          <Route path="/workspace/:workspaceId" element={<WorkspacePage />} />
          <Route path="/session/:id" element={<WorkspacePage />} />
          <Route path="/invite/:inviteId" element={<InvitePage />} />
          <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      <ToastContainer />
    </BrowserRouter>
  );
}

export default App;
