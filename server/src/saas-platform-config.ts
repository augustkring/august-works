import { z } from "zod";
import { loadReadOnlyModelProfiles, type ReadOnlyModelProfile } from "./services/orchestration/read-only-model-profiles.js";
import { loadWorkerModelProfiles, type WorkerModelProfile } from "./services/orchestration/worker-model-profiles.js";

const required = z.string().trim().min(1);
const secret = z.string().min(32);
const key = z.string().regex(/^[a-f0-9]{64}$/i);
const https = required.refine((value) => {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash
    );
  } catch {
    return false;
  }
});
const integer = (fallback: number) =>
  z.coerce.number().int().positive().default(fallback);
const schema = z.object({
  UPCLOUD_USERNAME: required.optional(),
  UPCLOUD_PASSWORD: secret.optional(),
  RUNTIME_CONTROL_HOST_DISK_GIB: integer(50),
  RUNTIME_CONTROL_STATE_DISK_GIB: integer(100),
  RUNTIME_CONTROL_MAX_ESTIMATED_MONTHLY_EUR_MINOR: z
    .string()
    .regex(/^[0-9]{1,20}$/)
    .default("0"),
  AW_RUNTIME_BACKUP_BUCKET: required,
  AW_EXPORT_BUCKET: required,
  AW_BACKUP_RETENTION_ACCESS_KEY_ID: required,
  AW_BACKUP_RETENTION_SECRET_ACCESS_KEY: required,
  AW_BACKUP_WRITE_ACCESS_KEY_ID: required,
  AW_BACKUP_WRITE_SECRET_ACCESS_KEY: required,
  AW_BACKUP_RESTORE_ACCESS_KEY_ID: required,
  AW_BACKUP_RESTORE_SECRET_ACCESS_KEY: required,
  AW_PLATFORM_ENV: z.enum(["staging", "production"]),
  DATABASE_URL: required.refine((value) => {
    try {
      const u = new URL(value);
      return (
        ["postgres:", "postgresql:"].includes(u.protocol) &&
        u.searchParams.get("sslmode") === "verify-full"
      );
    } catch {
      return false;
    }
  }),
  BETTER_AUTH_SECRET: secret,
  PAPERCLIP_SECRETS_MASTER_KEY: key,
  PAPERCLIP_STORAGE_PROVIDER: z.literal("s3"),
  PAPERCLIP_STORAGE_S3_BUCKET: required,
  PAPERCLIP_STORAGE_S3_REGION: z.literal("europe-1"),
  PAPERCLIP_STORAGE_S3_ENDPOINT: https,
  AWS_ACCESS_KEY_ID: required,
  AWS_SECRET_ACCESS_KEY: required,
  RUN_LOG_S3_BUCKET: required,
  RUN_LOG_S3_REGION: z.literal("europe-1"),
  RUN_LOG_S3_ENDPOINT: https,
  AW_RUN_LOG_ENCRYPTION_KEY: key,
  AW_RUN_LOG_KEY_ID: required,
  AW_RUN_LOG_PREVIOUS_KEYS: z.string().default("{}"),
  AW_OUTBOX_ENCRYPTION_KEY: key,
  AW_OUTBOX_KEY_ID: required,
  AW_OUTBOX_PREVIOUS_KEYS: z.string().default("{}"),
  AW_EMAIL_RECIPIENT_HASH_KEY: key,
  MAILGUN_API_KEY: required,
  MAILGUN_WEBHOOK_SIGNING_KEY: secret,
  MAILGUN_REGION: z.literal("eu"),
  MAILGUN_DOMAIN: required.regex(/^[a-z0-9][a-z0-9.-]+[a-z0-9]$/),
  MAILGUN_FROM: required.email(),
  MAILGUN_STAGING_RECIPIENTS: z.string().default(""),
  PADDLE_ENVIRONMENT: z.enum(["sandbox", "production"]),
  PADDLE_API_KEY: required,
  PADDLE_WEBHOOK_SECRET: secret,
  AW_PROVIDER_PAYLOAD_KEY: key,
  AW_PROVIDER_PAYLOAD_KEY_ID: required,
  AW_PROVIDER_PAYLOAD_PREVIOUS_KEYS: z.string().default("{}"),
  AW_BILLING_GRACE_DAYS: z.coerce.number().int().min(0).max(30).default(7),
  RUNTIME_CONTROL_RELAY_PORT: z.coerce
    .number()
    .int()
    .min(1024)
    .max(65535)
    .default(3102),
  RUNTIME_CONTROL_REGION: z.literal("dk-cph1"),
  RUNTIME_CONTROL_NETWORK_ID: z.string().uuid(),
  RUNTIME_CONTROL_HOST_PLAN: required,
  RUNTIME_CONTROL_HOST_AGENT_IMAGE: required.regex(
    /^[a-z0-9./:_-]+@sha256:[a-f0-9]{64}$/,
  ),
  RUNTIME_CONTROL_OS_TEMPLATE: required,
  RUNTIME_CONTROL_MAX_HOSTS: integer(4),
  RUNTIME_CONTROL_MAX_CREATES_PER_HOUR: integer(2),
  RUNTIME_CONTROL_HEARTBEAT_SECONDS: integer(20),
  RUNTIME_CONTROL_SUSPECT_SECONDS: integer(90),
  RUNTIME_CONTROL_UNREACHABLE_SECONDS: integer(180),
  RUNTIME_CONTROL_BACKUP_RETENTION_DAYS: integer(30),
  AW_INTERNAL_OPERATOR_USER_IDS: required,
  AW_DEPLOYMENT_IMAGE_DIGEST: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  AW_DEPLOYMENT_SOURCE_SHA: z.string().regex(/^[a-f0-9]{40}$/),
  AW_RUNTIME_OPENSHELL_PROVER_PATH: required.refine(v => v.startsWith("/")).optional(),
  AW_RUNTIME_OPENSHELL_PROVER_SHA256: key.optional(),
  AW_READ_ONLY_MODEL_PROFILES_PATH: required.refine(v => v.startsWith("/")).optional(),
  AW_READ_ONLY_MODEL_PROFILES_SHA256: key.optional(),
  AW_WORKER_MODEL_PROFILES_PATH: required.refine(v => v.startsWith("/")).optional(),
  AW_WORKER_MODEL_PROFILES_SHA256: key.optional(),
});

