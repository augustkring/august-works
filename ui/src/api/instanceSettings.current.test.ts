import { afterEach, expect, it, vi } from "vitest";
import { instanceSettingsApi } from "./instanceSettings";
afterEach(() => vi.restoreAllMocks());
it("current flags do not join a read started before the current account check", async () => {
  let finish!: (value: Response) => void;
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ scenario_planning_v8: false }), { status: 200, headers: { "Content-Type": "application/json" } }));
  const earlier = instanceSettingsApi.getExperimental();
  const current = await instanceSettingsApi.getCurrentExperimental();
  expect(fetch).toHaveBeenCalledTimes(2); expect(current.scenario_planning_v8).toBe(false);
  expect(fetch.mock.calls[1]![1]).toMatchObject({ cache: "no-store", method: "GET" });
  finish(new Response(JSON.stringify({ scenario_planning_v8: true }), { status: 200, headers: { "Content-Type": "application/json" } }));
  expect((await earlier).scenario_planning_v8).toBe(true);
});
