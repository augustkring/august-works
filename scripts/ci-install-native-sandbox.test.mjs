import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const installer = join(dirname(fileURLToPath(import.meta.url)), "ci-install-native-sandbox.sh");
const put = (p, s) => { writeFileSync(p, s); chmodSync(p, 0o755); };
function run({ ready = true, probeExit = 0 } = {}) {
  const root = mkdtempSync(join(tmpdir(), "native-sandbox-")), bin = join(root, "bin"), scripts = join(root, "scripts");
  mkdirSync(bin); mkdirSync(scripts);
  const aptLog = join(root, "apt.log"), probeLog = join(root, "probe.log"), bwrap = join(bin, "bwrap");
  writeFileSync(aptLog, ""); writeFileSync(probeLog, "");
  // These stubs test installer wiring only; they do not prove host confinement.
  const bwrapBody = `#!/bin/sh\nprintf '%s\\n' "$*" >> "$PROBE_LOG"\nexit "$BWRAP_EXIT"\n`;
  put(join(root, "bwrap-template"), bwrapBody);
  if (ready) put(bwrap, bwrapBody);
  put(join(bin, "prlimit"), "#!/bin/sh\nexit 0\n");
  put(join(bin, "cat"), "#!/bin/sh\necho 0\n");
  put(join(bin, "bash"), "#!/bin/sh\nexec /bin/bash \"$@\"\n");
  put(join(bin, "dirname"), "#!/bin/sh\nexec /usr/bin/dirname \"$@\"\n");
  put(join(bin, "env"), `#!/bin/bash\n[[ "$1" == -i && "$2" == PATH=/usr/bin:/bin && "$3" == bwrap ]] || exit 91\nshift 3\nexec "$BWRAP_STUB" "$@"\n`);
  put(join(bin, "timeout"), "#!/bin/bash\nshift 2\nexec \"$@\"\n");
  put(join(bin, "sudo"), "#!/bin/sh\nexec \"$@\"\n");
  const fixtureInstaller = join(scripts, "ci-install-native-sandbox.sh");
  copyFileSync(installer, fixtureInstaller); chmodSync(fixtureInstaller, 0o755);
  put(join(scripts, "ci-canonicalize-ubuntu-apt-mirrors.sh"), "#!/bin/sh\nprintf 'mirror-prepared\\n' >> \"$APT_LOG\"\n");
  put(join(bin, "apt-get"), "#!/bin/bash\nprintf 'apt:%s\\n' \"$*\" >> \"$APT_LOG\"\nif [[ \"$*\" == *bubblewrap* ]]; then /bin/cp \"$BWRAP_TEMPLATE\" \"$BWRAP_STUB\"; /bin/chmod +x \"$BWRAP_STUB\"; fi\n");
  try {
    const result = spawnSync("/bin/bash", [fixtureInstaller], { encoding: "utf8", env: { ...process.env, PATH: bin, GITHUB_ACTIONS: "true", RUNNER_OS: "Linux", RUNNER_TEMP: root, APT_LOG: aptLog, PROBE_LOG: probeLog, BWRAP_STUB: bwrap, BWRAP_TEMPLATE: join(root, "bwrap-template"), BWRAP_EXIT: String(probeExit) } });
    return { ...result, apt: existsSync(aptLog) ? readFileSync(aptLog, "utf8") : "", probe: readFileSync(probeLog, "utf8") };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("ready native tools skip apt and run the isolation probe", () => {
  const r = run(); assert.equal(r.status, 0, r.stderr); assert.equal(r.apt, "");
  assert.match(r.probe, /--unshare-net/); assert.match(r.probe, /--tmpfs \/ --proc \/proc/);
});
test("a failed sandbox probe command remains a failure without apt fallback", () => {
  const r = run({ probeExit: 23 }); assert.equal(r.status, 23); assert.equal(r.apt, "");
  assert.match(r.probe, /--unshare-pid/);
});
test("a missing bwrap uses bounded apt fallback before the sandbox probe command", () => {
  const r = run({ ready: false }); assert.equal(r.status, 0, r.stderr);
  const lines = r.apt.trim().split("\n");
  assert.equal(lines[0], "mirror-prepared");
  assert.match(lines[1], /^apt:.*update/); assert.match(lines[2], /^apt:.*install .*bubblewrap/);
  assert.match(r.probe, /--unshare-net/);
});
