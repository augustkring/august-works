import { isIP, type LookupFunction } from "node:net";
import { configureAdapterNetworkPolicy } from "@paperclipai/adapter-utils/network-policy";
import { isSaasDeployment } from "../../deployment-profile.js";
import { forbidden } from "../../errors.js";
import { resolveApprovedRemoteHttpAddresses } from "../remote-http-endpoint-guard.js";
import { guardedRemoteHttpFetch } from "../remote-http-fetch.js";

export async function saasWebSocketOptions(value: string, relayPort = 3102) {
  const url = new URL(value);
  if (
    url.protocol === "ws:" &&
    url.hostname === "127.0.0.1" &&
    url.port === String(relayPort) &&
    /^\/cells\/[a-f0-9-]{36}\/[1-9][0-9]{0,18}$/i.test(url.pathname) &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash
  )
    return { followRedirects: false, handshakeTimeout: 15000 };
  if (
    url.protocol !== "wss:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.search
  )
    throw forbidden("Use a public WSS Gateway without embedded credentials", {
      code: "SAAS_GATEWAY_ENDPOINT_DENIED",
    });
  url.protocol = "https:";
  const addresses = await resolveApprovedRemoteHttpAddresses(
    url,
    { allowPrivateNetwork: false },
    () =>
      forbidden("Gateway network endpoint is unavailable", {
        code: "SAAS_GATEWAY_ENDPOINT_DENIED",
      }),
  );
  // Node may request either a single address or all addresses for family selection. Neither path resolves DNS again.
  const lookup: LookupFunction = (_hostname, options, callback) => {
    const approved = addresses.map((address) => ({
      address,
      family: isIP(address),
    }));
    if ("all" in options && options.all)
      Reflect.apply(callback, undefined, [null, approved]);
    else {
      const chosen = approved.find(
        (address) =>
          !options.family || address.family === Number(options.family),
      );
      if (!chosen)
        Reflect.apply(callback, undefined, [
          Error("No approved Gateway address"),
        ]);
      else callback(null, chosen.address, chosen.family);
    }
  };
  return { lookup, followRedirects: false, handshakeTimeout: 15000 };
}
export function installSaasAdapterNetworkPolicy(relayPort = 3102) {
  configureAdapterNetworkPolicy({
    webSocket: (value) =>
      isSaasDeployment()
        ? saasWebSocketOptions(value, relayPort)
        : Promise.resolve({}),
    fetch: (input, init) => {
      if (!isSaasDeployment()) return fetch(input, init);
      const url = new URL(
        input instanceof Request ? input.url : input.toString(),
      );
      if (url.protocol !== "https:" || url.username || url.password || url.hash)
        throw forbidden("Public HTTPS provider endpoint required");
      return guardedRemoteHttpFetch(
        url,
        { ...init, redirect: "manual", credentials: "omit" },
        {
          allowPrivateNetwork: false,
          error: () =>
            forbidden("Provider endpoint is unavailable", {
              code: "SAAS_PROVIDER_ENDPOINT_DENIED",
            }),
        },
      );
    },
  });
}
