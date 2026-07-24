export type BasicDamageType =
  | "Physical"
  | "Special"
  | "True"
  | "Unmitigated";

export type DamageProperty = "None" | "Piercing";

export interface DamagePreviewInput {
  incomingDamage: number;
  damageType: BasicDamageType;
  damageProperty: DamageProperty;
  gelViscosityModifier: number;
  moxieMufflingModifier: number;
  manualDefenseOverride?: number;
  currentHealth: number;
  temporaryHealth: number;
}

export interface DamagePreviewResult {
  incoming: number;
  baseDefense: number;
  defenseUsed: number;
  finalDamage: number;
  temporaryHealthUsed: number;
  healthLost: number;
  resultingTemporaryHealth: number;
  resultingHealth: number;
  manualOverrideUsed: boolean;
}

export function previewIncomingDamage({
  incomingDamage,
  damageType,
  damageProperty,
  gelViscosityModifier,
  moxieMufflingModifier,
  manualDefenseOverride,
  currentHealth,
  temporaryHealth,
}: DamagePreviewInput): DamagePreviewResult {
  const incoming = Math.max(0, incomingDamage);
  const baseDefense =
    damageType === "Physical"
      ? gelViscosityModifier
      : damageType === "Special"
        ? moxieMufflingModifier
        : 0;
  const propertyDefense =
    damageProperty === "Piercing" && baseDefense > 0
      ? Math.ceil(baseDefense / 2)
      : baseDefense;
  const ignoresOrdinaryDefense =
    damageType === "True" || damageType === "Unmitigated";
  const manualOverrideUsed =
    manualDefenseOverride !== undefined && !ignoresOrdinaryDefense;
  const defenseUsed = ignoresOrdinaryDefense
    ? 0
    : manualOverrideUsed
      ? manualDefenseOverride
      : propertyDefense;
  const finalDamage = Math.max(0, incoming - defenseUsed);
  const temporaryHealthUsed = Math.min(
    Math.max(0, temporaryHealth),
    finalDamage,
  );
  const healthLost = finalDamage - temporaryHealthUsed;

  return {
    incoming,
    baseDefense,
    defenseUsed,
    finalDamage,
    temporaryHealthUsed,
    healthLost,
    resultingTemporaryHealth: temporaryHealth - temporaryHealthUsed,
    resultingHealth: currentHealth - healthLost,
    manualOverrideUsed,
  };
}
