import { afterEach, describe, expect, it } from "@rstest/core";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  Outlet,
  RouterProvider,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";
import { createContext, type ReactNode, useContext, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

import {
  ACCOUNT_DELETED_NOTICE,
  finishAccountDeletion,
  validateAuthSearch,
} from "../../features/settings/delete-account";
import { useUnknownRouteRedirect } from "./use-unknown-route-redirect";

// Real timing matters here (a router load racing an auth state update), so no act().
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const NAV = ["/", "/tasks"];

type Auth = { signedIn: boolean; signOut: () => Promise<void> };
const AuthContext = createContext<Auth>({ signedIn: false, signOut: async () => {} });

/** The real router with the app's shape: /auth outside the app gate, the chrome
 *  (with the real guard) inside it, signed out → the gate's own redirect. */
function buildApp(initial: string) {
  const deleteAccount: { run?: () => Promise<void> } = {};

  function AuthProvider({ children }: { children: ReactNode }) {
    const [signedIn, setSignedIn] = useState(true);
    // Like auth-js: the signed-out state lands after a network round trip.
    const signOut = async () => {
      await sleep(5);
      setSignedIn(false);
      await sleep(1);
    };
    return <AuthContext.Provider value={{ signedIn, signOut }}>{children}</AuthContext.Provider>;
  }

  function Chrome() {
    useUnknownRouteRedirect(NAV);
    const navigate = useNavigate();
    const { signOut } = useContext(AuthContext);
    deleteAccount.run = () =>
      finishAccountDeletion({
        forgetOnDevice: () => {},
        goToSignInWithNotice: () => navigate({ to: "/auth", search: { deleted: 1 } }),
        signOut,
      });
    return <Outlet />;
  }

  function AppGate() {
    const { signedIn } = useContext(AuthContext);
    return signedIn ? <Chrome /> : <Navigate to="/auth" replace />;
  }

  function SignInPage() {
    const { deleted } = useSearch({ from: "/auth" });
    return <p>{deleted ? ACCOUNT_DELETED_NOTICE : "sign in"}</p>;
  }

  const rootRoute = createRootRoute({
    component: () => (
      <AuthProvider>
        <Outlet />
      </AuthProvider>
    ),
  });
  const authRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/auth",
    component: SignInPage,
    validateSearch: validateAuthSearch,
  });
  const gateRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: "gate",
    component: AppGate,
  });
  const homeRoute = createRoute({
    getParentRoute: () => gateRoute,
    path: "/",
    component: () => <p>home</p>,
  });
  const tasksRoute = createRoute({
    getParentRoute: () => gateRoute,
    path: "/tasks",
    component: () => <p>tasks</p>,
  });
  const unknownRoute = createRoute({
    getParentRoute: () => gateRoute,
    path: "/gone",
    component: () => <p>gone</p>,
  });

  const router = createRouter({
    routeTree: rootRoute.addChildren([
      authRoute,
      gateRoute.addChildren([homeRoute, tasksRoute, unknownRoute]),
    ]),
    history: createMemoryHistory({ initialEntries: [initial] }),
  });
  return { router, deleteAccount };
}

let mounted: { root: Root; el: HTMLElement } | null = null;

async function mount(router: ReturnType<typeof buildApp>["router"], text: string) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  root.render(<RouterProvider router={router} />);
  mounted = { root, el };
  for (let i = 0; i < 200 && !el.textContent?.includes(text); i++) await sleep(5);
  return el;
}

afterEach(() => {
  mounted?.root.unmount();
  mounted?.el.remove();
  mounted = null;
});

describe("useUnknownRouteRedirect, with the real router", () => {
  it("lets the Danger zone reach /auth?deleted=1 instead of bouncing it to the first tab", async () => {
    const { router, deleteAccount } = buildApp("/tasks");
    const el = await mount(router, "tasks");

    await deleteAccount.run?.();
    await sleep(100);

    expect(router.state.location.href).toBe("/auth?deleted=1");
    expect(el.textContent).toBe(ACCOUNT_DELETED_NOTICE);
  });

  it("still sends a route the nav doesn't know to the first tab", async () => {
    const { router } = buildApp("/gone");
    const el = await mount(router, "home");

    expect(router.state.location.pathname).toBe("/");
    expect(el.textContent).toBe("home");
  });
});
