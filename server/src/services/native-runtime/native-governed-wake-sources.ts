import { isDeepStrictEqual } from "node:util";
import type { NativePayloadSourceInput } from "@paperclipai/shared";
import { nativeSha256 } from "./canonical.js";
import type { NativeGovernedInteractionContinuationCapture } from "./native-interaction-bridge.js";
import type { NativeToolActionDeliveryCapture } from "../tool-action-delivery.js";

type InteractionSource = Extract<NativePayloadSourceInput, { kind: "interaction" }>;

/**
 * APR-E2E-15. A declined tool-action card is never a Human review withdrawal:
 * its owner is the governed decision that the wake's exact continuation has
 * already materialized and verified. Return the outcome ids that are owned by
 * exactly one rejected governed capture for that card, with the same rejected
 * outcome and both of its renditions present in the sealed bootstrap and in the
 * current inputs. Everything else stays with the withdrawal owner check.
 */
export function nativeGovernedDeclineOutcomeIds(input: {
  outcomes: readonly unknown[];
  governedInteractions: readonly NativeGovernedInteractionContinuationCapture[];
  bootstrapInputs: readonly NativePayloadSourceInput[];
  inputs: readonly NativePayloadSourceInput[];
}): Set<string> {
  const record = (value: unknown) => value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const ids = input.outcomes.map(value => record(value).id).filter((id): id is string => typeof id === "string");
  return new Set(ids.filter(id => {
    const matches = input.governedInteractions.filter(value => value.projection.interactionId === id);
    const outcome = input.outcomes.filter(value => record(value).id === id);
    if (matches.length !== 1 || outcome.length !== 1) return false;
    const [governed] = matches;
    return governed!.projection.interactionOutcome.status === "rejected" &&
      governed!.projection.owner.requestStatus === "rejected" &&
      governed!.nativeSource.interactionId === id && governed!.continuationSource.interactionId === id &&
      nativeSha256(governed!.projection.interactionOutcome) === nativeSha256(outcome[0]) &&
      [governed!.nativeSource, governed!.continuationSource].every(expected =>
        input.bootstrapInputs.some(source => isDeepStrictEqual(source, expected)) &&
        input.inputs.some(source => isDeepStrictEqual(source, expected)));
  }));
}

/**
 * APR-E2E-15. Historical interaction renditions owned by the wake's verified
 * governed decisions: each decision's continuation rendition, and the delivery
 * rendition only when it is for one of those decisions at the same source
 * version. The decision's Native rendition is never returned here; it stays a
 * direct interaction response.
 */
export function nativeGovernedWakeHistoricalSources(input: {
  governedInteractions: readonly NativeGovernedInteractionContinuationCapture[];
  delivery: NativeToolActionDeliveryCapture | undefined;
}): InteractionSource[] {
  const delivery = input.delivery;
  const deliveryOwned = Boolean(delivery && input.governedInteractions.some(value =>
    value.projection.interactionId === delivery.projection.interactionId &&
    value.continuationSource.interactionId === delivery.source.interactionId &&
    value.continuationSource.issueId === delivery.source.issueId &&
    value.continuationSource.sourceVersion === delivery.source.sourceVersion));
  return [...input.governedInteractions.map(value => value.continuationSource),
    ...(delivery && deliveryOwned ? [delivery.source] : [])];
}
