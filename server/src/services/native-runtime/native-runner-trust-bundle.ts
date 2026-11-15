import { readFileSync, statSync } from "node:fs";
import { posix } from "node:path";
import { nativeRunnerOperatorSettings } from "./runner-operator-settings.js";

/** Credentialless preparation purpose of the runner trust-bundle copy. The
 * executor copies the server operator's runner CA bundle next to the staged
 * runnerd so runnerd can verify the runner WebSocket endpoint. The copy needs
 * no model, broker or workload credential. RuntimeControl admits it only in
 * the hidden provider-conformance lane, where a model capability is limited to
 * the one initial provider turn (CONF4b). */
export const NATIVE_RUNNER_TRUST_BUNDLE_PREPARATION_PURPOSE = "native_runner_trust_bundle" as const;

/** Upper bound of a staged runner trust bundle (a system bundle is ~220 KiB). */
export const NATIVE_RUNNER_TRUST_BUNDLE_MAX_BYTES = 2 * 1024 * 1024;

/** File mode of the staged runner trust bundle. */
export const NATIVE_RUNNER_TRUST_BUNDLE_MODE = 0o600;

/** The fixed Sandbox path runnerd reads its trust bundle from: next to the
 * staged `bin/paperclip-runnerd` under the task root's runtime directory. */
export function nativeRemoteRunnerTrustBundlePath(remoteCwd: string): string {
  return posix.join(remoteCwd, ".paperclip-runtime", "paperclip-runner", "bin", "runner-ca-bundle.pem");
}

/** The shell script that writes one staged runner file from base64 stdin. It
 * is the producer of `stageRemoteRunnerFile` and the shape RuntimeControl
 * matches for the trust-bundle copy, so both are built here. */
export function buildRemoteRunnerFileStageScript(targetPath: string, mode: number): string {
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  return `umask 077; mkdir -p ${quote(posix.dirname(targetPath))} && ` +
    `base64 -d > ${quote(targetPath)} && ` +
    `chmod ${mode.toString(8)} ${quote(targetPath)}`;
}

/** The bytes of the server operator's configured runner CA bundle, read from
 * the server's own environment (`PAPERCLIP_RUNNER_CA_BUNDLE_PATH`). Null when
 * none is configured, it is unreadable, empty or larger than the bound. */
export function readConfiguredNativeRunnerTrustBundle(
  serverEnvironment: Readonly<Record<string, string | undefined>> = process.env,
): Buffer | null {
  const configured = nativeRunnerOperatorSettings(serverEnvironment).runnerCaBundlePath;
  if (!configured) return null;
  try {
    const stat = statSync(configured);
    if (!stat.isFile() || stat.size === 0 || stat.size > NATIVE_RUNNER_TRUST_BUNDLE_MAX_BYTES) return null;
    const bytes = readFileSync(configured);
    return bytes.length > 0 && bytes.length <= NATIVE_RUNNER_TRUST_BUNDLE_MAX_BYTES ? bytes : null;
  } catch {
    return null;
  }
}
