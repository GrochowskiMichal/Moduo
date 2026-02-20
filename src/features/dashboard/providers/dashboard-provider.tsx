import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../../providers/auth-provider";
import { useWorkspace } from "../../../providers/workspace-provider";
import { useDashboard, UseDashboardState } from "../hooks/use-dashboard";

const DashboardContext = createContext<UseDashboardState | null>(null);

export function DashboardProvider({ children }: { children: React.ReactNode }) {
  const { supabase, userId } = useAuth();
  const { selectedWorkspaceId } = useWorkspace();

  const dashboard = useDashboard({
    supabase,
    userId,
    workspaceId: selectedWorkspaceId,
  });

  return (
    <DashboardContext.Provider value={dashboard}>
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboardContext() {
  const context = useContext(DashboardContext);
  if (!context) {
    throw new Error("useDashboardContext must be used within a DashboardProvider");
  }
  return context;
}
