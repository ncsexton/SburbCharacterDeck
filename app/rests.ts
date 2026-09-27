import type { CharacterData } from "./types";

export type RestKind = "Short Rest" | "Long Rest";

export interface RestPreview {
  kind: RestKind;
  healthBefore: number;
  healthAfter: number;
  pluckBefore: number;
  pluckAfter: number;
  temporaryHealthBefore: number;
  temporaryHealthAfter: number;
  doomMarksBefore: number;
  doomMarksAfter: number;
  shortRestsBefore: number;
  shortRestsAfter: number;
  maximumShortRests: number;
  overrideRequired: boolean;
  removedStatuses: string[];
  retainedStatuses: string[];
  refreshedEntries: string[];
}

export interface RestResult {
  character: CharacterData;
  preview: RestPreview;
}

function cloneCharacter(character: CharacterData): CharacterData {
  return JSON.parse(JSON.stringify(character)) as CharacterData;
}

function recoversOn(recoveryType: string | undefined, kind: RestKind) {
  const normalized = recoveryType?.trim().toLowerCase();
  if (kind === "Short Rest") return normalized === "short rest";
  return normalized === "short rest" || normalized === "long rest";
}

export function prepareRest(
  character: CharacterData,
  kind: RestKind,
  maximumHealth: number,
  maximumPluck: number,
): RestResult {
  const next = cloneCharacter(character);
  const isShortRest = kind === "Short Rest";
  const refreshedEntries = new Set<string>();

  const healthBefore = character.resources.currentHealth;
  const pluckBefore = character.resources.currentPluck;
  const temporaryHealthBefore = character.resources.temporaryHealth;
  const doomMarksBefore = character.resources.doomMarks;
  const shortRestsBefore = Math.max(
    0,
    character.resources.maximumShortRests - character.resources.shortRestsUsed,
  );

  if (isShortRest) {
    const missingHealth = Math.max(0, maximumHealth - healthBefore);
    const missingPluck = Math.max(0, maximumPluck - pluckBefore);
    next.resources.currentHealth = Math.min(
      maximumHealth,
      healthBefore + Math.ceil(missingHealth / 2),
    );
    next.resources.currentPluck = Math.min(
      maximumPluck,
      pluckBefore + Math.ceil(missingPluck / 2),
    );
    next.resources.shortRestsUsed = Math.min(
      next.resources.maximumShortRests,
      next.resources.shortRestsUsed + 1,
    );
  } else {
    next.resources.currentHealth = maximumHealth;
    next.resources.currentPluck = maximumPluck;
    next.resources.doomMarks = 0;
    next.resources.shortRestsUsed = 0;
  }
  next.resources.temporaryHealth = 0;

  const removedStatuses = character.statuses
    .filter((status) =>
      isShortRest
        ? !status.persistsThroughShortRest
        : !status.persistsThroughLongRest,
    )
    .map((status) => status.statusName);
  const retainedStatuses = character.statuses
    .filter((status) =>
      isShortRest
        ? status.persistsThroughShortRest
        : status.persistsThroughLongRest,
    )
    .map((status) => status.statusName);
  next.statuses = next.statuses.filter((status) =>
    isShortRest
      ? status.persistsThroughShortRest
      : status.persistsThroughLongRest,
  );

  const refresh = (
    entry: {
      maximumCharges?: number;
      currentCharges?: number;
      recoveryType?: string;
      used?: boolean;
    },
    name: string,
  ) => {
    if (!recoversOn(entry.recoveryType, kind)) return;
    let changed = false;
    if (entry.maximumCharges !== undefined) {
      changed = entry.currentCharges !== entry.maximumCharges || changed;
      entry.currentCharges = entry.maximumCharges;
    }
    if (entry.used) {
      entry.used = false;
      changed = true;
    }
    if (changed) refreshedEntries.add(name);
  };

  for (const item of next.items) {
    if (recoversOn(item.recoveryType, kind)) {
      let changed = false;
      if (item.maximumCharges !== undefined) {
        changed = item.remainingCharges !== item.maximumCharges || changed;
        item.remainingCharges = item.maximumCharges;
      }
      if (item.used) {
        item.used = false;
        changed = true;
      }
      if (changed) refreshedEntries.add(item.name);
    }
    for (const affix of [...item.majorAffixes, ...item.minorAffixes]) {
      refresh(affix, `${item.name}: ${affix.name}`);
    }
    for (const move of item.weaponMoves ?? []) {
      refresh(move, `${item.name}: ${move.name}`);
    }
  }
  for (const entry of next.classpectEntries) {
    refresh(entry, entry.name);
  }

  return {
    character: next,
    preview: {
      kind,
      healthBefore,
      healthAfter: next.resources.currentHealth,
      pluckBefore,
      pluckAfter: next.resources.currentPluck,
      temporaryHealthBefore,
      temporaryHealthAfter: 0,
      doomMarksBefore,
      doomMarksAfter: next.resources.doomMarks,
      shortRestsBefore,
      shortRestsAfter: Math.max(
        0,
        next.resources.maximumShortRests - next.resources.shortRestsUsed,
      ),
      maximumShortRests: next.resources.maximumShortRests,
      overrideRequired: isShortRest && shortRestsBefore <= 0,
      removedStatuses,
      retainedStatuses,
      refreshedEntries: [...refreshedEntries],
    },
  };
}
