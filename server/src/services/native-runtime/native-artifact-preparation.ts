import { nativeRuntimeErasureEnvironmentExact } from "./remote-runner-identity.js";
import { createHash } from "node:crypto";
import { posix } from "node:path";
// Exactly the build-owned provider manifest canonicalization already used by
// readRemoteProviderPackManifest; do not substitute execution-input hashing.
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export const REMOTE_PROVIDER_PACK_SCHEMA = "paperclip-runner/remote-provider-pack/v1";
export const REMOTE_PROVIDER_PACK_PINS = {
  nodeMinimum: "24.11.0",
  codex: "0.156.0",
  opencode: "1.18.32",
  acpx: "0.13.1",
  claudeAcp: "0.73.0",
  codexAcp: "1.6.2",
} as const;
export const REMOTE_PROVIDER_PACK_PROFILE_DIGESTS = {
  claude:
    "sha256:9d73d1f0f121fb96cc8badb28c22d5bff02d8582eb2e40360a81c189e1b9422a",
  codex:
    "sha256:c4538599d1ab767db5dff50934f13bb5ba313a59d9c4a83e993fac4617ea63d3",
} as const;
export const REMOTE_PROVIDER_PACK_ARTIFACT_PATHS = {
  nodeCommand: "node_modules/node/bin/node",
  productionLock: "pnpm-lock.yaml",
  opencodeCommand: "node_modules/.bin/opencode",
  opencodeExecutable: "node_modules/opencode-ai/bin/opencode.exe",
  opencodeProxy: "dist/cli/opencode-app-server-proxy.cjs",
  acpxSidecar: "dist/cli/acpx-runtime-sidecar.cjs",
} as const;

export const NATIVE_PROVIDER_PACK_VERIFY_SCRIPT = [
      "const fs=require('node:fs')",
      "const crypto=require('node:crypto')",
      "const path=require('node:path')",
      "const root=process.argv[1]",
      "const expected=Buffer.from(process.argv[2],'base64').toString('utf8')",
      "const actual=fs.readFileSync(path.join(root,'provider-pack.json'),'utf8').trim()",
      "const canonical=(v)=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v)",
      "const manifest=JSON.parse(actual)",
      "if(canonical(manifest)!==expected)throw new Error('manifest mismatch')",
      "const hash=(p)=>'sha256:'+crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex')",
      "const tree=(treeRoot)=>{const digest=crypto.createHash('sha256');const visit=(directory,prefix='')=>{for(const entry of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const relative=prefix?prefix+'/'+entry.name:entry.name;const absolute=path.join(directory,entry.name);if(entry.isDirectory()){digest.update('directory\\0'+relative+'\\n');visit(absolute,relative)}else if(entry.isFile()){digest.update('file\\0'+relative+'\\0'+'sha256:'+crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex')+'\\n')}else if(entry.isSymbolicLink()){digest.update('symlink\\0'+relative+'\\0'+fs.readlinkSync(absolute)+'\\n')}else throw new Error('unsupported dist entry '+relative)}};visit(treeRoot);return 'sha256:'+digest.digest('hex')}",
      "for(const name of ['nodeCommand','productionLock','opencodeCommand','opencodeExecutable','opencodeProxy','acpxSidecar']){const artifact=manifest.payload.artifacts[name];if(hash(artifact.path)!==artifact.sha256)throw new Error(name+' digest mismatch')}",
      "if(tree(path.join(root,'dist'))!==manifest.payload.distDigest)throw new Error('dist tree digest mismatch')",
      "const version=process.versions.node.split('.').map(Number)",
      "const minimum=manifest.payload.pins.nodeMinimum.split('.').map(Number)",
      "if(version[0]<minimum[0]||(version[0]===minimum[0]&&(version[1]<minimum[1]||(version[1]===minimum[1]&&version[2]<minimum[2]))))throw new Error('Node version incompatible')",
      "if(process.platform!==manifest.payload.target.platform||process.arch!==manifest.payload.target.architecture)throw new Error('provider pack target mismatch')",
      "const packageVersion=(pkg)=>JSON.parse(fs.readFileSync(path.join(root,'node_modules',...pkg.split('/'),'package.json'),'utf8')).version",
      "const expectedPackages={acpx:manifest.payload.pins.acpx,'@agentclientprotocol/claude-agent-acp':manifest.payload.pins.claudeAcp,'@agentclientprotocol/codex-acp':manifest.payload.pins.codexAcp,'opencode-ai':manifest.payload.pins.opencode}",
      "for(const [pkg,version] of Object.entries(expectedPackages))if(packageVersion(pkg)!==version)throw new Error(pkg+' version mismatch')",
    ].join(";");

