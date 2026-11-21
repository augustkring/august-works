import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const helper = new URL("../ci-canonicalize-ubuntu-apt-mirrors.sh", import.meta.url);

function runHelper(file) {
  return spawnSync("bash", [helper.pathname, file], { encoding: "utf8" });
}

test("rewrites only the Azure Ubuntu mirror hostname in the mirror list", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-apt-mirrors-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "apt-mirrors.txt");
  fs.writeFileSync(file, "http://azure.archive.ubuntu.com/ubuntu/\nhttp://archive.ubuntu.com/ubuntu/\nhttp://azure.archive.ubuntu.com.example/ubuntu/\n");

  const result = runHelper(file);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(file, "utf8"), "http://archive.ubuntu.com/ubuntu/\nhttp://archive.ubuntu.com/ubuntu/\nhttp://azure.archive.ubuntu.com.example/ubuntu/\n");
});

test("leaves canonical-only and absent mirror lists unchanged", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-apt-mirrors-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "apt-mirrors.txt");
  const original = "http://archive.ubuntu.com/ubuntu/\nhttp://security.ubuntu.com/ubuntu/\n";
  fs.writeFileSync(file, original);

  const existingResult = runHelper(file);
  assert.equal(existingResult.status, 0, existingResult.stderr);
  assert.equal(fs.readFileSync(file, "utf8"), original);

  const absent = path.join(root, "absent-mirrors.txt");
  const absentResult = runHelper(absent);
  assert.equal(absentResult.status, 0, absentResult.stderr);
  assert.equal(fs.existsSync(absent), false);
});
