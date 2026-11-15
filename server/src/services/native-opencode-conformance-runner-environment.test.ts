import { describe, expect, it } from "vitest";
import { nativeOpenCodeConformanceRunnerEnvironment, nativeOpenCodeConformanceTestRunnerEnvironment } from "./native-opencode-conformance.js";

// CONF7. A qualified OpenShell Sandbox gives every process its egress proxy
// and trusted CA; the software Host fixture does not. Ordinary Runs get the
// fixture's proxy and CA through Heartbeat's testNativeRunnerEnvironment, the
// conformance probe had no counterpart, so its OpenCode reached the broker
// directly, failed TLS ("unable to verify the first certificate") and ended
// the turn before any authenticated model tunnel. The service now takes a
// closed test-only seam; production passes nothing and is unchanged.
const profile = { inputTokensUpperBound: 200_000, maxOutputTokens: 4096 };
const origin = "https://broker.test.invalid:8443";
const serverOwned = {
  PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN: origin,
  ANTHROPIC_API_KEY: "paperclip-managed-model-broker",
  PAPERCLIP_MANAGED_MODEL_INPUT_TOKENS_UPPER_BOUND: "200000",
  PAPERCLIP_MANAGED_MODEL_MAX_OUTPUT_TOKENS: "4096",
};
const fixtureSandbox = {
  NODE_EXTRA_CA_CERTS: "/tmp/run/broker-trust-bundle.pem", SSL_CERT_FILE: "/tmp/run/broker-trust-bundle.pem",
  HTTP_PROXY: "", http_proxy: "", HTTPS_PROXY: "http://127.0.0.1:43589", https_proxy: "http://127.0.0.1:43589",
  ALL_PROXY: "", all_proxy: "", NO_PROXY: "localhost,127.0.0.1,::1", no_proxy: "localhost,127.0.0.1,::1",
};

describe("managed OpenCode conformance runner environment", () => {
  it("is exactly the server-owned managed-model environment without the test seam", () => {
    expect(nativeOpenCodeConformanceRunnerEnvironment({ modelBrokerOrigin: origin, profile })).toEqual(serverOwned);
  });

  it("adds the software Host's Sandbox proxy and CA from the test seam", () => {
    expect(nativeOpenCodeConformanceRunnerEnvironment({ modelBrokerOrigin: origin, profile, testEnvironment: fixtureSandbox }))
      .toEqual({ ...fixtureSandbox, ...serverOwned });
    expect(nativeOpenCodeConformanceTestRunnerEnvironment({ HTTPS_PROXY: "https://proxy.test.invalid" }))
      .toEqual({ HTTPS_PROXY: "https://proxy.test.invalid" });
    expect(nativeOpenCodeConformanceTestRunnerEnvironment({})).toEqual({});
  });

  it.each([
    ["a managed-model origin", { PAPERCLIP_MANAGED_MODEL_BROKER_ORIGIN: "https://other.test.invalid" }],
    ["a managed-model bound", { PAPERCLIP_MANAGED_MODEL_MAX_OUTPUT_TOKENS: "8192" }],
    ["a provider key", { ANTHROPIC_API_KEY: "sk-ant-test" }],
    ["a broker token", { PAPERCLIP_SANDBOX_BROKER_TOKEN: "token" }],
    ["a GitHub token", { GH_TOKEN: "token" }],
    ["PATH", { PATH: "/tmp/evil:/usr/bin" }],
    ["a loader override", { LD_PRELOAD: "/tmp/evil.so" }],
    ["NODE_OPTIONS", { NODE_OPTIONS: "--require /tmp/evil.js" }],
    ["an MCP token", { PAPERCLIP_NATIVE_MCP_TOKEN: "token" }],
    ["a relative CA path", { SSL_CERT_FILE: "broker.pem" }],
    ["an unnormalized CA path", { NODE_EXTRA_CA_CERTS: "/tmp/run/../etc/ca.pem" }],
    ["a proxy with credentials", { HTTPS_PROXY: "http://user:secret@127.0.0.1:3128" }],
    ["a proxy with a path", { HTTPS_PROXY: "http://127.0.0.1:3128/path" }],
    ["a proxy with a trailing slash", { https_proxy: "http://127.0.0.1:3128/" }],
    ["a non-http proxy", { ALL_PROXY: "socks5://127.0.0.1:1080" }],
    ["a malformed proxy", { HTTP_PROXY: "not a url" }],
    ["a NO_PROXY entry with a space", { NO_PROXY: "localhost, 127.0.0.1" }],
    ["a NO_PROXY wildcard", { no_proxy: "*" }],
    ["a newline in a value", { SSL_CERT_FILE: "/tmp/a.pem\nLD_PRELOAD=/tmp/evil.so" }],
    ["a NUL in a value", { SSL_CERT_FILE: "/tmp/a.pem\0" }],
    ["an oversized value", { SSL_CERT_FILE: `/${"a".repeat(4096)}` }],
    ["a non-string value", { SSL_CERT_FILE: 1 }],
  ])("refuses %s", (_label, environment) => {
    expect(() => nativeOpenCodeConformanceTestRunnerEnvironment(environment)).toThrow("managed_opencode_test_runner_environment_invalid");
    expect(() => nativeOpenCodeConformanceRunnerEnvironment({ modelBrokerOrigin: origin, profile,
      testEnvironment: { ...fixtureSandbox, ...environment } })).toThrow("managed_opencode_test_runner_environment_invalid");
  });

  it.each([
    ["null", null], ["an array", [["SSL_CERT_FILE", "/tmp/a.pem"]]], ["a string", "SSL_CERT_FILE=/tmp/a.pem"],
    ["a class instance", new Map([["SSL_CERT_FILE", "/tmp/a.pem"]])],
  ])("refuses %s as the seam result", (_label, environment) => {
    expect(() => nativeOpenCodeConformanceTestRunnerEnvironment(environment)).toThrow("managed_opencode_test_runner_environment_invalid");
  });
});