export const NATIVE_PROVIDER_PACK_DISCOVERY_SCRIPT = 'for candidate in /opt/paperclip-runner/provider-pack "$HOME/.local/share/paperclip-runner/provider-pack"; do if [ -f "$candidate/provider-pack.json" ]; then printf \'%s\\n\' "$candidate"; break; fi; done';
export const NATIVE_RUNNER_ARTIFACT_CHECKSUM_SCRIPT = 'test -x "$1" || exit 1; if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1"; else shasum -a 256 "$1"; fi';
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const absolute = (value: unknown): value is string => typeof value === "string" && value.length <= 4096 &&
  posix.isAbsolute(value) && posix.normalize(value) === value && !value.includes("\0");
export const NATIVE_FIXED_ARTIFACT_CHECKSUM_SCRIPT = 'set -eu; test -f "$1"; if [ -x /usr/bin/sha256sum ]; then /usr/bin/sha256sum -- "$1"; elif [ -x /bin/sha256sum ]; then /bin/sha256sum -- "$1"; else exit 1; fi';
export const NATIVE_SELECTED_PROVIDER_PACK_DISCOVERY_SCRIPT = 'test -f "$1/provider-pack.json" && printf \'%s\\n\' "$1"';
/** Read only the server process operator configuration; never an Agent env or hook DTO. */
export function configuredNativeProviderPackInstallRoot(): string {
  const selected = process.env.PAPERCLIP_RUNNER_REMOTE_PROVIDER_PACK_INSTALL_ROOT?.trim() || "/opt/paperclip-runner/provider-pack";
  if (!absolute(selected) || selected === "/") throw new Error("native_provider_pack_install_root_invalid");
  return selected;
}
export function nativeProviderPackLinkCommand(source: string, target: string): string {
  return `umask 077; mkdir -p ${quote(posix.dirname(target))} && rm -rf ${quote(target)} && ln -s ${quote(source)} ${quote(target)}`;
}
export function nativeProviderPackVerificationArgs(packRoot: string, manifest: unknown): string[] {
  return ["-e", NATIVE_PROVIDER_PACK_VERIFY_SCRIPT, packRoot,
    Buffer.from(canonicalJson(manifest), "utf8").toString("base64")];
}
export interface NativeManagedArtifactAuthority {
  runnerSha256: string;
  installedPackRoot: string;
  providerPackManifest: unknown;
}
/** Closed artifact operations used by the managed OpenCode constructor.
 * The authority is created only after local build-owned bytes/manifest verify.
 * The shared script still checks every remote file and full dist hash before launch. */
