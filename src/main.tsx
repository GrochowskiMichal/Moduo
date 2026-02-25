import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import "@fontsource/nunito/400.css";
import "@fontsource/nunito/600.css";
import "@fontsource/nunito/700.css";
import { router } from "./router";
import { RootErrorBoundary } from "./components/app/root-error-boundary";
import "./global.css";

window.addEventListener("error", (event) => {
  console.error("Global error event:", event.error ?? event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled promise rejection:", event.reason);
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <RootErrorBoundary>
    <RouterProvider router={router} />
  </RootErrorBoundary>
);
