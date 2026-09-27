import type { ItemRarity } from "./types";

export const ITEM_RARITIES: readonly ItemRarity[] = [
  "Common",
  "Uncommon",
  "Rare",
  "Legendary",
  "Mythic",
  "Exotic",
];

export const ITEM_RARITY_RANK: Readonly<Record<ItemRarity, number>> = {
  Common: 0,
  Uncommon: 1,
  Rare: 2,
  Legendary: 3,
  Mythic: 4,
  Exotic: 5,
};

export function normalizeItemRarity(value: unknown): ItemRarity {
  if (value === "Exceptional") return "Legendary";
  if (value === "Fabled") return "Exotic";
  if (ITEM_RARITIES.includes(value as ItemRarity)) return value as ItemRarity;
  return "Common";
}

export function legacyRarityTag(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || ITEM_RARITIES.includes(normalized as ItemRarity)) return null;
  if (normalized === "Exceptional" || normalized === "Fabled") return null;
  return normalized;
}

export function normalizeItemTags(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
}