export function exactNativeManagedArtifactCommand(input: {
  request: { argv: string[]; cwd: string; stdinBase64: string; env?: Record<string, string> };
  taskRoot: string;
  authority: unknown;
}): boolean {
  const authority = input.authority as Partial<NativeManagedArtifactAuthority> | null;
  if (!authority || !/^[a-f0-9]{64}$/.test(authority.runnerSha256 ?? "")) return false;
  const manifest = authority.providerPackManifest as { schema?: unknown; digest?: unknown; payload?: {
    pins?: unknown; acpxProfileDigests?: unknown; runnerSourceRevision?: unknown; distDigest?: unknown;
    bridgeDigest?: unknown; target?: { platform?: unknown; architecture?: unknown };
    artifacts?: Record<string, { path?: unknown; sha256?: unknown }> } } | undefined;
  const payload = manifest?.payload;
  if (!payload || manifest?.schema !== REMOTE_PROVIDER_PACK_SCHEMA ||
    canonicalJson(payload.pins) !== canonicalJson(REMOTE_PROVIDER_PACK_PINS) ||
    canonicalJson(payload.acpxProfileDigests) !== canonicalJson(REMOTE_PROVIDER_PACK_PROFILE_DIGESTS) ||
    typeof payload.runnerSourceRevision !== "string" || !/^[a-f0-9]{40}(?:-dirty)?$/.test(payload.runnerSourceRevision) ||
    typeof payload.target?.platform !== "string" || typeof payload.target.architecture !== "string" ||
    typeof payload.distDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(payload.distDigest) ||
    manifest.digest !== `sha256:${createHash("sha256").update(canonicalJson(payload)).digest("hex")}`) return false;
  for (const [name, relativePath] of Object.entries(REMOTE_PROVIDER_PACK_ARTIFACT_PATHS)) {
    const artifact = payload.artifacts?.[name];
    if (artifact?.path !== relativePath || typeof artifact.sha256 !== "string" ||
      !/^sha256:[a-f0-9]{64}$/.test(artifact.sha256)) return false;
  }
  if (payload.bridgeDigest !== `sha256:${createHash("sha256")
    .update(payload.artifacts!.opencodeProxy!.sha256 as string).update("\n")
    .update(payload.artifacts!.acpxSidecar!.sha256 as string).update("\n").update(payload.distDigest).digest("hex")}`) return false;
  const { argv, cwd, stdinBase64 } = input.request;
  if (cwd !== input.taskRoot || stdinBase64 !== "") return false;
  const runtimeRoot = posix.join(input.taskRoot, ".paperclip-runtime", "paperclip-runner");
  const runner = posix.join(runtimeRoot, "bin", "paperclip-runnerd");
  const pack = posix.join(runtimeRoot, "provider-pack");
  if (!absolute(authority.installedPackRoot) || authority.installedPackRoot === input.taskRoot ||
    authority.installedPackRoot.startsWith(input.taskRoot + "/")) return false;
  const allowedPack = (root: unknown): root is string => root === pack || root === authority.installedPackRoot;
  if (argv.length === 2 && argv[0] === runner && argv[1] === "--build-metadata") return true;
  if (argv.length === 5 && argv[0] === "/bin/sh" && argv[1] === "-c" &&
    argv[2] === NATIVE_FIXED_ARTIFACT_CHECKSUM_SCRIPT && argv[3] === "paperclip-managed-artifact-checksum") {
    const nodeRelative = payload.artifacts!.nodeCommand!.path as string;
    return argv[4] === runner || argv[4] === posix.join(pack, nodeRelative) ||
      argv[4] === posix.join(authority.installedPackRoot, nodeRelative);
  }
  if (argv.length === 5 && argv[0] === "sh" && argv[1] === "-c" &&
    argv[2] === NATIVE_SELECTED_PROVIDER_PACK_DISCOVERY_SCRIPT && argv[3] === "paperclip-managed-provider-pack" &&
    argv[4] === authority.installedPackRoot) return true;
  if (argv.length === 3 && argv[0] === "sh" && argv[1] === "-c" &&
    ["uname -s; uname -m", `rm -rf ${quote(pack)}`].includes(argv[2]!)) return true;
  if (argv.length === 5 && allowedPack(argv[3])) {
    const root = argv[3];
    const node = payload.artifacts?.nodeCommand?.path;
    if (typeof node !== "string" || argv[0] !== posix.join(root, node)) return false;
    return nativeRuntimeErasureEnvironmentExact(input.request.env ?? {}) &&
      JSON.stringify(argv.slice(1)) === JSON.stringify(nativeProviderPackVerificationArgs(root, manifest));
  }
  if (argv.length === 2 && argv[1] === "--version") {
    const relative = payload.artifacts?.opencodeCommand?.path;
    if (typeof relative !== "string") return false;
    const root = argv[0]!.slice(0, -(relative.length + 1));
    return allowedPack(root) && argv[0] === posix.join(root, relative);
  }
  if (argv.length === 3 && argv[0] === "sh" && argv[1] === "-c") {
    const prefix = `umask 077; mkdir -p ${quote(posix.dirname(pack))} && rm -rf ${quote(pack)} && ln -s `;
    const suffix = ` ${quote(pack)}`;
    if (!argv[2]!.startsWith(prefix) || !argv[2]!.endsWith(suffix)) return false;
    const source = argv[2]!.slice(prefix.length, -suffix.length);
    // Only canonical shell quoting is decoded; no shell evaluation occurs.
    if (!source.startsWith("'") || !source.endsWith("'")) return false;
    const root = source.slice(1, -1).replaceAll("'\\''", "'");
    return allowedPack(root) && root !== pack && argv[2] === nativeProviderPackLinkCommand(root, pack);
  }
  return false;
}
