import { Component, type ErrorInfo, type ReactNode } from "react";
import { useLocation, useNavigate } from "@/lib/router";
import { ErrorRecoverySurface } from "./ErrorRecoverySurface";
import { captureBrowserException } from "@/lib/sentry";

type RouteErrorBoundaryInnerProps = {
  resetKey: string;
  onReset: () => void;
  children: ReactNode;
};

type RouteErrorBoundaryState = {
  failed: boolean;
};

class RouteErrorBoundaryInner extends Component<RouteErrorBoundaryInnerProps, RouteErrorBoundaryState> {
  override state: RouteErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): RouteErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("Page render failed");
    captureBrowserException(error, { boundary: "route", componentStack: info.componentStack });
  }

  override componentDidUpdate(prevProps: RouteErrorBoundaryInnerProps): void {
    // A render throw with no boundary unmounts the whole app, so navigating
    // away (back button included) can't recover without a hard refresh. We sit
    // above the routed <Outlet />, so reset whenever the route changes.
    if (this.state.failed && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  override render() {
    if (!this.state.failed) return this.props.children;

    return (
      <ErrorRecoverySurface scope="page" onBack={this.props.onReset} />
    );
  }
}

export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const resetKey = `${location.pathname}${location.search}`;

  return (
    <RouteErrorBoundaryInner resetKey={resetKey} onReset={() => navigate(-1)}>
      {children}
    </RouteErrorBoundaryInner>
  );
}
