import type { LookupFunction } from "node:net";

export interface AdapterWebSocketOptions {
  lookup?: LookupFunction;
  followRedirects?: boolean;
  handshakeTimeout?: number;
}
interface AdapterNetworkPolicy {
  webSocket(url: string): Promise<AdapterWebSocketOptions>;
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
}
let policy: AdapterNetworkPolicy | undefined;
/** Hosting-process policy. Adapter configuration and provider responses cannot replace it. */
export function configureAdapterNetworkPolicy(value: AdapterNetworkPolicy) {
  policy = value;
}
export function adapterWebSocketOptions(
  url: string,
): Promise<AdapterWebSocketOptions> {
  return policy?.webSocket(url) ?? Promise.resolve({});
}
export function adapterNetworkFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  return policy ? policy.fetch(input, init) : fetch(input, init);
}
