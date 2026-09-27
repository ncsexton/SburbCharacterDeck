import type { CharacterData } from "./types";

export interface LevelUpGrowth {
  health: number;
  pluck: number;
  standardStats: Record<string, number>;
  customStats: Record<string, number>;
}

export function applyLevelUp(
  character: CharacterData,
  growth: LevelUpGrowth,
): CharacterData {
  const next = structuredClone(character);
  if (next.identity.level >= 20) return next;

  next.identity.level += 1;
  next.resources.baseMaximumHealth += growth.health;
  next.resources.baseMaximumPluck += growth.pluck;
  next.stats = next.stats.map((stat) => ({
    ...stat,
    baseValue: stat.baseValue + (growth.standardStats[stat.definitionId] ?? 0),
  }));
  next.customStats = next.customStats.map((stat) => ({
    ...stat,
    value: stat.value + (growth.customStats[stat.id] ?? 0),
  }));

  return next;
}
