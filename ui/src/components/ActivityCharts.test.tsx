// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import type { HeartbeatRun } from "@paperclipai/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunActivityChart, SuccessRateChart, PriorityChart, IssueStatusChart } from "./ActivityCharts";

import { i18n } from "../i18n";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-04-20T12:00:00.000Z"));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  flushSync(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

function render(ui: ReactNode) {
  flushSync(() => {
    root.render(ui);
  });
}

function createRun(overrides: Partial<HeartbeatRun> = {}): HeartbeatRun {
  return {
    id: "run-1",
    companyId: "company-1",
    agentId: "agent-1",
    responsibleUserId: null,
    invocationSource: "on_demand",
    triggerDetail: "manual",
    status: "succeeded",
    startedAt: new Date("2026-04-20T11:58:00.000Z"),
    finishedAt: new Date("2026-04-20T11:59:00.000Z"),
    error: null,
    wakeupRequestId: null,
    exitCode: 0,
    signal: null,
    usageJson: null,
    resultJson: null,
    sessionIdBefore: null,
    sessionIdAfter: null,
    logStore: null,
    logRef: null,
    logBytes: null,
    logSha256: null,
    logCompressed: false,
    lastOutputAt: null,
    lastOutputSeq: 0,
    lastOutputStream: null,
    lastOutputBytes: null,
    stdoutExcerpt: null,
    stderrExcerpt: null,
    errorCode: null,
    externalRunId: null,
    processPid: null,
    processGroupId: null,
    processStartedAt: null,
    retryOfRunId: null,
    processLossRetryCount: 0,
    scheduledRetryAt: null,
    scheduledRetryAttempt: 0,
    scheduledRetryReason: null,
    livenessState: null,
    livenessReason: null,
    continuationAttempt: 0,
    lastUsefulActionAt: null,
    nextAction: null,
    contextSnapshot: null,
    createdAt: new Date("2026-04-20T11:58:00.000Z"),
    updatedAt: new Date("2026-04-20T11:59:00.000Z"),
    ...overrides,
  };
}

describe("ActivityCharts", () => {
  it("renders empty run charts when dashboard aggregate data is temporarily missing", () => {
    render(<RunActivityChart activity={undefined} />);
    expect(container.textContent).toContain("No runs yet");

    render(<SuccessRateChart activity={undefined} />);
    expect(container.textContent).toContain("No runs yet");
  });

  it("still aggregates raw agent runs for detail charts", () => {
    render(
      <RunActivityChart
        runs={[
          createRun({ id: "run-success", status: "succeeded" }),
          createRun({ id: "run-failed", status: "failed", errorCode: "provider_quota" }),
        ]}
      />,
    );

    expect(container.textContent).not.toContain("No runs yet");
    // Tooltip now carries the per-day breakdown (incl. failure error codes).
    const dayCell = container.querySelector("[title^='2026-04-20: 2 runs']");
    expect(dayCell).not.toBeNull();
    expect(dayCell?.getAttribute("title")).toContain("provider_quota: 1");
  });

  it("renders a distinct recovered segment and legend for recovered restart kills", () => {
    render(
      <RunActivityChart
        activity={[
          {
            date: "2026-04-20",
            succeeded: 3,
            failed: 1,
            recovered: 4,
            other: 0,
            total: 8,
            failedByErrorCode: { process_lost: 1 },
          },
        ]}
      />,
    );

    expect(container.textContent).toContain("Recovered");
    const dayCell = container.querySelector("[title*='recovered: 4']");
    expect(dayCell).not.toBeNull();
  });
});


describe("Activity chart data alternatives", () => {
  const day = { date: "2026-04-20", succeeded: 3, failed: 1, recovered: 4, other: 0, total: 8,
    failedByErrorCode: { process_lost: 1 } };
  it("exposes all four series as named native tables with row and column headers", () => {
    render(<><RunActivityChart activity={[day]} /><SuccessRateChart activity={[day]} />
      <PriorityChart issues={[{ priority: "high", createdAt: new Date("2026-04-20T12:00:00Z") }]} />
      <IssueStatusChart issues={[{ status: "blocked", createdAt: new Date("2026-04-20T12:00:00Z") }]} /></>);
    const tables = Array.from(container.querySelectorAll("table"));
    expect(tables.map(table => table.querySelector("caption")?.textContent)).toEqual([
      "Run activity", "Run success rate", "Task priority", "Task status",
    ]);
    for (const table of tables) {
      expect(table.closest("details")?.querySelector("summary")?.textContent).toContain("as data");
      expect(table.querySelector('thead th[scope="col"]')?.textContent).toBe("Date");
      expect(table.querySelector('tbody th[scope="row"] time[datetime="2026-04-20"]')).not.toBeNull();
      const region = table.parentElement!;
      expect(region.getAttribute("tabindex")).toBe("0");
      expect(region.getAttribute("aria-labelledby")).toBe(table.querySelector("caption")!.id);
    }
    expect(Array.from(tables[0]!.querySelectorAll("tbody td")).map(cell => cell.textContent)).toEqual([
      "8", "3", "4", "1", "0", "process_lost: 1",
    ]);
    expect(Array.from(tables[1]!.querySelectorAll("tbody td")).map(cell => cell.textContent)).toEqual(["8", "7", "88%"]);
  });
  it("distinguishes an actual zero success rate from days without runs", () => {
    render(<SuccessRateChart activity={[
      { ...day, date: "2026-04-19", succeeded: 0, recovered: 0, failed: 0, total: 0, failedByErrorCode: {} },
      { ...day, succeeded: 0, recovered: 0, failed: 1, total: 1 },
    ]} />);
    expect(Array.from(container.querySelectorAll("tbody tr")).map(row => row.lastElementChild?.textContent)).toEqual(["No runs", "0%"]);
  });
  it("retains an unknown source status as escaped text and a counted series", () => {
    render(<IssueStatusChart issues={[{ status: "<script>source status</script>", createdAt: new Date("2026-04-20T12:00:00Z") }]} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("thead")?.textContent).toContain("<script>source status</script>");
    const row = Array.from(container.querySelectorAll("tbody tr")).find(item => item.textContent?.includes("2026-04-20"))!;
    expect(row.querySelector("td")?.textContent).toBe("1");
  });
  it("updates the accessible labels in Danish without changing the supplied values", async () => {
    render(<RunActivityChart activity={[day]} />);
    await act(async () => { await i18n.changeLanguage("da"); });
    expect(container.querySelector("caption")?.textContent).toBe("Kørselsaktivitet");
    expect(container.querySelector("summary")?.textContent).toContain("Vis Kørselsaktivitet som data");
    expect(Array.from(container.querySelectorAll("tbody td")).map(cell => cell.textContent)).toEqual([
      "8", "3", "4", "1", "0", "process_lost: 1",
    ]);
  });
  it("keeps unavailable or empty data explicit instead of inventing a table", () => {
    render(<RunActivityChart activity={undefined} />);
    expect(container.querySelector("table")).toBeNull();
    expect(container.textContent).toContain("No runs yet");
  });
});
