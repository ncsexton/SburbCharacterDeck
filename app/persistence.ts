import { SCHEMA_VERSION } from "./seed.ts";
import type {
  CharacterData,
  PersistedPrototype,
  PlayerSection,
  ResourceChangeHistory,
  UndoRecord,
} from "./types";

const playerSections: PlayerSection[] = [
  "character",
  "equipment",
  "classpect",
  "strife",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function migrateCharacter(input: unknown): CharacterData | null {
  if (!isRecord(input) || !isRecord(input.identity)) return null;
  if (
    !isRecord(input.resources) ||
    !Array.isArray(input.stats) ||
    !Array.isArray(input.customStats) ||
    !Array.isArray(input.items) ||
    !Array.isArray(input.classpectEntries) ||
    !Array.isArray(input.statuses)
  ) {
    return null;
  }

  const version = Number(input.schemaVersion);
  if (version !== 1 && version !== SCHEMA_VERSION) return null;

  const migrated = structuredClone(input) as unknown as CharacterData;
  migrated.schemaVersion = SCHEMA_VERSION;
  migrated.identity.classDescription ??=
    "Player-authored Class Skill reference.";
  migrated.identity.aspectDescription ??=
    "Player-authored Aspect Ability reference.";
  delete (
    migrated.identity as typeof migrated.identity & {
      expRequiredForNextLevel?: number;
    }
  ).expRequiredForNextLevel;
  delete (
    migrated.identity as typeof migrated.identity & {
      skillPoints?: number;
    }
  ).skillPoints;
  migrated.identity.level = Math.max(
    1,
    Math.min(20, Math.trunc(migrated.identity.level || 1)),
  );
  migrated.resources.maximumShortRests ??= 2;
  migrated.resources.maximumShortRests = Math.max(
    0,
    Math.trunc(migrated.resources.maximumShortRests),
  );
  migrated.resources.shortRestsUsed = Math.max(
    0,
    Math.min(
      migrated.resources.maximumShortRests,
      Math.trunc(migrated.resources.shortRestsUsed ?? 0),
    ),
  );

  return migrated;
}

export function migratePersistedPrototype(
  input: unknown,
): PersistedPrototype | null {
  if (!isRecord(input)) return null;
  const character = migrateCharacter(input.character);
  if (!character) return null;

  const selectedSection = playerSections.includes(
    input.selectedSection as PlayerSection,
  )
    ? (input.selectedSection as PlayerSection)
    : "character";
  const undoStack = Array.isArray(input.undoStack)
    ? input.undoStack.flatMap((record) => {
        if (!isRecord(record)) return [];
        const previousCharacter = migrateCharacter(record.previousCharacter);
        if (!previousCharacter) return [];
        return [
          {
            ...(record as unknown as UndoRecord),
            previousCharacter,
          },
        ];
      })
    : [];

  return {
    schemaVersion: SCHEMA_VERSION,
    character,
    history: Array.isArray(input.history)
      ? (input.history as ResourceChangeHistory[])
      : [],
    undoStack,
    selectedSection,
  };
}

export function migrateCharacterBackup(input: unknown): {
  character: CharacterData;
  history: ResourceChangeHistory[];
} | null {
  if (!isRecord(input)) return null;
  const character = migrateCharacter(input.character);
  if (!character) return null;

  return {
    character,
    history: Array.isArray(input.resourceHistory)
      ? (input.resourceHistory as ResourceChangeHistory[])
      : [],
  };
}
