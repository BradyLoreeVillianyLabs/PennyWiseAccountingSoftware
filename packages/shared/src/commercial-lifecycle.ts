export const commercialStatuses = [
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
  "GRACE",
  "CANCELLED",
  "ENDED"
] as const;

export type CommercialStatus = (typeof commercialStatuses)[number];

const commercialTransitions: Readonly<Record<CommercialStatus, readonly CommercialStatus[]>> = {
  TRIALING: ["TRIALING", "ACTIVE", "CANCELLED", "ENDED"],
  ACTIVE: ["ACTIVE", "PAST_DUE", "CANCELLED", "ENDED"],
  PAST_DUE: ["PAST_DUE", "GRACE", "ACTIVE", "CANCELLED", "ENDED"],
  GRACE: ["GRACE", "ACTIVE", "CANCELLED", "ENDED"],
  CANCELLED: ["CANCELLED", "ENDED"],
  ENDED: ["ENDED"]
};

export function canTransitionCommercialStatus(
  current: CommercialStatus,
  next: CommercialStatus
): boolean {
  return commercialTransitions[current].includes(next);
}

export function assertCommercialTransition(
  current: CommercialStatus,
  next: CommercialStatus
): void {
  if (!canTransitionCommercialStatus(current, next))
    throw new Error(`Commercial status cannot move from ${current} to ${next}.`);
}

export function entitlementsFor(
  status: CommercialStatus,
  planEntitlements: readonly string[]
): readonly string[] {
  return status === "ACTIVE" || status === "TRIALING" ? [...new Set(planEntitlements)] : [];
}
