import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { LandingPage } from "./pages/LandingPage";
import { WorkspacePage } from "./pages/WorkspacePage";
import { InvitePage } from "./pages/InvitePage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { ToastContainer } from "./components/ui/Toast";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/workspace" element={<WorkspacePage />} />
        <Route path="/session/:id" element={<WorkspacePage />} />
        <Route path="/invite/:inviteId" element={<InvitePage />} />
        <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ToastContainer />
    </BrowserRouter>
  );
}

export default App;
