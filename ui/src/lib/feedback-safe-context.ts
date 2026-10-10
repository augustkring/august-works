import {
  feedbackClientEnvironmentSchema,
  type CreateCustomerFeedback,
} from "@paperclipai/shared";

/** Read only supplied reported UA text. Never retain it, request client hints,
 * fingerprint the device or inspect DOM, URLs, history, storage or form data. */
export function feedbackClientEnvironment(reported: string) {
  const ua = reported.length <= 4096 ? reported : "";
  const version = (pattern: RegExp) => {
    const match = pattern.exec(ua);
    return match && Number(match[1]) > 0 ? Number(match[1]) : null;
  };
  const browserRules = [
    ["edge", /(?:Edg|EdgA|EdgiOS)\/(\d{1,3})(?=[.\s;)]|$)/],
    ["opera", /(?:OPR|OPiOS)\/(\d{1,3})(?=[.\s;)]|$)/],
    ["firefox", /(?:Firefox|FxiOS)\/(\d{1,3})(?=[.\s;)]|$)/],
    ["chrome", /(?:Chrome|CriOS)\/(\d{1,3})(?=[.\s;)]|$)/],
    ["chromium", /Chromium\/(\d{1,3})(?=[.\s;)]|$)/],
    ["safari", /Version\/(\d{1,3})(?=[.\s;)]|$)/],
  ] as const;
  const browserRule = browserRules.find(
    ([family, pattern]) =>
      version(pattern) !== null && (family !== "safari" || /Safari\//.test(ua)),
  );
  const osRules = [
    ["android", /Android\s+(\d{1,3})(?=[._\s;)]|$)/],
    ["ios", /(?:CPU (?:iPhone )?OS|iPhone OS)\s+(\d{1,3})(?=[._\s;)]|$)/],
    ["windows", /Windows NT\s+(\d{1,3})(?=[._\s;)]|$)/],
    ["macos", /Mac OS X\s+(\d{1,3})(?=[._\s;)]|$)/],
  ] as const;
  const osRule = osRules.find(([, pattern]) => version(pattern) !== null);
  return feedbackClientEnvironmentSchema.parse({
    source: "reported_user_agent",
    browser: {
      family: browserRule?.[0] ?? "unknown",
      majorVersion: browserRule ? version(browserRule[1]) : null,
    },
    operatingSystem: {
      family:
        osRule?.[0] ??
        (/CrOS\s/.test(ua)
          ? "chromeos"
          : /Linux/.test(ua)
            ? "linux"
            : "unknown"),
      majorVersion: osRule ? version(osRule[1]) : null,
    },
  });
}

/** Only static categories leave this function. Route parameters and query or
 * fragment values never enter feedback, and unknown screens stay unspecified. */
export function feedbackPageContext(
  pathname: string,
): Pick<CreateCustomerFeedback["context"], "surfaceKey" | "screenContractId"> {
  const segments = pathname.split(/[?#]/, 1)[0]!.split("/");
  if (segments.includes("support-access"))
    return { surfaceKey: "support", screenContractId: "SUPPORT-ACCESS" };
  if (segments.includes("settings") && segments.includes("support"))
    return { surfaceKey: "support" };
  if (segments.includes("dashboard"))
    return { surfaceKey: "home", screenContractId: "HOME" };
  if (segments.includes("needs-you"))
    return { surfaceKey: "needs_you", screenContractId: "NEEDS-YOU" };
  if (segments.includes("decisions")) return { surfaceKey: "needs_you" };
  if (segments.includes("my-feedback"))
    return { surfaceKey: "other", screenContractId: "MY-FEEDBACK" };
  if (segments.includes("agents"))
    return {
      surfaceKey: "agents",
      ...(segments.includes("monitor")
        ? { screenContractId: "AGENT-MONITOR" as const }
        : {}),
    };
  if (segments.includes("apps"))
    return { surfaceKey: "apps", screenContractId: "APPS" };
  if (segments.some((s) => ["welcome", "onboarding", "activation"].includes(s)))
    return { surfaceKey: "onboarding" };
  if (segments.includes("workflows"))
    return { surfaceKey: "workflow", screenContractId: "WORKFLOW" };
  if (segments.includes("orchestration")) return { surfaceKey: "workflow" };
  if (segments.includes("settings"))
    return {
      surfaceKey: "company",
      ...(segments.includes("general")
        ? { screenContractId: "SETTINGS-GENERAL" as const }
        : {}),
    };
  if (segments.includes("company"))
    return { surfaceKey: "company", screenContractId: "COMPANY" };
  if (segments.includes("work"))
    return { surfaceKey: "work", screenContractId: "WORK" };
  if (segments.includes("issues")) return { surfaceKey: "work" };
  return { surfaceKey: "other" };
}
