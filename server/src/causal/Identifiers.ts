/** Minimal causal identifiers retained by the Stage-1 consumer trace. */
export type CausalRecordId = string & { readonly __brand: "CausalRecordId" };
export type CommitmentId = string & { readonly __brand: "CommitmentId" };
export type TransitionId = CausalRecordId & { readonly __transitionBrand: "TransitionId" };
export type ActionId = string & { readonly __brand: "ActionId" };
export type ReceiptId = string & { readonly __brand: "ReceiptId" };
export type ActorRef = string & { readonly __brand: "ActorRef" };
export type EvidenceRef = string & { readonly __brand: "EvidenceRef" };
export type OpaqueCapabilityRef = string & { readonly __brand: "OpaqueCapabilityRef" };
export type RecordVersion = number & { readonly __brand: "RecordVersion" };

/** RecordVersion is causal state, not a persisted-schema version. */
export function recordVersion(value: number): RecordVersion {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("RecordVersion must be a non-negative safe integer");
  }
  return value as RecordVersion;
}
