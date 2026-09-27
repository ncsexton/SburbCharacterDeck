export type BasicDamageType =
  | "Physical"
  | "Special"
  | "True"
  | "Unmitigated";

export type DamageProperty = "None" | "Piercing";

export const TOTAL_EXP_BY_LEVEL: Readonly<Record<number, number>> = {
  1: 0,
  2: 500,
  3: 2_100,
  4: 4_000,
  5: 7_000,
  6: 12_000,
  7: 18_500,
  8: 27_000,
  9: 37_500,
  10: 50_000,
  11: 63_000,
  12: 76_400,
  13: 90_300,
  14: 104_600,
  15: 119_400,
  16: 134_600,
  17: 150_300,
  18: 166_400,
  19: 183_000,
  20: 200_000,
};

export function getExpRequiredForNextLevel(level: number): number | null {
  const normalizedLevel = Math.max(1, Math.trunc(level));
  return TOTAL_EXP_BY_LEVEL[normalizedLevel + 1] ?? null;
}

export function getExpProgressForLevel(
  currentExp: number,
  level: number,
): number {
  const normalizedLevel = Math.max(1, Math.min(20, Math.trunc(level)));
  const levelStart = TOTAL_EXP_BY_LEVEL[normalizedLevel] ?? 0;
  const nextLevel = TOTAL_EXP_BY_LEVEL[normalizedLevel + 1];

  if (nextLevel === undefined) return 100;

  const expWithinLevel = currentExp - levelStart;
  const expNeededThisLevel = nextLevel - levelStart;
  return Math.max(
    0,
    Math.min(100, (expWithinLevel / expNeededThisLevel) * 100),
  );
}

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
