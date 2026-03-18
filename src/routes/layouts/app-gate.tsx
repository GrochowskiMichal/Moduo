import { Navigate } from "@tanstack/react-router";
import { useAuth } from "../../providers/auth-provider";
import { WorkspaceProvider } from "../../providers/workspace-provider";
import { AppChrome } from "../../components/app/app-chrome";
import { useSlotBookingsSync } from "../../features/plan/hooks/use-slot-bookings-sync";

export function AppGate() {
  const { isSignedIn, loading } = useAuth();
  useSlotBookingsSync();

  if (loading) return null;
  if (!isSignedIn) return <Navigate to="/auth" replace />;

  return (
    <WorkspaceProvider>
      <AppChrome profileInitial="M" />
    </WorkspaceProvider>
  );
}
