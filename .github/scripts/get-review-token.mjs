#!/usr/bin/env node
/** Select review authentication without requiring a fork to own the upstream app. */
import { execFile } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function getAppToken(env) {
  const { stdout } = await execFileAsync(process.execPath, [
    fileURLToPath(new URL('./get-bot-token.mjs', import.meta.url)),
  ], { env });
  return stdout.trim();
}

export async function resolveReviewAuthentication(env, createAppToken = getAppToken) {
  // A configured app must succeed. Never hide invalid credentials with fallback.
  const useApp = Boolean(env.COMMITPERCLIP_KEY);
  const token = useApp ? await createAppToken(env) : env.WORKFLOW_TOKEN;
  if (typeof token !== 'string' || !token || /[\r\n]/.test(token)) {
    throw new Error('Review authentication requires a valid app or workflow token.');
  }
  return { token, commentAuthor: useApp ? 'commitperclip[bot]' : 'github-actions[bot]' };
}

async function main() {
  if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required.');
  const { token, commentAuthor } = await resolveReviewAuthentication(process.env);
  console.log(`::add-mask::${token.replaceAll('%', '%25')}`);
  await appendFile(process.env.GITHUB_OUTPUT, `value=${token}\ncomment_author=${commentAuthor}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