export type SaasPlatformConfig = {
  readOnlyModelProfiles?: ReadOnlyModelProfile[];
  workerModelProfiles?: WorkerModelProfile[];
  environment: "staging" | "production";
  databaseUrl: string;
  runLogs?: {
    encryptionKey: string;
    keyId: string;
    previousKeys: Record<string, string>;
  };
  outbox: {
    encryptionKey: string;
    keyId: string;
    previousKeys: Record<string, string>;
    recipientHashKey: string;
  };
  mail: {
    apiKey: string;
    signingKey: string;
    domain: string;
    from: string;
    stagingRecipients: string[];
  };
  billing: {
    environment: "sandbox" | "production";
    apiKey: string;
    webhookSecret: string;
    payloadKey: string;
    payloadKeyId: string;
    previousKeys: Record<string, string>;
    graceDays: number;
  };
  objects: {
    bucket: string;
    exportsBucket?: string;
    endpoint: string;
    region: string;
  };
  runtime: {
    openshellProver?: { executable: string; executableSha256: string };
    hostDiskGib?: number;
    stateDiskGib?: number;
    relayPort?: number;
    region: string;
    networkId: string;
    hostPlan: string;
    hostAgentImage: string;
    osTemplate: string;
    maxHosts: number;
    maxCreatesPerHour: number;
    maxEstimatedMonthlyMinor?: string;
    heartbeatSeconds: number;
    suspectSeconds: number;
    unreachableSeconds: number;
    backupRetentionDays: number;
  };
  backups?: {
    bucket: string;
    retentionCredentials: { accessKeyId: string; secretAccessKey: string };
    writeCredentials: { accessKeyId: string; secretAccessKey: string };
    restoreCredentials: { accessKeyId: string; secretAccessKey: string };
  };
  upcloud?: { username: string; password: string };
  operatorUserIds: string[];
  deployment: { imageDigest: string; sourceSha: string };
};

