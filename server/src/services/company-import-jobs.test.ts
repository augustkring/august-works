import { afterEach, describe, expect, it, vi } from "vitest";
import { COMPANY_IMPORT_RECOVERY_INTERVAL_MS, scheduleCompanyImportRecovery } from "./company-import-jobs.js";

describe("company import lease recovery scheduler", () => {
  afterEach(() => vi.useRealTimers());

  it("runs the existing expired-lease owner at startup and interval, skips overlap, and stops cleanly", async () => {
    vi.useFakeTimers();
    let releaseFirst!: () => void;
    const firstRun = new Promise<void>(resolve => { releaseFirst = resolve; });
    const recoverExpiredImports = vi.fn<() => Promise<unknown>>()
      .mockImplementationOnce(() => firstRun)
      .mockResolvedValue([]);
    const onError = vi.fn();
    const stop = scheduleCompanyImportRecovery(recoverExpiredImports, onError);

    await Promise.resolve();
    expect(recoverExpiredImports).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(COMPANY_IMPORT_RECOVERY_INTERVAL_MS);
    expect(recoverExpiredImports).toHaveBeenCalledTimes(1);

    releaseFirst();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(COMPANY_IMPORT_RECOVERY_INTERVAL_MS);
    expect(recoverExpiredImports).toHaveBeenCalledTimes(2);

    await stop();
    await vi.advanceTimersByTimeAsync(COMPANY_IMPORT_RECOVERY_INTERVAL_MS);
    expect(recoverExpiredImports).toHaveBeenCalledTimes(2);
    expect(onError).not.toHaveBeenCalled();
  });
});
