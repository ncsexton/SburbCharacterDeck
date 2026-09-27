export type PlayerSection = "character" | "equipment" | "classpect" | "strife";

export type StatCategory =
  | "Physical"
  | "Special"
  | "Instinctual"
  | "Mental";

export type ModifierType =
  | "standard"
  | "full-value"
  | "manual"
  | "informational";

export interface StatDefinition {
  id: string;
  name: string;
  compactName?: string;
  category: StatCategory;
  description: string;
  uses: string[];
  displayOrder: number;
}

export interface CharacterStat {
  definitionId: string;
  baseValue: number;
  otherPersistentBonus: number;
  temporaryModifier: number;
  penalty: number;
  growthFormula?: string;
  manualOverrideEnabled: boolean;
  manualTotalOverride?: number;
  manualModifierOverride?: number;
}

export interface CustomStat {
  id: string;
  name: string;
  description: string;
  value: number;
  bonus: number;
  modifierType: ModifierType;
  linkedStandardStat?: string;
  growthInfo?: string;
  notes?: string;
  displayOrder: number;
}

export interface StatBonus {
  statDefinitionId: string;
  amount: number;
}

export interface Affix {
  id: string;
  name: string;
  rank?: "Rank I" | "Rank II" | "Rank III" | "Rank IV" | "Rank V";
  shortSummary: string;
  rulesText: string;
  timing?: string;
  apCost?: number;
  healthCost?: number;
  pluckCost?: number;
  saveStat?: string;
  saveDC?: number;
  usageLimit?: string;
  maximumCharges?: number;
  currentCharges?: number;
  recoveryType?: string;
  displayOrder: number;
}

export interface WeaponMove {
  id: string;
  name: string;
  apCost: number;
  healthCost?: number;
  pluckCost?: number;
  hitChance: string;
  comboChance: string;
  damageText: string;
  damageType: string;
  targetText: string;
  rollText: string;
  onHitText?: string;
  onComboText?: string;
  onCritText?: string;
  saveStat?: string;
  saveDC?: number;
  durationText?: string;
  usageLimit?: string;
  maximumCharges?: number;
  currentCharges?: number;
  recoveryType?: string;
  effectText: string;
  displayOrder: number;
  used?: boolean;
}

export type ItemType =
  | "Weapon"
  | "Armor"
  | "Trinket"
  | "Badge"
  | "Consumable"
  | "Utility Item"
  | "Catalyst"
  | "Quest Item"
  | "Miscellaneous Item";

export interface Item {
  id: string;
  name: string;
  itemType: ItemType;
  slot?: string;
  weaponkind?: string;
  itemLevel?: number;
  rarity: string;
  quantity: number;
  shortDescription: string;
  fullDescription: string;
  equipped: boolean;
  consumable: boolean;
  apCost?: number;
  healthCost?: number;
  pluckCost?: number;
  healingAmount?: number;
  pluckRestorationAmount?: number;
  temporaryHealthAmount?: number;
  remainingCharges?: number;
  maximumCharges?: number;
  recoveryType?: string;
  notes?: string;
  statBonuses: StatBonus[];
  maximumHealthBonus?: number;
  maximumPluckBonus?: number;
  majorAffixes: Affix[];
  minorAffixes: Affix[];
  refinements?: string[];
  curses?: string[];
  specialRules?: string[];
  passiveEffects?: string[];
  weaponMoves?: WeaponMove[];
  icon?: string;
  used?: boolean;
}

export type ClasspectEntryType = "Class Skill" | "Aspect Ability";
export type ClasspectCategory =
  | "Active"
  | "Passive"
  | "Reaction"
  | "Augment"
  | "Transformation"
  | "Other";

export interface ClasspectEntry {
  id: string;
  entryType: ClasspectEntryType;
  category: ClasspectCategory;
  name: string;
  apCost?: number;
  pluckCost?: number;
  healthCost?: number;
  otherCost?: string;
  timing?: string;
  condition?: string;
  target?: string;
  roll?: string;
  saveStat?: string;
  saveDC?: number;
  effect: string;
  duration?: string;
  usageLimit?: string;
  maximumCharges?: number;
  currentCharges?: number;
  recoveryType?: string;
  shortSummary: string;
  fullDescription: string;
  unlocked: boolean;
  displayOrder: number;
  explorationCompatible: boolean;
  playerNotes?: string;
  used?: boolean;
}

export interface ActiveStatusNote {
  id: string;
  statusName: string;
  potency?: string;
  remainingDuration?: number;
  durationType?: string;
  saveStat?: string;
  saveDC?: number;
  source?: string;
  notes?: string;
  persistsThroughShortRest?: boolean;
  persistsThroughLongRest?: boolean;
}

export interface CharacterResources {
  currentHealth: number;
  baseMaximumHealth: number;
  healthGrowthFormula?: string;
  temporaryHealth: number;
  currentPluck: number;
  baseMaximumPluck: number;
  pluckGrowthFormula?: string;
  currentAP: number;
  doomMarks: number;
  surge: number;
  stagger: number;
  maximumShortRests: number;
  shortRestsUsed: number;
}

export interface CharacterIdentity {
  id: string;
  campaignId: string;
  ownerUserId: string;
  playerName: string;
  characterName: string;
  portraitInitials: string;
  level: number;
  currentExp: number;
  className: string;
  classDescription?: string;
  aspectName: string;
  aspectDescription?: string;
  landName: string;
  portraitUrl?: string;
  grist: number;
  boondollars: number;
  notes: string;
}

export interface CharacterData {
  schemaVersion: number;
  identity: CharacterIdentity;
  resources: CharacterResources;
  stats: CharacterStat[];
  customStats: CustomStat[];
  items: Item[];
  classpectEntries: ClasspectEntry[];
  statuses: ActiveStatusNote[];
  turnNotes: string;
  guardState: "None" | "Defend" | "Dodge";
}

export interface ResourceChangeHistory {
  id: string;
  timestamp: string;
  label: string;
  resourceType: string;
  operationType: string;
  sourceName?: string;
  previousValue?: number;
  changeAmount?: number;
  newValue?: number;
  temporaryHealthBefore?: number;
  temporaryHealthAfter?: number;
  defenseUsed?: number;
  damageType?: string;
  reverted: boolean;
}

export interface UndoRecord {
  id: string;
  label: string;
  historyId: string;
  previousCharacter: CharacterData;
}

export interface PersistedPrototype {
  schemaVersion: number;
  character: CharacterData;
  history: ResourceChangeHistory[];
  undoStack: UndoRecord[];
  selectedSection: PlayerSection;
}