/** No parsed secret/configuration values are included in validation errors. */
export function loadSaasPlatformConfig(
  env: NodeJS.ProcessEnv = process.env,
): SaasPlatformConfig | undefined {
  if (!env.AW_PLATFORM_ENV) return undefined;
  const parsed = schema.safeParse(env);
  if (!parsed.success)
    throw new Error(
      "Invalid SaaS platform configuration: " +
        [...new Set(parsed.error.issues.map((i) => i.path.join(".")))].join(
          ", ",
        ),
    );
  const v = parsed.data;
  if (Boolean(v.AW_RUNTIME_OPENSHELL_PROVER_PATH) !== Boolean(v.AW_RUNTIME_OPENSHELL_PROVER_SHA256)) throw new Error("OpenShell prover requires both a private absolute path and binary digest");
  if (Boolean(v.UPCLOUD_USERNAME) !== Boolean(v.UPCLOUD_PASSWORD))
    throw new Error("UpCloud requires both scoped API credentials");
  if (
    (v.AW_PLATFORM_ENV === "production") !==
    (v.PADDLE_ENVIRONMENT === "production")
  )
    throw new Error("Paddle environment must match SaaS environment");
  if (
    v.RUNTIME_CONTROL_HEARTBEAT_SECONDS >= v.RUNTIME_CONTROL_SUSPECT_SECONDS ||
    v.RUNTIME_CONTROL_SUSPECT_SECONDS >= v.RUNTIME_CONTROL_UNREACHABLE_SECONDS
  )
    throw new Error("Runtime liveness thresholds must increase");
  const recipients = v.MAILGUN_STAGING_RECIPIENTS.split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (
    recipients.some((s) => !z.string().email().safeParse(s).success) ||
    (v.AW_PLATFORM_ENV === "staging" && !recipients.length)
  )
    throw new Error(
      "Staging email needs an explicit valid recipient allowlist",
    );
  const operators = v.AW_INTERNAL_OPERATOR_USER_IDS.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!operators.length)
    throw new Error("SaaS requires explicit internal operators");
  const independentKeys = [
    v.BETTER_AUTH_SECRET,
    v.PAPERCLIP_SECRETS_MASTER_KEY,
    v.AW_OUTBOX_ENCRYPTION_KEY,
    v.AW_EMAIL_RECIPIENT_HASH_KEY,
    v.AW_PROVIDER_PAYLOAD_KEY,
    v.AW_RUN_LOG_ENCRYPTION_KEY,
  ];
  if (new Set(independentKeys).size !== independentKeys.length)
    throw new Error("SaaS cryptographic purposes require separate keys");
  function previousKeys(raw: string, activeId: string, field: string) {
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error("Invalid SaaS key ring: " + field);
    }
    const parsed = z.record(z.string().min(1).max(80), key).safeParse(value);
    if (
      !parsed.success ||
      Object.keys(parsed.data).length > 8 ||
      activeId in parsed.data
    )
      throw new Error("Invalid SaaS key ring: " + field);
    return parsed.data;
  }
  return {
    runLogs: {
      encryptionKey: v.AW_RUN_LOG_ENCRYPTION_KEY,
      keyId: v.AW_RUN_LOG_KEY_ID,
      previousKeys: previousKeys(
        v.AW_RUN_LOG_PREVIOUS_KEYS,
        v.AW_RUN_LOG_KEY_ID,
        "AW_RUN_LOG_PREVIOUS_KEYS",
      ),
    },
    backups: {
      bucket: v.AW_RUNTIME_BACKUP_BUCKET,
      retentionCredentials: {
        accessKeyId: v.AW_BACKUP_RETENTION_ACCESS_KEY_ID,
        secretAccessKey: v.AW_BACKUP_RETENTION_SECRET_ACCESS_KEY,
      },
      writeCredentials: {
        accessKeyId: v.AW_BACKUP_WRITE_ACCESS_KEY_ID,
        secretAccessKey: v.AW_BACKUP_WRITE_SECRET_ACCESS_KEY,
      },
      restoreCredentials: {
        accessKeyId: v.AW_BACKUP_RESTORE_ACCESS_KEY_ID,
        secretAccessKey: v.AW_BACKUP_RESTORE_SECRET_ACCESS_KEY,
      },
    },
    upcloud:
      v.UPCLOUD_USERNAME && v.UPCLOUD_PASSWORD
        ? { username: v.UPCLOUD_USERNAME, password: v.UPCLOUD_PASSWORD }
        : undefined,
    environment: v.AW_PLATFORM_ENV,
    databaseUrl: v.DATABASE_URL,
    outbox: {
      encryptionKey: v.AW_OUTBOX_ENCRYPTION_KEY,
      keyId: v.AW_OUTBOX_KEY_ID,
      previousKeys: previousKeys(
        v.AW_OUTBOX_PREVIOUS_KEYS,
        v.AW_OUTBOX_KEY_ID,
        "AW_OUTBOX_PREVIOUS_KEYS",
      ),
      recipientHashKey: v.AW_EMAIL_RECIPIENT_HASH_KEY,
    },
    mail: {
      apiKey: v.MAILGUN_API_KEY,
      signingKey: v.MAILGUN_WEBHOOK_SIGNING_KEY,
      domain: v.MAILGUN_DOMAIN,
      from: v.MAILGUN_FROM,
      stagingRecipients: recipients,
    },
    billing: {
      environment: v.PADDLE_ENVIRONMENT,
      apiKey: v.PADDLE_API_KEY,
      webhookSecret: v.PADDLE_WEBHOOK_SECRET,
      payloadKey: v.AW_PROVIDER_PAYLOAD_KEY,
      payloadKeyId: v.AW_PROVIDER_PAYLOAD_KEY_ID,
      previousKeys: previousKeys(
        v.AW_PROVIDER_PAYLOAD_PREVIOUS_KEYS,
        v.AW_PROVIDER_PAYLOAD_KEY_ID,
        "AW_PROVIDER_PAYLOAD_PREVIOUS_KEYS",
      ),
      graceDays: v.AW_BILLING_GRACE_DAYS,
    },
    objects: {
      bucket: v.PAPERCLIP_STORAGE_S3_BUCKET,
      exportsBucket: v.AW_EXPORT_BUCKET,
      region: v.PAPERCLIP_STORAGE_S3_REGION,
      endpoint: v.PAPERCLIP_STORAGE_S3_ENDPOINT,
    },
    runtime: {
      ...(v.AW_RUNTIME_OPENSHELL_PROVER_PATH && v.AW_RUNTIME_OPENSHELL_PROVER_SHA256 ? { openshellProver: { executable: v.AW_RUNTIME_OPENSHELL_PROVER_PATH, executableSha256: v.AW_RUNTIME_OPENSHELL_PROVER_SHA256.toLowerCase() } } : {}),
      hostDiskGib: v.RUNTIME_CONTROL_HOST_DISK_GIB,
      stateDiskGib: v.RUNTIME_CONTROL_STATE_DISK_GIB,
      relayPort: v.RUNTIME_CONTROL_RELAY_PORT,
      region: v.RUNTIME_CONTROL_REGION,
      networkId: v.RUNTIME_CONTROL_NETWORK_ID,
      hostPlan: v.RUNTIME_CONTROL_HOST_PLAN,
      hostAgentImage: v.RUNTIME_CONTROL_HOST_AGENT_IMAGE,
      osTemplate: v.RUNTIME_CONTROL_OS_TEMPLATE,
      maxHosts: v.RUNTIME_CONTROL_MAX_HOSTS,
      maxCreatesPerHour: v.RUNTIME_CONTROL_MAX_CREATES_PER_HOUR,
      maxEstimatedMonthlyMinor:
        v.RUNTIME_CONTROL_MAX_ESTIMATED_MONTHLY_EUR_MINOR,
      heartbeatSeconds: v.RUNTIME_CONTROL_HEARTBEAT_SECONDS,
      suspectSeconds: v.RUNTIME_CONTROL_SUSPECT_SECONDS,
      unreachableSeconds: v.RUNTIME_CONTROL_UNREACHABLE_SECONDS,
      backupRetentionDays: v.RUNTIME_CONTROL_BACKUP_RETENTION_DAYS,
    },
    operatorUserIds: operators,
    ...(v.AW_WORKER_MODEL_PROFILES_PATH || v.AW_WORKER_MODEL_PROFILES_SHA256 ? {
      workerModelProfiles: loadWorkerModelProfiles(v.AW_WORKER_MODEL_PROFILES_PATH, v.AW_WORKER_MODEL_PROFILES_SHA256?.toLowerCase()),
    } : {}),
    ...(v.AW_READ_ONLY_MODEL_PROFILES_PATH || v.AW_READ_ONLY_MODEL_PROFILES_SHA256 ? {
      readOnlyModelProfiles: loadReadOnlyModelProfiles(v.AW_READ_ONLY_MODEL_PROFILES_PATH, v.AW_READ_ONLY_MODEL_PROFILES_SHA256?.toLowerCase()),
    } : {}),
    deployment: {
      imageDigest: v.AW_DEPLOYMENT_IMAGE_DIGEST,
      sourceSha: v.AW_DEPLOYMENT_SOURCE_SHA,
    },
  };
}
