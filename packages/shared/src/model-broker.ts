import { z } from "zod";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
/** An operator-qualified price ceiling, never provider/worker output. Exact
 * tariff, currency, model and expiry are part of each immutable quote. */
export const modelTariffCeilingSchema = z
  .object({
    provider: z.enum(["openai", "anthropic", "openrouter"]),
    model: z.string().regex(/^[a-zA-Z0-9_./:-]{1,200}$/),
    currency: z.literal("USD"),
    inputMinorPerMillion: z.number().int().min(0).max(1_000_000_000),
    outputMinorPerMillion: z.number().int().min(0).max(1_000_000_000),
    fixedMinor: z.number().int().min(0).max(1_000_000),
    qualificationHash: hash,
    sourceSha: z.string().regex(/^[a-f0-9]{40}$/),
    testedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  })
  .strict();
export const modelReservationQuoteSchema = z
  .object({
    version: z.literal(1),
    provider: z.enum(["openai", "anthropic", "openrouter"]),
    model: z.string().regex(/^[a-zA-Z0-9_./:-]{1,200}$/),
    currency: z.literal("USD"),
    inputTokensUpperBound: z.number().int().min(1).max(2_000_000),
    maxOutputTokens: z.number().int().min(1).max(65_536),
    maximumMinor: z.number().int().min(0).max(1_000_000),
    tariffHash: hash,
    qualificationHash: hash,
    sourceSha: z.string().regex(/^[a-f0-9]{40}$/),
    expiresAt: z.iso.datetime(),
  })
  .strict();
export type ModelTariffCeiling = z.infer<typeof modelTariffCeilingSchema>;
export type ModelReservationQuote = z.infer<typeof modelReservationQuoteSchema>;
