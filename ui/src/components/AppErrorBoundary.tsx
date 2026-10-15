import { Component, type ErrorInfo, type ReactNode } from "react";
import { captureBrowserException } from "@/lib/sentry";
import { ErrorRecoverySurface } from "./ErrorRecoverySurface";

type AppErrorBoundaryState = {
  failed: boolean;
};

/**
 * Last-resort boundary above the router and every provider that renders app
 * chrome. `RouteErrorBoundary` only guards the routed `<Outlet />`; a crash in
 * the shell around it (sidebar, providers, layout hooks) has no boundary, so
 * React unmounts the entire root and the user is left staring at a blank
 * page with no way forward but knowing to hard-refresh. This boundary trades
 * that blank page for a reload prompt.
 *
 * Deliberately dependency-free: no router, no toast, no query client — the
 * crash being handled may have originated inside any of those providers.
 */
export class AppErrorBoundary extends Component<{ children: ReactNode }, AppErrorBoundaryState> {
  override state: AppErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("App shell crashed");
    captureBrowserException(error, { boundary: "app", componentStack: info.componentStack });
  }

  override render() {
    if (!this.state.failed) return this.props.children;

    return (
      <ErrorRecoverySurface scope="app" />
    );
  }
}
