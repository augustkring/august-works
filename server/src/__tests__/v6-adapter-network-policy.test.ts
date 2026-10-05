import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const lookup = vi.hoisted(() => vi.fn());
vi.mock("node:dns/promises", () => ({ lookup }));
import { saasWebSocketOptions } from "../services/saas/adapter-network-policy.js";
import { assertSaasRemoteAdapterConfig } from "../services/saas/execution-admission.js";
describe("SaaS Gateway transport policy", () => {
  beforeEach(() => {
    lookup.mockReset();
    lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
  });
  afterEach(()=>vi.unstubAllEnvs());
  it("rejects remote-adapter control-plane file reads and machine runtimes without changing local configuration",()=>{
    vi.stubEnv("AW_DEPLOYMENT_PROFILE","saas");
    expect(()=>assertSaasRemoteAdapterConfig("cursor_cloud",{instructionsFilePath:"/etc/august-works/platform.env"})).toThrow("control-plane file path");
    expect(()=>assertSaasRemoteAdapterConfig("cursor_cloud",{runtimeEnvType:"machine"})).toThrow("cloud runtime");
    expect(()=>assertSaasRemoteAdapterConfig("process",{})).toThrow("remote provider");
    expect(()=>assertSaasRemoteAdapterConfig("cursor_cloud",{runtimeEnvType:"cloud",repoUrl:"https://github.com/example/project"})).not.toThrow();
    vi.stubEnv("AW_DEPLOYMENT_PROFILE","local");
    expect(()=>assertSaasRemoteAdapterConfig("cursor_cloud",{instructionsFilePath:"/fixture/local.md",runtimeEnvType:"machine"})).not.toThrow();
  });
  it("pins an approved public address and never resolves it again at connection time", async () => {
    const options = await saasWebSocketOptions(
      "wss://gateway.example.test/connect",
    );
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(options.followRedirects).toBe(false);
    const result = await new Promise((args) =>
      Reflect.apply(options.lookup!, undefined, [
        "gateway.example.test",
        { all: true },
        (...values: unknown[]) => args(values),
      ]),
    );
    expect(result).toEqual([null, [{ address: "8.8.8.8", family: 4 }]]);
    expect(lookup).toHaveBeenCalledTimes(1);
  });
  it("rejects private, metadata, cleartext and credential-bearing customer endpoints", async () => {
    for (const url of [
      "ws://gateway.example.test",
      "wss://127.0.0.1:3100",
      "wss://169.254.169.254",
      "wss://user:secret@gateway.example.test",
      "wss://gateway.example.test/?token=secret",
    ])
      await expect(saasWebSocketOptions(url)).rejects.toMatchObject({
        status: 403,
      });
    lookup.mockResolvedValue([{ address: "10.0.0.1", family: 4 }]);
    await expect(
      saasWebSocketOptions("wss://rebind.example.test"),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("permits only the exact authenticated managed relay path on the configured port", async () => {
    const path = "/cells/66666666-6666-4666-8666-666666666666/1";
    expect(
      await saasWebSocketOptions("ws://127.0.0.1:3102" + path),
    ).toMatchObject({ followRedirects: false });
    expect(lookup).not.toHaveBeenCalled();
    await expect(
      saasWebSocketOptions("ws://127.0.0.1:3100" + path),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      saasWebSocketOptions("ws://127.0.0.1:3102/admin"),
    ).rejects.toMatchObject({ status: 403 });
  });
});
