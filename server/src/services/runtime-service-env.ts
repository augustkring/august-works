export function sanitizeRuntimeServiceBaseEnv(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  for (const key of Object.keys(env)) {
    if (["PAPERCLIP_", "AW_", "PADDLE_", "MAILGUN_", "RUNTIME_CONTROL_", "AWS_", "UPCLOUD_", "RUN_LOG_"].some(prefix => key.startsWith(prefix))) {
      delete env[key];
    }
  }
  // These origin settings belong to the parent instance. Letting them leak into a
  // managed worktree runtime can send auth cookies and OAuth callbacks to the wrong
  // Paperclip instance. Runtime/service overrides are merged back after sanitizing.
  delete env.BETTER_AUTH_URL;
  delete env.BETTER_AUTH_BASE_URL;
  delete env.BETTER_AUTH_SECRET;
  delete env.DATABASE_URL;
  delete env.npm_config_tailscale_auth;
  delete env.npm_config_authenticated_private;
  return env;
}

