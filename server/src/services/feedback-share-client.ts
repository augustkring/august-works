import { gzipSync } from "node:zlib";
import type { FeedbackTraceBundle } from "@paperclipai/shared";
import type { Config } from "../config.js";

function buildFeedbackShareObjectKey(bundle: FeedbackTraceBundle, exportedAt: Date) {
  const year = String(exportedAt.getUTCFullYear());
  const month = String(exportedAt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(exportedAt.getUTCDate()).padStart(2, "0");
  return `feedback-traces/${bundle.companyId}/${year}/${month}/${day}/${bundle.exportId ?? bundle.traceId}.json`;
}

export interface FeedbackTraceShareClient {
  uploadTraceBundle(bundle: FeedbackTraceBundle): Promise<{ objectKey: string }>;
}

export function createFeedbackTraceShareClientFromConfig(
  config: Pick<Config, "feedbackExportBackendUrl" | "feedbackExportBackendToken">,
): FeedbackTraceShareClient {
  const baseUrl = config.feedbackExportBackendUrl?.trim();
  const token = config.feedbackExportBackendToken?.trim();
  let endpoint: string | null = null;
  if (baseUrl) {
    try {
      const destination = new URL(baseUrl);
      if (!["http:", "https:"].includes(destination.protocol) || destination.username ||
        destination.password || destination.search || destination.hash) throw new Error();
      endpoint = new URL("/feedback-traces", destination).toString();
    } catch {
      throw new Error("Invalid feedback export destination");
    }
  }

  return {
    async uploadTraceBundle(bundle) {
      if (!endpoint) throw new Error("Feedback export is not configured");
      const exportedAt = new Date();
      const objectKey = buildFeedbackShareObjectKey(bundle, exportedAt);
      const requestBody = JSON.stringify({
        objectKey,
        exportedAt: exportedAt.toISOString(),
        bundle,
      });
      const response = await fetch(endpoint, {
        method: "POST",
        redirect: "error",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          encoding: "gzip+base64+json",
          payload: gzipSync(requestBody).toString("base64"),
        }),
      });

      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new Error(`Feedback trace upload failed with HTTP ${response.status}`);
      }

      const payload = await response.json().catch(() => null) as { objectKey?: unknown } | null;
      return {
        objectKey: typeof payload?.objectKey === "string" && payload.objectKey.trim().length > 0
          ? payload.objectKey
          : objectKey,
      };
    },
  };
}
