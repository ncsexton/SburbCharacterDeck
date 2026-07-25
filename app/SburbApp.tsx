"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  CharacterEditor,
  ClasspectEditor,
  ItemEditor,
  createBlankClasspectEntry,
  createBlankItem,
  duplicateClasspectEntry,
  duplicateItem,
  type ClasspectEditorState,
  type ItemEditorState,
} from "./PlayerEditors";
import {
  migrateCharacterBackup,
  migratePersistedPrototype,
} from "./persistence";
import { SCHEMA_VERSION, seedCharacter, statDefinitions } from "./seed";
import { previewIncomingDamage } from "./rules";
import type {
  ActiveStatusNote,
  CharacterData,
  ClasspectCategory,
  ClasspectEntry,
  Item,
  PersistedPrototype,
  PlayerSection,
  ResourceChangeHistory,
  StatCategory,
  UndoRecord,
  WeaponMove,
} from "./types";

const STORAGE_KEY = "sburb-character-manager:v1";
const MAX_HISTORY = 100;
const MAX_UNDO = 20;

const navItems: Array<{
  id: PlayerSection;
  label: string;
  short: string;
}> = [
  { id: "character", label: "Character", short: "CH" },
  { id: "equipment", label: "Inventory", short: "IN" },
  { id: "classpect", label: "Classpect", short: "CP" },
  { id: "strife", label: "Strife", short: "ST" },
];

const categoryOrder: StatCategory[] = [
  "Physical",
  "Special",
  "Instinctual",
  "Mental",
];

const classpectCategories: Array<"All" | ClasspectCategory> = [
  "All",
  "Active",
  "Passive",
  "Reaction",
  "Augment",
  "Transformation",
  "Other",
];

const inventoryEquipmentFilters = [
  "Equipped",
  "Weapons",
  "Armor",
  "Trinkets",
  "Badges",
] as const;

const inventoryItemFilters = [
  "All Items",
  "Consumables",
  "Utility",
  "Catalysts",
  "Quest Items",
  "Miscellaneous",
] as const;

const statusSuggestions = [
  "Burn",
  "Poison",
  "Bleed",
  "Paralysis",
  "Stagger",
  "Freeze",
  "Sleep",
  "Blind",
  "Weakness",
  "Silence",
  "Dread",
  "Confuse",
  "Charm",
  "Berserk",
  "Sapped",
  "Stasis",
];

type AdjustmentKind =
  | "health-loss"
  | "hp-cost"
  | "heal"
  | "set-health"
  | "temp-gain"
  | "temp-remove"
  | "set-temp"
  | "pluck-cost"
  | "pluck-loss"
  | "pluck-restore"
  | "set-pluck";

interface AdjustmentRequest {
  kind: AdjustmentKind;
  amount: number;
  source?: string;
}

interface CostRequest {
  source: string;
  healthCost: number;
  pluckCost: number;
}

interface ConfirmRequest {
  title: string;
  description: string;
  confirmLabel: string;
  action: () => void;
}

interface StatOverrideRequest {
  statId: string;
  enabled: boolean;
  total: number;
  modifier: number;
}

interface StatusDraft {
  statusName: string;
  potency: string;
  remainingDuration: string;
  durationType: string;
  saveStat: string;
  saveDC: string;
  source: string;
  notes: string;
}

const emptyStatusDraft: StatusDraft = {
  statusName: "Burn",
  potency: "",
  remainingDuration: "",
  durationType: "turns",
  saveStat: "",
  saveDC: "",
  source: "",
  notes: "",
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatModifier(value: number) {
  return value >= 0 ? `+${value}` : String(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function getEquipmentBonus(character: CharacterData, definitionId: string) {
  return character.items
    .filter((item) => item.equipped)
    .flatMap((item) => item.statBonuses)
    .filter((bonus) => bonus.statDefinitionId === definitionId)
    .reduce((sum, bonus) => sum + bonus.amount, 0);
}

function getStat(character: CharacterData, definitionId: string) {
  const stat = character.stats.find(
    (entry) => entry.definitionId === definitionId,
  );
  if (!stat) {
    return {
      base: 0,
      equipment: 0,
      other: 0,
      temporary: 0,
      penalty: 0,
      calculatedTotal: 0,
      total: 0,
      modifier: 0,
      overridden: false,
    };
  }

  const equipment = getEquipmentBonus(character, definitionId);
  const calculatedTotal =
    stat.baseValue +
    equipment +
    stat.otherPersistentBonus +
    stat.temporaryModifier -
    stat.penalty;
  const total =
    stat.manualOverrideEnabled && stat.manualTotalOverride !== undefined
      ? stat.manualTotalOverride
      : calculatedTotal;
  const modifier =
    stat.manualOverrideEnabled && stat.manualModifierOverride !== undefined
      ? stat.manualModifierOverride
      : Math.floor(total / 5);

  return {
    base: stat.baseValue,
    equipment,
    other: stat.otherPersistentBonus,
    temporary: stat.temporaryModifier,
    penalty: stat.penalty,
    calculatedTotal,
    total,
    modifier,
    overridden: stat.manualOverrideEnabled,
  };
}

function getMaximumHealth(character: CharacterData) {
  return (
    character.resources.baseMaximumHealth +
    character.items
      .filter((item) => item.equipped)
      .reduce((sum, item) => sum + (item.maximumHealthBonus ?? 0), 0)
  );
}

function getMaximumPluck(character: CharacterData) {
  return (
    character.resources.baseMaximumPluck +
    character.items
      .filter((item) => item.equipped)
      .reduce((sum, item) => sum + (item.maximumPluckBonus ?? 0), 0)
  );
}

function getMaximumAP(character: CharacterData) {
  const scamperway = getStat(character, "scamperway").total;
  return 1 + Math.floor(Math.max(0, scamperway) / 20);
}

function applyHealthRemoval(character: CharacterData, amount: number) {
  const normalized = Math.max(0, amount);
  const tempUsed = Math.min(character.resources.temporaryHealth, normalized);
  character.resources.temporaryHealth -= tempUsed;
  character.resources.currentHealth -= normalized - tempUsed;
  return tempUsed;
}

function costsLabel(entry: {
  apCost?: number;
  healthCost?: number;
  pluckCost?: number;
  otherCost?: string;
}) {
  const parts: string[] = [];
  if (entry.apCost !== undefined) parts.push(`${entry.apCost} AP`);
  if (entry.healthCost) parts.push(`${entry.healthCost} HP`);
  if (entry.pluckCost) parts.push(`${entry.pluckCost} Pluck`);
  if (entry.otherCost) parts.push(entry.otherCost);
  return parts.length ? parts.join(" · ") : "No listed cost";
}

function isStrifeItem(item: Item) {
  return (
    item.itemType === "Consumable" ||
    item.itemType === "Utility Item" ||
    item.apCost !== undefined ||
    item.healthCost !== undefined ||
    item.pluckCost !== undefined ||
    item.healingAmount !== undefined ||
    item.pluckRestorationAmount !== undefined ||
    item.temporaryHealthAmount !== undefined
  );
}

function ModalFrame({
  title,
  eyebrow,
  onClose,
  children,
}: {
  title: string;
  eyebrow?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        className="modal-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <header className="modal-header">
          <div>
            {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
            <h2 id="modal-title">{title}</h2>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function MeterCard({
  label,
  current,
  maximum,
  tone,
  amountLabel,
  onSubtract,
  onAdd,
  onSet,
}: {
  label: string;
  current: number;
  maximum?: number;
  tone: "health" | "temp" | "pluck";
  amountLabel: string;
  onSubtract: (amount: number) => void;
  onAdd: (amount: number) => void;
  onSet: () => void;
}) {
  const [amount, setAmount] = useState(1);
  const percentage =
    maximum && maximum > 0
      ? Math.max(0, Math.min(100, (current / maximum) * 100))
      : current > 0
        ? 100
        : 0;

  return (
    <article className={`meter-card meter-${tone}`}>
      <div className="meter-heading">
        <div>
          <p className="eyebrow">{label}</p>
          <p className="meter-value">
            {current}
            {maximum !== undefined ? (
              <span className="meter-maximum"> / {maximum}</span>
            ) : null}
          </p>
        </div>
        <button className="text-button" onClick={onSet}>
          Set exact
        </button>
      </div>
      <div
        className="meter-track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={maximum ?? Math.max(1, current)}
        aria-valuenow={current}
      >
        <span style={{ width: `${percentage}%` }} />
      </div>
      <div className="meter-adjuster">
        <label>
          <span className="sr-only">{amountLabel}</span>
          <input
            type="number"
            min={0}
            value={amount}
            onChange={(event) =>
              setAmount(Math.max(0, Number(event.target.value) || 0))
            }
          />
        </label>
        <button
          className="button button-muted"
          onClick={() => onSubtract(amount)}
          aria-label={`Subtract ${amount} from ${label}`}
        >
          − Apply
        </button>
        <button
          className="button button-muted"
          onClick={() => onAdd(amount)}
          aria-label={`Add ${amount} to ${label}`}
        >
          + Apply
        </button>
      </div>
    </article>
  );
}

function ResourceReadout({
  label,
  value,
  detail,
}: {
  label: string;
  value: number | string;
  detail?: string;
}) {
  return (
    <article className="resource-stepper resource-readout">
      <div>
        <p className="resource-label">{label}</p>
        <p className="resource-value">
          {value}
          {detail ? <span>{detail}</span> : null}
        </p>
      </div>
    </article>
  );
}

function StrifeCounter({
  label,
  value,
  detail,
  onChange,
}: {
  label: string;
  value: number;
  detail?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="strife-counter">
      <span>{label}</span>
      <div className="strife-counter-controls">
        <button
          onClick={() => onChange(value - 1)}
          aria-label={`Decrease ${label}`}
        >
          &minus;
        </button>
        <strong>
          {value}
          {detail ? <small>{detail}</small> : null}
        </strong>
        <button
          onClick={() => onChange(value + 1)}
          aria-label={`Increase ${label}`}
        >
          +
        </button>
      </div>
    </div>
  );
}

function DoomMarks({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <article className="resource-stepper doom-card">
      <div>
        <p className="resource-label">Doom Marks</p>
        <p className="resource-caption">Manual tracking only</p>
      </div>
      <div className="doom-marks" aria-label={`${value} of 3 Doom Marks`}>
        {[1, 2, 3].map((mark) => (
          <button
            key={mark}
            className={mark <= value ? "active" : ""}
            onClick={() => onChange(mark === value ? mark - 1 : mark)}
            aria-label={`Set Doom Marks to ${mark === value ? mark - 1 : mark}`}
            aria-pressed={mark <= value}
          >
            {mark <= value ? "◆" : "◇"}
          </button>
        ))}
      </div>
    </article>
  );
}

function StatSection({
  category,
  character,
  onOverride,
}: {
  category: StatCategory;
  character: CharacterData;
  onOverride: (statId: string) => void;
}) {
  const definitions = statDefinitions
    .filter((definition) => definition.category === category)
    .sort((a, b) => a.displayOrder - b.displayOrder);

  return (
    <details className="stat-category" open>
      <summary>
        <span>{category} Stats</span>
        <span className="summary-hint">Name · Total · Mod</span>
      </summary>
      <div className="stat-list">
        {definitions.map((definition) => {
          const values = getStat(character, definition.id);
          const stat = character.stats.find(
            (entry) => entry.definitionId === definition.id,
          );
          return (
            <details className="stat-row" key={definition.id}>
              <summary>
                <span className="stat-name">{definition.name}</span>
                <span className="stat-total">{values.total}</span>
                <span className="stat-mod">
                  {formatModifier(values.modifier)}
                </span>
              </summary>
              <div className="stat-detail">
                <p>{definition.description}</p>
                <p className="muted-copy">{definition.uses.join(" · ")}</p>
                <dl className="breakdown-grid">
                  <div>
                    <dt>Base Stat</dt>
                    <dd>{values.base}</dd>
                  </div>
                  <div>
                    <dt>Equipment Bonus</dt>
                    <dd>{formatModifier(values.equipment)}</dd>
                  </div>
                  <div>
                    <dt>Other Persistent</dt>
                    <dd>{formatModifier(values.other)}</dd>
                  </div>
                  <div>
                    <dt>Temporary Modifier</dt>
                    <dd>{formatModifier(values.temporary)}</dd>
                  </div>
                  <div>
                    <dt>Penalties</dt>
                    <dd>{values.penalty ? `−${values.penalty}` : "0"}</dd>
                  </div>
                  <div>
                    <dt>Calculated Total</dt>
                    <dd>{values.calculatedTotal}</dd>
                  </div>
                  <div>
                    <dt>Total Stat</dt>
                    <dd>{values.total}</dd>
                  </div>
                  <div>
                    <dt>Stat Modifier</dt>
                    <dd>{formatModifier(values.modifier)}</dd>
                  </div>
                  <div>
                    <dt>Growth</dt>
                    <dd>{stat?.growthFormula ?? "—"}</dd>
                  </div>
                </dl>
                {values.overridden ? (
                  <p className="override-notice">
                    Manual override active. Calculated values remain visible above.
                  </p>
                ) : null}
                <button
                  className="button button-quiet"
                  onClick={() => onOverride(definition.id)}
                >
                  Manual override
                </button>
              </div>
            </details>
          );
        })}
      </div>
    </details>
  );
}

function AffixBlock({
  title,
  affixes,
}: {
  title: string;
  affixes: Item["majorAffixes"];
}) {
  if (!affixes.length) return null;
  return (
    <section className="item-subsection">
      <h4>{title}</h4>
      <div className="affix-list">
        {affixes.map((affix) => (
          <article className="affix-card" key={affix.id}>
            <div className="affix-heading">
              <strong>{affix.name}</strong>
              {affix.rank ? <span className="tag">{affix.rank}</span> : null}
            </div>
            <p>{affix.shortSummary}</p>
            <p className="muted-copy">{affix.rulesText}</p>
            <div className="tag-row">
              {affix.timing ? <span className="tag">{affix.timing}</span> : null}
              {affix.apCost ? <span className="tag">{affix.apCost} AP</span> : null}
              {affix.healthCost ? (
                <span className="tag cost-health">{affix.healthCost} HP</span>
              ) : null}
              {affix.pluckCost ? (
                <span className="tag cost-pluck">{affix.pluckCost} Pluck</span>
              ) : null}
              {affix.usageLimit ? (
                <span className="tag">{affix.usageLimit}</span>
              ) : null}
              {affix.maximumCharges !== undefined ? (
                <span className="tag">
                  {affix.currentCharges ?? 0}/{affix.maximumCharges} charges
                </span>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function MoveCard({
  move,
  onApplyCost,
  onSpendCharge,
  onMarkUsed,
  compact = false,
}: {
  move: WeaponMove;
  onApplyCost: () => void;
  onSpendCharge: () => void;
  onMarkUsed: () => void;
  compact?: boolean;
}) {
  return (
    <details className={`move-card ${compact ? "compact" : ""}`}>
      <summary>
        <div>
          <span className="move-cost">{costsLabel(move)}</span>
          <strong>{move.name}</strong>
          <span className="move-summary">
            {move.hitChance} · {move.comboChance} · {move.damageText}
          </span>
        </div>
        <span className="expand-mark">+</span>
      </summary>
      <div className="move-detail">
        <div className="tag-row">
          <span className="tag">{move.damageType}</span>
          <span className="tag">{move.targetText}</span>
          {move.usageLimit ? <span className="tag">{move.usageLimit}</span> : null}
          {move.maximumCharges !== undefined ? (
            <span className="tag">
              {move.currentCharges ?? 0}/{move.maximumCharges} charges
            </span>
          ) : null}
          {move.used ? <span className="tag tag-spent">Marked spent</span> : null}
        </div>
        <p>{move.effectText}</p>
        <dl className="rules-list">
          <div>
            <dt>Roll</dt>
            <dd>{move.rollText}</dd>
          </div>
          {move.onHitText ? (
            <div>
              <dt>On Hit</dt>
              <dd>{move.onHitText}</dd>
            </div>
          ) : null}
          {move.onComboText ? (
            <div>
              <dt>On Combo</dt>
              <dd>{move.onComboText}</dd>
            </div>
          ) : null}
          {move.onCritText ? (
            <div>
              <dt>On Crit</dt>
              <dd>{move.onCritText}</dd>
            </div>
          ) : null}
        </dl>
        <div className="action-row">
          {move.healthCost || move.pluckCost ? (
            <button className="button button-primary" onClick={onApplyCost}>
              Apply HP / Pluck cost
            </button>
          ) : null}
          {move.maximumCharges !== undefined ? (
            <button className="button button-muted" onClick={onSpendCharge}>
              Spend charge
            </button>
          ) : null}
          {move.usageLimit ? (
            <button className="button button-muted" onClick={onMarkUsed}>
              {move.used ? "Mark available" : "Mark use spent"}
            </button>
          ) : null}
        </div>
        <p className="automation-note">
          Reference only — no AP, roll, target, damage, or effect is resolved.
        </p>
      </div>
    </details>
  );
}

function ItemCard({
  item,
  onToggleEquip,
  onQuantityChange,
  onSpendCharge,
  onUse,
  onMoveCost,
  onMoveCharge,
  onMoveUsed,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  item: Item;
  onToggleEquip: () => void;
  onQuantityChange: (next: number) => void;
  onSpendCharge: () => void;
  onUse: () => void;
  onMoveCost: (move: WeaponMove) => void;
  onMoveCharge: (move: WeaponMove) => void;
  onMoveUsed: (move: WeaponMove) => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const canApplySimpleOperation =
    item.healthCost !== undefined ||
    item.pluckCost !== undefined ||
    item.healingAmount !== undefined ||
    item.pluckRestorationAmount !== undefined ||
    item.temporaryHealthAmount !== undefined ||
    item.consumable ||
    item.remainingCharges !== undefined;

  return (
    <details className="item-card">
      <summary>
        <span className="item-icon" aria-hidden="true">
          {item.icon ?? "IT"}
        </span>
        <span className="item-main">
          <span className="item-kicker">
            {item.itemType}
            {item.itemLevel ? ` · IL ${item.itemLevel}` : ""}
          </span>
          <strong>{item.name}</strong>
          <span className="item-summary">{item.shortDescription}</span>
        </span>
        <span className="item-meta">
          <span className={`rarity rarity-${item.rarity.toLowerCase()}`}>
            {item.rarity}
          </span>
          <span>×{item.quantity}</span>
          {item.equipped ? <span className="equipped-dot">Equipped</span> : null}
        </span>
      </summary>
      <div className="item-detail">
        <div className="tag-row">
          {item.slot ? <span className="tag">{item.slot}</span> : null}
          {item.weaponkind ? <span className="tag">{item.weaponkind}</span> : null}
          {item.apCost !== undefined ? (
            <span className="tag">{item.apCost} AP</span>
          ) : null}
          {item.healthCost ? (
            <span className="tag cost-health">{item.healthCost} HP</span>
          ) : null}
          {item.pluckCost ? (
            <span className="tag cost-pluck">{item.pluckCost} Pluck</span>
          ) : null}
          {item.remainingCharges !== undefined ? (
            <span className="tag">
              {item.remainingCharges}/{item.maximumCharges} charges
            </span>
          ) : null}
        </div>
        <p>{item.fullDescription}</p>

        {item.statBonuses.length ||
        item.maximumHealthBonus ||
        item.maximumPluckBonus ? (
          <section className="item-subsection">
            <h4>Persistent bonuses</h4>
            <div className="bonus-grid">
              {item.statBonuses.map((bonus, index) => {
                const definition = statDefinitions.find(
                  (stat) => stat.id === bonus.statDefinitionId,
                );
                return (
                  <span
                    className="bonus-pill"
                    key={`${bonus.statDefinitionId}-${index}`}
                  >
                    {definition?.name ?? bonus.statDefinitionId}{" "}
                    {formatModifier(bonus.amount)}
                  </span>
                );
              })}
              {item.maximumHealthBonus ? (
                <span className="bonus-pill">
                  Maximum Health +{item.maximumHealthBonus}
                </span>
              ) : null}
              {item.maximumPluckBonus ? (
                <span className="bonus-pill">
                  Maximum Pluck +{item.maximumPluckBonus}
                </span>
              ) : null}
            </div>
          </section>
        ) : null}

        <AffixBlock title="Major Affix" affixes={item.majorAffixes} />
        <AffixBlock title="Minor Affixes" affixes={item.minorAffixes} />

        {item.passiveEffects?.length ? (
          <section className="item-subsection">
            <h4>Passive effects</h4>
            <ul>
              {item.passiveEffects.map((effect) => (
                <li key={effect}>{effect}</li>
              ))}
            </ul>
          </section>
        ) : null}
        {item.refinements?.length ? (
          <section className="item-subsection">
            <h4>Refinements</h4>
            <ul>
              {item.refinements.map((refinement) => (
                <li key={refinement}>{refinement}</li>
              ))}
            </ul>
          </section>
        ) : null}
        {item.curses?.length ? (
          <section className="item-subsection curse-section">
            <h4>Curses</h4>
            <ul>
              {item.curses.map((curse) => (
                <li key={curse}>{curse}</li>
              ))}
            </ul>
          </section>
        ) : null}
        {item.specialRules?.length ? (
          <section className="item-subsection">
            <h4>Special rules</h4>
            <ul>
              {item.specialRules.map((rule) => (
                <li key={rule}>{rule}</li>
              ))}
            </ul>
          </section>
        ) : null}
        {item.weaponMoves?.length ? (
          <section className="item-subsection">
            <h4>Weapon Moves</h4>
            <div className="move-list">
              {item.weaponMoves
                .slice()
                .sort((a, b) => a.displayOrder - b.displayOrder)
                .map((move) => (
                  <MoveCard
                    key={move.id}
                    move={move}
                    onApplyCost={() => onMoveCost(move)}
                    onSpendCharge={() => onMoveCharge(move)}
                    onMarkUsed={() => onMoveUsed(move)}
                  />
                ))}
            </div>
          </section>
        ) : null}
        {item.notes ? (
          <section className="item-subsection">
            <h4>Personal notes</h4>
            <p>{item.notes}</p>
          </section>
        ) : null}

        <div className="item-controls">
          <button className="button button-muted" onClick={onToggleEquip}>
            {item.equipped ? "Unequip" : "Equip"}
          </button>
          <div className="quantity-control" aria-label={`${item.name} quantity`}>
            <button
              className="icon-button small"
              onClick={() => onQuantityChange(Math.max(0, item.quantity - 1))}
              aria-label={`Decrease ${item.name} quantity`}
            >
              −
            </button>
            <span>Qty {item.quantity}</span>
            <button
              className="icon-button small"
              onClick={() => onQuantityChange(item.quantity + 1)}
              aria-label={`Increase ${item.name} quantity`}
            >
              +
            </button>
          </div>
          {item.remainingCharges !== undefined ? (
            <button
              className="button button-muted"
              onClick={onSpendCharge}
              disabled={item.remainingCharges <= 0}
            >
              Spend charge
            </button>
          ) : null}
          {canApplySimpleOperation ? (
            <button className="button button-primary" onClick={onUse}>
              Preview listed changes
            </button>
          ) : null}
          <span className="control-spacer" />
          <button className="button button-muted" onClick={onEdit}>
            Edit
          </button>
          <button className="button button-quiet" onClick={onDuplicate}>
            Duplicate
          </button>
          <button className="button button-danger" onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>
    </details>
  );
}

function ClasspectCard({
  entry,
  onApplyCost,
  onSpendCharge,
  onMarkUsed,
  onEdit,
  onDuplicate,
  onDelete,
  onMove,
}: {
  entry: ClasspectEntry;
  onApplyCost: () => void;
  onSpendCharge: () => void;
  onMarkUsed: () => void;
  onEdit?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  onMove?: (direction: -1 | 1) => void;
}) {
  return (
    <details
      className={`classpect-card category-${entry.category.toLowerCase()}`}
    >
      <summary>
        <span className="classpect-type">{entry.category}</span>
        <span className="classpect-main">
          <strong>{entry.name}</strong>
          <span>{entry.shortSummary}</span>
        </span>
        <span className="classpect-cost">
          {costsLabel(entry)}
          {entry.maximumCharges !== undefined ? (
            <small>
              {entry.currentCharges ?? 0}/{entry.maximumCharges} uses
            </small>
          ) : null}
        </span>
      </summary>
      <div className="classpect-detail">
        <div className="tag-row">
          <span className="tag">{entry.entryType}</span>
          <span className="tag">
            {entry.explorationCompatible
              ? "Strife + exploration"
              : "Strife only"}
          </span>
          {entry.timing ? <span className="tag">{entry.timing}</span> : null}
          {entry.usageLimit ? <span className="tag">{entry.usageLimit}</span> : null}
          {entry.used ? <span className="tag tag-spent">Marked spent</span> : null}
          {!entry.unlocked ? <span className="tag tag-spent">Locked</span> : null}
        </div>
        <p>{entry.fullDescription}</p>
        <dl className="rules-list">
          {entry.condition ? (
            <div>
              <dt>Trigger</dt>
              <dd>{entry.condition}</dd>
            </div>
          ) : null}
          {entry.target ? (
            <div>
              <dt>Targets</dt>
              <dd>{entry.target}</dd>
            </div>
          ) : null}
          {entry.roll ? (
            <div>
              <dt>Required roll</dt>
              <dd>{entry.roll}</dd>
            </div>
          ) : null}
          {entry.saveStat || entry.saveDC !== undefined ? (
            <div>
              <dt>Saving Throw</dt>
              <dd>
                {entry.saveStat || "Manual"}
                {entry.saveDC !== undefined ? ` DC ${entry.saveDC}` : ""}
              </dd>
            </div>
          ) : null}
          <div>
            <dt>Effect</dt>
            <dd>{entry.effect}</dd>
          </div>
          {entry.duration ? (
            <div>
              <dt>Duration</dt>
              <dd>{entry.duration}</dd>
            </div>
          ) : null}
          {entry.recoveryType ? (
            <div>
              <dt>Recovery</dt>
              <dd>{entry.recoveryType}</dd>
            </div>
          ) : null}
        </dl>
        {entry.playerNotes ? (
          <p className="personal-note">{entry.playerNotes}</p>
        ) : null}
        <div className="action-row">
          {entry.healthCost || entry.pluckCost ? (
            <button className="button button-primary" onClick={onApplyCost}>
              Apply HP / Pluck cost
            </button>
          ) : null}
          {entry.maximumCharges !== undefined ? (
            <button
              className="button button-muted"
              onClick={onSpendCharge}
              disabled={(entry.currentCharges ?? 0) <= 0}
            >
              Spend charge
            </button>
          ) : null}
          {entry.usageLimit ? (
            <button className="button button-muted" onClick={onMarkUsed}>
              {entry.used ? "Mark available" : "Mark use spent"}
            </button>
          ) : null}
          {onEdit ? (
            <>
              <span className="control-spacer" />
              {onMove ? (
                <>
                  <button
                    className="button button-quiet"
                    onClick={() => onMove(-1)}
                  >
                    Move up
                  </button>
                  <button
                    className="button button-quiet"
                    onClick={() => onMove(1)}
                  >
                    Move down
                  </button>
                </>
              ) : null}
              <button className="button button-muted" onClick={onEdit}>
                Edit
              </button>
              {onDuplicate ? (
                <button className="button button-quiet" onClick={onDuplicate}>
                  Duplicate
                </button>
              ) : null}
              {onDelete ? (
                <button className="button button-danger" onClick={onDelete}>
                  Delete
                </button>
              ) : null}
            </>
          ) : null}
        </div>
        <p className="automation-note">
          Legality, AP, rolls, targets, timing, and effects remain manual.
        </p>
      </div>
    </details>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="section-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action ? <div>{action}</div> : null}
    </header>
  );
}

export default function SburbApp() {
  const [character, setCharacter] = useState<CharacterData>(() =>
    clone(seedCharacter),
  );
  const [selectedSection, setSelectedSection] =
    useState<PlayerSection>("character");
  const [history, setHistory] = useState<ResourceChangeHistory[]>([]);
  const [undoStack, setUndoStack] = useState<UndoRecord[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [toast, setToast] = useState("");

  const [adjustment, setAdjustment] = useState<AdjustmentRequest | null>(null);
  const [costRequest, setCostRequest] = useState<CostRequest | null>(null);
  const [damageOpen, setDamageOpen] = useState(false);
  const [damageAmount, setDamageAmount] = useState(15);
  const [damageType, setDamageType] = useState<
    "Physical" | "Special" | "True" | "Unmitigated"
  >("Physical");
  const [damageProperty, setDamageProperty] = useState<"None" | "Piercing">(
    "None",
  );
  const [manualDefense, setManualDefense] = useState(false);
  const [manualDefenseValue, setManualDefenseValue] = useState(0);
  const [itemUseId, setItemUseId] = useState<string | null>(null);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(
    null,
  );
  const [statOverride, setStatOverride] =
    useState<StatOverrideRequest | null>(null);
  const [statusDraft, setStatusDraft] = useState<StatusDraft | null>(null);
  const [characterDraft, setCharacterDraft] =
    useState<CharacterData | null>(null);
  const [itemEditor, setItemEditor] = useState<ItemEditorState | null>(null);
  const [classpectEditor, setClasspectEditor] =
    useState<ClasspectEditorState | null>(null);
  const [strifeMenu, setStrifeMenu] = useState<
    "root" | "weapon" | "classpect" | "item" | "act"
  >("root");
  const [inventoryTab, setInventoryTab] = useState<"equipment" | "items">(
    "equipment",
  );
  const [equipmentFilter, setEquipmentFilter] = useState("Equipped");
  const [equipmentSearch, setEquipmentSearch] = useState("");
  const [equipmentSort, setEquipmentSort] = useState("Equipped first");
  const [classFilter, setClassFilter] =
    useState<(typeof classpectCategories)[number]>("All");
  const [aspectFilter, setAspectFilter] =
    useState<(typeof classpectCategories)[number]>("All");
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = migratePersistedPrototype(JSON.parse(raw));
        if (parsed) {
          // Local storage is the external source being synchronized here.
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setCharacter(parsed.character);
          setHistory(parsed.history ?? []);
          setUndoStack(parsed.undoStack ?? []);
          setSelectedSection(parsed.selectedSection ?? "character");
        }
      }
    } catch {
      setToast("Saved data could not be read. Demo data is active.");
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const payload: PersistedPrototype = {
      schemaVersion: SCHEMA_VERSION,
      character,
      history,
      undoStack,
      selectedSection,
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [character, history, hydrated, selectedSection, undoStack]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const maximumHealth = getMaximumHealth(character);
  const maximumPluck = getMaximumPluck(character);
  const maximumAP = getMaximumAP(character);
  const gelViscosity = getStat(character, "gel-viscosity");
  const moxieMuffling = getStat(character, "moxie-muffling");
  const triggerance = getStat(character, "triggerance");
  const verballistamina = getStat(character, "verballistamina");

  const commit = (
    label: string,
    metadata: Partial<ResourceChangeHistory>,
    mutate: (draft: CharacterData) => void,
  ) => {
    const previous = clone(character);
    const next = clone(character);
    mutate(next);
    const historyId = makeId("history");
    const entry: ResourceChangeHistory = {
      id: historyId,
      timestamp: new Date().toISOString(),
      label,
      resourceType: metadata.resourceType ?? "character",
      operationType: metadata.operationType ?? "manual",
      sourceName: metadata.sourceName,
      previousValue: metadata.previousValue,
      changeAmount: metadata.changeAmount,
      newValue: metadata.newValue,
      temporaryHealthBefore: metadata.temporaryHealthBefore,
      temporaryHealthAfter: metadata.temporaryHealthAfter,
      defenseUsed: metadata.defenseUsed,
      damageType: metadata.damageType,
      reverted: false,
    };
    const undoRecord: UndoRecord = {
      id: makeId("undo"),
      label,
      historyId,
      previousCharacter: previous,
    };
    setCharacter(next);
    setHistory((current) => [entry, ...current].slice(0, MAX_HISTORY));
    setUndoStack((current) => [...current, undoRecord].slice(-MAX_UNDO));
    setToast(`${label} saved. Undo is available.`);
  };

  const undoLast = () => {
    const record = undoStack[undoStack.length - 1];
    if (!record) {
      setToast("There is nothing to undo.");
      return;
    }
    setCharacter(clone(record.previousCharacter));
    setUndoStack((current) => current.slice(0, -1));
    setHistory((current) =>
      current.map((entry) =>
        entry.id === record.historyId ? { ...entry, reverted: true } : entry,
      ),
    );
    setToast(`Undid: ${record.label}.`);
  };

  const openAdjustment = (
    kind: AdjustmentKind,
    amount = 1,
    source?: string,
  ) => {
    setAdjustment({ kind, amount, source });
  };

  const getAdjustmentPreview = (
    request: AdjustmentRequest,
    allowLossBelowZero = false,
    ignoreMaximum = false,
  ) => {
    const amount = request.amount;
    const beforeHealth = character.resources.currentHealth;
    const beforeTemp = character.resources.temporaryHealth;
    const beforePluck = character.resources.currentPluck;
    let health = beforeHealth;
    let temp = beforeTemp;
    let pluck = beforePluck;

    if (request.kind === "health-loss" || request.kind === "hp-cost") {
      const tempUsed = Math.min(temp, Math.max(0, amount));
      temp -= tempUsed;
      health -= Math.max(0, amount) - tempUsed;
    } else if (request.kind === "heal") {
      health = ignoreMaximum
        ? health + Math.max(0, amount)
        : Math.min(maximumHealth, health + Math.max(0, amount));
    } else if (request.kind === "set-health") {
      health = amount;
    } else if (request.kind === "temp-gain") {
      temp += Math.max(0, amount);
    } else if (request.kind === "temp-remove") {
      temp = Math.max(0, temp - Math.max(0, amount));
    } else if (request.kind === "set-temp") {
      temp = Math.max(0, amount);
    } else if (request.kind === "pluck-cost") {
      pluck -= Math.max(0, amount);
    } else if (request.kind === "pluck-loss") {
      pluck = allowLossBelowZero
        ? pluck - Math.max(0, amount)
        : Math.max(0, pluck - Math.max(0, amount));
    } else if (request.kind === "pluck-restore") {
      pluck = ignoreMaximum
        ? pluck + Math.max(0, amount)
        : Math.min(maximumPluck, pluck + Math.max(0, amount));
    } else if (request.kind === "set-pluck") {
      pluck = amount;
    }

    return {
      beforeHealth,
      beforeTemp,
      beforePluck,
      health,
      temp,
      pluck,
    };
  };

  const applyAdjustment = (
    request: AdjustmentRequest,
    allowLossBelowZero: boolean,
    ignoreMaximum: boolean,
  ) => {
    const preview = getAdjustmentPreview(
      request,
      allowLossBelowZero,
      ignoreMaximum,
    );
    const labels: Record<AdjustmentKind, string> = {
      "health-loss": "Health loss",
      "hp-cost": "HP cost",
      heal: "Healing",
      "set-health": "Health set",
      "temp-gain": "Temporary Health added",
      "temp-remove": "Temporary Health removed",
      "set-temp": "Temporary Health set",
      "pluck-cost": "Pluck cost",
      "pluck-loss": "Pluck loss",
      "pluck-restore": "Pluck restored",
      "set-pluck": "Pluck set",
    };
    const resourceType = request.kind.includes("pluck")
      ? "Pluck"
      : request.kind.includes("temp")
        ? "Temporary Health"
        : "Health";
    const previousValue =
      resourceType === "Pluck"
        ? preview.beforePluck
        : resourceType === "Temporary Health"
          ? preview.beforeTemp
          : preview.beforeHealth;
    const newValue =
      resourceType === "Pluck"
        ? preview.pluck
        : resourceType === "Temporary Health"
          ? preview.temp
          : preview.health;

    commit(
      `${labels[request.kind]}${request.source ? ` — ${request.source}` : ""}`,
      {
        resourceType,
        operationType: request.kind,
        sourceName: request.source,
        previousValue,
        changeAmount: newValue - previousValue,
        newValue,
        temporaryHealthBefore: preview.beforeTemp,
        temporaryHealthAfter: preview.temp,
      },
      (draft) => {
        draft.resources.currentHealth = preview.health;
        draft.resources.temporaryHealth = preview.temp;
        draft.resources.currentPluck = preview.pluck;
      },
    );
    setAdjustment(null);
  };

  const damagePreview = useMemo(() => {
    const result = previewIncomingDamage({
      incomingDamage: damageAmount,
      damageType,
      damageProperty,
      gelViscosityModifier: gelViscosity.modifier,
      moxieMufflingModifier: moxieMuffling.modifier,
      manualDefenseOverride: manualDefense ? manualDefenseValue : undefined,
      currentHealth: character.resources.currentHealth,
      temporaryHealth: character.resources.temporaryHealth,
    });
    return {
      incoming: result.incoming,
      baseDefense: result.baseDefense,
      defenseUsed: result.defenseUsed,
      finalDamage: result.finalDamage,
      tempUsed: result.temporaryHealthUsed,
      healthLost: result.healthLost,
      resultingTemp: result.resultingTemporaryHealth,
      resultingHealth: result.resultingHealth,
    };
  }, [
    character.resources.currentHealth,
    character.resources.temporaryHealth,
    damageAmount,
    damageProperty,
    damageType,
    gelViscosity.modifier,
    manualDefense,
    manualDefenseValue,
    moxieMuffling.modifier,
  ]);

  const applyDamage = () => {
    const beforeHealth = character.resources.currentHealth;
    const beforeTemp = character.resources.temporaryHealth;
    commit(
      `${damagePreview.finalDamage} ${damageType} Damage applied`,
      {
        resourceType: "Health",
        operationType: "incoming-damage",
        previousValue: beforeHealth,
        changeAmount: -damagePreview.healthLost,
        newValue: damagePreview.resultingHealth,
        temporaryHealthBefore: beforeTemp,
        temporaryHealthAfter: damagePreview.resultingTemp,
        defenseUsed: damagePreview.defenseUsed,
        damageType,
      },
      (draft) => {
        draft.resources.temporaryHealth = damagePreview.resultingTemp;
        draft.resources.currentHealth = damagePreview.resultingHealth;
      },
    );
    setDamageOpen(false);
  };

  const applyCombinedCost = (request: CostRequest) => {
    const beforeHealth = character.resources.currentHealth;
    const beforeTemp = character.resources.temporaryHealth;
    const beforePluck = character.resources.currentPluck;
    commit(
      `Costs applied — ${request.source}`,
      {
        resourceType: "Health + Pluck",
        operationType: "listed-cost",
        sourceName: request.source,
        previousValue: beforeHealth,
        changeAmount: -request.healthCost,
        temporaryHealthBefore: beforeTemp,
      },
      (draft) => {
        applyHealthRemoval(draft, request.healthCost);
        draft.resources.currentPluck = beforePluck - request.pluckCost;
      },
    );
    setCostRequest(null);
  };

  const toggleEquipment = (itemId: string) => {
    const target = character.items.find((item) => item.id === itemId);
    if (!target) return;
    commit(
      `${target.equipped ? "Unequipped" : "Equipped"} ${target.name}`,
      {
        resourceType: "Equipment",
        operationType: target.equipped ? "unequip" : "equip",
        sourceName: target.name,
      },
      (draft) => {
        const item = draft.items.find((entry) => entry.id === itemId);
        if (!item) return;
        const willEquip = !item.equipped;
        if (willEquip && item.itemType === "Weapon") {
          draft.items.forEach((entry) => {
            if (entry.itemType === "Weapon") entry.equipped = false;
          });
        }
        if (willEquip && item.itemType === "Armor" && item.slot) {
          draft.items.forEach((entry) => {
            if (entry.itemType === "Armor" && entry.slot === item.slot) {
              entry.equipped = false;
            }
          });
        }
        item.equipped = willEquip;
        const nextMaxHealth = getMaximumHealth(draft);
        const nextMaxPluck = getMaximumPluck(draft);
        if (draft.resources.currentHealth > nextMaxHealth) {
          draft.resources.currentHealth = nextMaxHealth;
        }
        if (draft.resources.currentPluck > nextMaxPluck) {
          draft.resources.currentPluck = nextMaxPluck;
        }
      },
    );
  };

  const changeQuantity = (itemId: string, nextQuantity: number) => {
    const item = character.items.find((entry) => entry.id === itemId);
    if (!item || nextQuantity === item.quantity) return;
    commit(
      `${item.name} quantity ${item.quantity} → ${nextQuantity}`,
      {
        resourceType: "Inventory",
        operationType: "quantity",
        sourceName: item.name,
        previousValue: item.quantity,
        newValue: nextQuantity,
        changeAmount: nextQuantity - item.quantity,
      },
      (draft) => {
        const target = draft.items.find((entry) => entry.id === itemId);
        if (target) target.quantity = Math.max(0, nextQuantity);
      },
    );
  };

  const spendItemCharge = (itemId: string) => {
    const item = character.items.find((entry) => entry.id === itemId);
    if (!item || item.remainingCharges === undefined || item.remainingCharges <= 0)
      return;
    commit(
      `Spent 1 charge — ${item.name}`,
      {
        resourceType: "Item charge",
        operationType: "spend-charge",
        sourceName: item.name,
        previousValue: item.remainingCharges,
        newValue: item.remainingCharges - 1,
        changeAmount: -1,
      },
      (draft) => {
        const target = draft.items.find((entry) => entry.id === itemId);
        if (target?.remainingCharges !== undefined) {
          target.remainingCharges = Math.max(0, target.remainingCharges - 1);
        }
      },
    );
  };

  const applyItemUse = (item: Item) => {
    const beforeHealth = character.resources.currentHealth;
    const beforeTemp = character.resources.temporaryHealth;
    commit(
      `Listed changes applied — ${item.name}`,
      {
        resourceType: "Item + resources",
        operationType: "item-use",
        sourceName: item.name,
        previousValue: beforeHealth,
        temporaryHealthBefore: beforeTemp,
      },
      (draft) => {
        const target = draft.items.find((entry) => entry.id === item.id);
        if (!target) return;
        if (target.healthCost) applyHealthRemoval(draft, target.healthCost);
        if (target.pluckCost) {
          draft.resources.currentPluck -= target.pluckCost;
        }
        if (target.healingAmount) {
          draft.resources.currentHealth = Math.min(
            getMaximumHealth(draft),
            draft.resources.currentHealth + target.healingAmount,
          );
        }
        if (target.pluckRestorationAmount) {
          draft.resources.currentPluck = Math.min(
            getMaximumPluck(draft),
            draft.resources.currentPluck + target.pluckRestorationAmount,
          );
        }
        if (target.temporaryHealthAmount) {
          draft.resources.temporaryHealth += target.temporaryHealthAmount;
        }
        if (target.consumable) {
          target.quantity = Math.max(0, target.quantity - 1);
        }
        if (
          target.remainingCharges !== undefined &&
          target.remainingCharges > 0
        ) {
          target.remainingCharges -= 1;
        }
      },
    );
    setItemUseId(null);
  };

  const updateMove = (
    itemId: string,
    moveId: string,
    action: "charge" | "used",
  ) => {
    const item = character.items.find((entry) => entry.id === itemId);
    const move = item?.weaponMoves?.find((entry) => entry.id === moveId);
    if (!item || !move) return;
    commit(
      action === "charge"
        ? `Spent move charge — ${move.name}`
        : `${move.used ? "Available" : "Spent"} — ${move.name}`,
      {
        resourceType: "Weapon Move",
        operationType: action === "charge" ? "spend-charge" : "limited-use",
        sourceName: move.name,
      },
      (draft) => {
        const target = draft.items
          .find((entry) => entry.id === itemId)
          ?.weaponMoves?.find((entry) => entry.id === moveId);
        if (!target) return;
        if (action === "charge" && target.currentCharges !== undefined) {
          target.currentCharges = Math.max(0, target.currentCharges - 1);
        } else if (action === "used") {
          target.used = !target.used;
        }
      },
    );
  };

  const updateClasspectUse = (
    entryId: string,
    action: "charge" | "used",
  ) => {
    const entry = character.classpectEntries.find(
      (candidate) => candidate.id === entryId,
    );
    if (!entry) return;
    commit(
      action === "charge"
        ? `Spent charge — ${entry.name}`
        : `${entry.used ? "Available" : "Spent"} — ${entry.name}`,
      {
        resourceType: entry.entryType,
        operationType: action === "charge" ? "spend-charge" : "limited-use",
        sourceName: entry.name,
      },
      (draft) => {
        const target = draft.classpectEntries.find(
          (candidate) => candidate.id === entryId,
        );
        if (!target) return;
        if (action === "charge" && target.currentCharges !== undefined) {
          target.currentCharges = Math.max(0, target.currentCharges - 1);
        } else if (action === "used") {
          target.used = !target.used;
        }
      },
    );
  };

  const updateResource = (
    key:
      | "currentAP"
      | "doomMarks"
      | "surge"
      | "stagger"
      | "shortRestsUsed",
    value: number,
  ) => {
    const limits: Partial<Record<typeof key, [number, number]>> = {
      doomMarks: [0, 3],
      surge: [0, Number.POSITIVE_INFINITY],
      stagger: [0, Number.POSITIVE_INFINITY],
      shortRestsUsed: [0, 2],
      currentAP: [0, Number.POSITIVE_INFINITY],
    };
    const [minimum, maximum] = limits[key] ?? [
      Number.NEGATIVE_INFINITY,
      Number.POSITIVE_INFINITY,
    ];
    const nextValue = Math.max(minimum, Math.min(maximum, value));
    if (nextValue === character.resources[key]) return;
    commit(
      `${key.replace(/([A-Z])/g, " $1")} adjusted`,
      {
        resourceType: key,
        operationType: "manual-adjustment",
        previousValue: character.resources[key],
        newValue: nextValue,
        changeAmount: nextValue - character.resources[key],
      },
      (draft) => {
        draft.resources[key] = nextValue;
      },
    );
  };

  const openCharacterEditor = () => {
    setCharacterDraft(clone(character));
  };

  const saveCharacterEditor = () => {
    if (!characterDraft) return;
    const saved = clone(characterDraft);
    saved.schemaVersion = SCHEMA_VERSION;
    saved.identity.level = Math.max(0, saved.identity.level);
    saved.identity.currentExp = Math.max(0, saved.identity.currentExp);
    saved.identity.expRequiredForNextLevel = Math.max(
      0,
      saved.identity.expRequiredForNextLevel,
    );
    saved.identity.grist = Math.max(0, saved.identity.grist);
    saved.identity.boondollars = Math.max(0, saved.identity.boondollars);
    saved.identity.skillPoints = Math.max(0, saved.identity.skillPoints);
    saved.resources.baseMaximumHealth = Math.max(
      0,
      saved.resources.baseMaximumHealth,
    );
    saved.resources.baseMaximumPluck = Math.max(
      0,
      saved.resources.baseMaximumPluck,
    );
    saved.resources.doomMarks = Math.max(
      0,
      Math.min(3, saved.resources.doomMarks),
    );
    saved.resources.shortRestsUsed = Math.max(
      0,
      Math.min(2, saved.resources.shortRestsUsed),
    );
    saved.resources.currentHealth = Math.min(
      saved.resources.currentHealth,
      getMaximumHealth(saved),
    );
    saved.resources.currentPluck = Math.min(
      saved.resources.currentPluck,
      getMaximumPluck(saved),
    );

    commit(
      `Updated character sheet — ${saved.identity.characterName}`,
      {
        resourceType: "Character Sheet",
        operationType: "edit",
        sourceName: saved.identity.characterName,
      },
      (draft) => {
        Object.assign(draft, saved);
      },
    );
    setCharacterDraft(null);
  };

  const focusInventoryEntry = (item: Item) => {
    setEquipmentSearch("");
    if (["Weapon", "Armor", "Trinket", "Badge"].includes(item.itemType)) {
      setInventoryTab("equipment");
      setEquipmentFilter(
        item.itemType === "Weapon"
          ? "Weapons"
          : item.itemType === "Armor"
            ? "Armor"
            : item.itemType === "Trinket"
              ? "Trinkets"
              : "Badges",
      );
    } else {
      setInventoryTab("items");
      setEquipmentFilter(
        item.itemType === "Consumable"
          ? "Consumables"
          : item.itemType === "Utility Item"
            ? "Utility"
            : item.itemType === "Catalyst"
              ? "Catalysts"
              : item.itemType === "Quest Item"
                ? "Quest Items"
                : "Miscellaneous",
      );
    }
  };

  const openNewItem = () => {
    const item = createBlankItem(
      inventoryTab === "equipment" ? "Weapon" : "Miscellaneous Item",
    );
    setItemEditor({ mode: "create", item });
  };

  const saveItemEditor = () => {
    if (!itemEditor || !itemEditor.item.name.trim()) return;
    const saved = clone(itemEditor.item);
    saved.quantity = Math.max(0, saved.quantity);
    if (saved.maximumCharges === undefined) {
      saved.remainingCharges = undefined;
    } else {
      saved.remainingCharges = Math.max(
        0,
        Math.min(
          saved.maximumCharges,
          saved.remainingCharges ?? saved.maximumCharges,
        ),
      );
    }
    [...saved.majorAffixes, ...saved.minorAffixes].forEach((affix) => {
      if (affix.maximumCharges === undefined) {
        affix.currentCharges = undefined;
      } else {
        affix.currentCharges = Math.max(
          0,
          Math.min(
            affix.maximumCharges,
            affix.currentCharges ?? affix.maximumCharges,
          ),
        );
      }
    });
    saved.weaponMoves?.forEach((move) => {
      if (move.maximumCharges === undefined) {
        move.currentCharges = undefined;
      } else {
        move.currentCharges = Math.max(
          0,
          Math.min(
            move.maximumCharges,
            move.currentCharges ?? move.maximumCharges,
          ),
        );
      }
    });
    if (saved.itemType !== "Weapon") saved.weaponMoves = undefined;

    commit(
      `${itemEditor.mode === "create" ? "Created" : "Updated"} ${saved.name}`,
      {
        resourceType: "Inventory",
        operationType:
          itemEditor.mode === "create" ? "create-item" : "edit-item",
        sourceName: saved.name,
      },
      (draft) => {
        const existingIndex = draft.items.findIndex(
          (item) => item.id === saved.id,
        );
        if (existingIndex >= 0) {
          draft.items[existingIndex] = saved;
        } else {
          draft.items.push(saved);
        }

        if (saved.equipped && saved.itemType === "Weapon") {
          draft.items.forEach((item) => {
            if (item.id !== saved.id && item.itemType === "Weapon") {
              item.equipped = false;
            }
          });
        }
        if (saved.equipped && saved.itemType === "Armor" && saved.slot) {
          draft.items.forEach((item) => {
            if (
              item.id !== saved.id &&
              item.itemType === "Armor" &&
              item.slot === saved.slot
            ) {
              item.equipped = false;
            }
          });
        }

        draft.resources.currentHealth = Math.min(
          draft.resources.currentHealth,
          getMaximumHealth(draft),
        );
        draft.resources.currentPluck = Math.min(
          draft.resources.currentPluck,
          getMaximumPluck(draft),
        );
      },
    );
    focusInventoryEntry(saved);
    setItemEditor(null);
  };

  const duplicateInventoryItem = (item: Item) => {
    const copy = duplicateItem(item);
    commit(
      `Duplicated ${item.name}`,
      {
        resourceType: "Inventory",
        operationType: "duplicate-item",
        sourceName: item.name,
      },
      (draft) => {
        draft.items.push(copy);
      },
    );
    focusInventoryEntry(copy);
  };

  const requestDeleteItem = (item: Item) => {
    setConfirmRequest({
      title: `Delete ${item.name}?`,
      description:
        "This removes the item, its Affixes, and all attached Weapon Moves. The complete deletion can be undone.",
      confirmLabel: "Delete item",
      action: () => {
        commit(
          `Deleted ${item.name}`,
          {
            resourceType: "Inventory",
            operationType: "delete-item",
            sourceName: item.name,
          },
          (draft) => {
            draft.items = draft.items.filter((entry) => entry.id !== item.id);
            draft.resources.currentHealth = Math.min(
              draft.resources.currentHealth,
              getMaximumHealth(draft),
            );
            draft.resources.currentPluck = Math.min(
              draft.resources.currentPluck,
              getMaximumPluck(draft),
            );
          },
        );
        setConfirmRequest(null);
      },
    });
  };

  const openNewClasspectEntry = (
    entryType: ClasspectEntry["entryType"],
  ) => {
    const displayOrder =
      Math.max(
        0,
        ...character.classpectEntries
          .filter((entry) => entry.entryType === entryType)
          .map((entry) => entry.displayOrder),
      ) + 1;
    setClasspectEditor({
      mode: "create",
      entry: createBlankClasspectEntry(entryType, displayOrder),
    });
  };

  const saveClasspectEditor = () => {
    if (!classpectEditor || !classpectEditor.entry.name.trim()) return;
    const saved = clone(classpectEditor.entry);
    const original = character.classpectEntries.find(
      (entry) => entry.id === saved.id,
    );
    if (original && original.entryType !== saved.entryType) {
      saved.displayOrder =
        Math.max(
          0,
          ...character.classpectEntries
            .filter((entry) => entry.entryType === saved.entryType)
            .map((entry) => entry.displayOrder),
        ) + 1;
    }
    if (saved.maximumCharges === undefined) {
      saved.currentCharges = undefined;
    } else {
      saved.currentCharges = Math.max(
        0,
        Math.min(
          saved.maximumCharges,
          saved.currentCharges ?? saved.maximumCharges,
        ),
      );
    }
    commit(
      `${classpectEditor.mode === "create" ? "Created" : "Updated"} ${saved.name}`,
      {
        resourceType: saved.entryType,
        operationType:
          classpectEditor.mode === "create"
            ? "create-classpect"
            : "edit-classpect",
        sourceName: saved.name,
      },
      (draft) => {
        const existingIndex = draft.classpectEntries.findIndex(
          (entry) => entry.id === saved.id,
        );
        if (existingIndex >= 0) {
          draft.classpectEntries[existingIndex] = saved;
        } else {
          draft.classpectEntries.push(saved);
        }
      },
    );
    if (saved.entryType === "Class Skill") {
      setClassFilter("All");
    } else {
      setAspectFilter("All");
    }
    setClasspectEditor(null);
  };

  const duplicateClasspect = (entry: ClasspectEntry) => {
    const nextOrder =
      Math.max(
        0,
        ...character.classpectEntries
          .filter((candidate) => candidate.entryType === entry.entryType)
          .map((candidate) => candidate.displayOrder),
      ) + 1;
    const copy = duplicateClasspectEntry(entry, nextOrder);
    commit(
      `Duplicated ${entry.name}`,
      {
        resourceType: entry.entryType,
        operationType: "duplicate-classpect",
        sourceName: entry.name,
      },
      (draft) => {
        draft.classpectEntries.push(copy);
      },
    );
    if (copy.entryType === "Class Skill") {
      setClassFilter("All");
    } else {
      setAspectFilter("All");
    }
  };

  const requestDeleteClasspect = (entry: ClasspectEntry) => {
    setConfirmRequest({
      title: `Delete ${entry.name}?`,
      description:
        "This removes the complete rules entry and its usage tracking. The deletion can be undone.",
      confirmLabel: `Delete ${entry.entryType}`,
      action: () => {
        commit(
          `Deleted ${entry.name}`,
          {
            resourceType: entry.entryType,
            operationType: "delete-classpect",
            sourceName: entry.name,
          },
          (draft) => {
            draft.classpectEntries = draft.classpectEntries.filter(
              (candidate) => candidate.id !== entry.id,
            );
          },
        );
        setConfirmRequest(null);
      },
    });
  };

  const moveClasspectEntry = (
    entry: ClasspectEntry,
    direction: -1 | 1,
  ) => {
    const peers = character.classpectEntries
      .filter((candidate) => candidate.entryType === entry.entryType)
      .sort((a, b) => a.displayOrder - b.displayOrder);
    const index = peers.findIndex((candidate) => candidate.id === entry.id);
    const swap = peers[index + direction];
    if (index < 0 || !swap) return;

    commit(
      `Reordered ${entry.name}`,
      {
        resourceType: entry.entryType,
        operationType: "reorder-classpect",
        sourceName: entry.name,
      },
      (draft) => {
        const current = draft.classpectEntries.find(
          (candidate) => candidate.id === entry.id,
        );
        const other = draft.classpectEntries.find(
          (candidate) => candidate.id === swap.id,
        );
        if (!current || !other) return;
        const previousOrder = current.displayOrder;
        current.displayOrder = other.displayOrder;
        other.displayOrder = previousOrder;
      },
    );
  };

  const removeStatus = (status: ActiveStatusNote) => {
    setConfirmRequest({
      title: `Remove ${status.statusName}?`,
      description:
        "This removes the tracking note only. It does not resolve the Status in the tabletop rules.",
      confirmLabel: "Remove note",
      action: () => {
        commit(
          `Removed Status note — ${status.statusName}`,
          {
            resourceType: "Status note",
            operationType: "remove",
            sourceName: status.statusName,
          },
          (draft) => {
            draft.statuses = draft.statuses.filter(
              (entry) => entry.id !== status.id,
            );
          },
        );
        setConfirmRequest(null);
      },
    });
  };

  const addStatus = (draft: StatusDraft) => {
    const status: ActiveStatusNote = {
      id: makeId("status"),
      statusName: draft.statusName.trim() || "Custom Status",
      potency: draft.potency.trim() || undefined,
      remainingDuration: draft.remainingDuration
        ? Number(draft.remainingDuration)
        : undefined,
      durationType: draft.remainingDuration
        ? draft.durationType.trim() || "turns"
        : undefined,
      saveStat: draft.saveStat.trim() || undefined,
      saveDC: draft.saveDC ? Number(draft.saveDC) : undefined,
      source: draft.source.trim() || undefined,
      notes: draft.notes.trim() || undefined,
    };
    commit(
      `Added Status note — ${status.statusName}`,
      {
        resourceType: "Status note",
        operationType: "add",
        sourceName: status.statusName,
      },
      (characterDraft) => {
        characterDraft.statuses.push(status);
      },
    );
    setStatusDraft(null);
  };

  const openStatOverride = (statId: string) => {
    const stat = character.stats.find((entry) => entry.definitionId === statId);
    const values = getStat(character, statId);
    if (!stat) return;
    setStatOverride({
      statId,
      enabled: stat.manualOverrideEnabled,
      total: stat.manualTotalOverride ?? values.calculatedTotal,
      modifier:
        stat.manualModifierOverride ?? Math.floor(values.calculatedTotal / 5),
    });
  };

  const saveStatOverride = (request: StatOverrideRequest) => {
    const definition = statDefinitions.find(
      (entry) => entry.id === request.statId,
    );
    commit(
      `${definition?.name ?? "Stat"} manual override ${
        request.enabled ? "saved" : "cleared"
      }`,
      {
        resourceType: "Stat",
        operationType: "gm-override",
        sourceName: definition?.name,
      },
      (draft) => {
        const stat = draft.stats.find(
          (entry) => entry.definitionId === request.statId,
        );
        if (!stat) return;
        stat.manualOverrideEnabled = request.enabled;
        stat.manualTotalOverride = request.enabled ? request.total : undefined;
        stat.manualModifierOverride = request.enabled
          ? request.modifier
          : undefined;
      },
    );
    setStatOverride(null);
  };

  const exportCharacter = () => {
    const payload = {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      character,
      resourceHistory: history,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${character.identity.characterName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")}-sburb.json`;
    link.click();
    URL.revokeObjectURL(url);
    setToast("Character backup exported.");
  };

  const importCharacter = async (file: File) => {
    try {
      const parsed = migrateCharacterBackup(JSON.parse(await file.text()));
      if (!parsed) {
        throw new Error("Unsupported schema");
      }
      setConfirmRequest({
        title: "Restore this character backup?",
        description:
          "The imported character will replace the current local prototype data. Export first if you want to keep the current version.",
        confirmLabel: "Restore backup",
        action: () => {
          setCharacter(clone(parsed.character));
          setHistory(parsed.history);
          setUndoStack([]);
          setConfirmRequest(null);
          setToast("Character backup restored.");
        },
      });
    } catch {
      setToast("That file is not a compatible SBURB character backup.");
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  const resetDemo = () => {
    setConfirmRequest({
      title: "Reset Mina Quill?",
      description:
        "This replaces all local edits, resource history, notes, quantities, and limited-use tracking with the original seed data.",
      confirmLabel: "Reset demo",
      action: () => {
        setCharacter(clone(seedCharacter));
        setHistory([]);
        setUndoStack([]);
        setSelectedSection("character");
        setConfirmRequest(null);
        setToast("Demo character reset.");
      },
    });
  };

  const filteredEquipment = useMemo(() => {
    const query = equipmentSearch.trim().toLowerCase();
    const filterMap: Record<string, (item: Item) => boolean> = {
      Equipped: (item) => item.equipped,
      Weapons: (item) => item.itemType === "Weapon",
      Armor: (item) => item.itemType === "Armor",
      Trinkets: (item) => item.itemType === "Trinket",
      Badges: (item) => item.itemType === "Badge",
      "All Items": (item) =>
        !["Weapon", "Armor", "Trinket", "Badge"].includes(item.itemType),
      Consumables: (item) => item.itemType === "Consumable",
      Utility: (item) => item.itemType === "Utility Item",
      Catalysts: (item) => item.itemType === "Catalyst",
      "Quest Items": (item) => item.itemType === "Quest Item",
      Miscellaneous: (item) => item.itemType === "Miscellaneous Item",
    };
    const filtered = character.items.filter((item) => {
      const matchesFilter = (filterMap[equipmentFilter] ?? (() => true))(item);
      const searchable = `${item.name} ${item.itemType} ${item.rarity} ${
        item.slot ?? ""
      } ${item.weaponkind ?? ""} ${item.shortDescription}`.toLowerCase();
      return matchesFilter && (!query || searchable.includes(query));
    });
    return filtered.sort((a, b) => {
      if (equipmentSort === "Name") return a.name.localeCompare(b.name);
      if (equipmentSort === "Item Level")
        return (b.itemLevel ?? 0) - (a.itemLevel ?? 0);
      if (equipmentSort === "Rarity")
        return a.rarity.localeCompare(b.rarity);
      if (equipmentSort === "Item type")
        return a.itemType.localeCompare(b.itemType) || a.name.localeCompare(b.name);
      return Number(b.equipped) - Number(a.equipped) || a.name.localeCompare(b.name);
    });
  }, [
    character.items,
    equipmentFilter,
    equipmentSearch,
    equipmentSort,
  ]);

  const equippedWeapon = character.items.find(
    (item) => item.itemType === "Weapon" && item.equipped,
  );
  const itemUse = itemUseId
    ? character.items.find((item) => item.id === itemUseId) ?? null
    : null;

  const renderQuickActions = () => (
    <div className="quick-action-grid">
      <button className="button button-health" onClick={() => setDamageOpen(true)}>
        Incoming damage
      </button>
      <button
        className="button button-muted"
        onClick={() => openAdjustment("hp-cost", 1)}
      >
        Pay HP cost
      </button>
      <button
        className="button button-muted"
        onClick={() => openAdjustment("pluck-cost", 1)}
      >
        Pay Pluck cost
      </button>
      <button
        className="button button-muted"
        onClick={() => openAdjustment("heal", 1)}
      >
        Heal
      </button>
      <button
        className="button button-muted"
        onClick={() => openAdjustment("pluck-restore", 1)}
      >
        Restore Pluck
      </button>
      <button
        className="button button-quiet"
        onClick={undoLast}
        disabled={!undoStack.length}
      >
        Undo last change
      </button>
    </div>
  );

  const renderMeters = () => (
    <>
      <div className="meter-grid">
        <MeterCard
          label="Health Vial"
          current={character.resources.currentHealth}
          maximum={maximumHealth}
          tone="health"
          amountLabel="Health adjustment amount"
          onSubtract={(amount) => openAdjustment("health-loss", amount)}
          onAdd={(amount) => openAdjustment("heal", amount)}
          onSet={() =>
            openAdjustment(
              "set-health",
              character.resources.currentHealth,
            )
          }
        />
        <MeterCard
          label="Temporary Health"
          current={character.resources.temporaryHealth}
          tone="temp"
          amountLabel="Temporary Health adjustment amount"
          onSubtract={(amount) => openAdjustment("temp-remove", amount)}
          onAdd={(amount) => openAdjustment("temp-gain", amount)}
          onSet={() =>
            openAdjustment(
              "set-temp",
              character.resources.temporaryHealth,
            )
          }
        />
        <MeterCard
          label="Pluck"
          current={character.resources.currentPluck}
          maximum={maximumPluck}
          tone="pluck"
          amountLabel="Pluck adjustment amount"
          onSubtract={(amount) => openAdjustment("pluck-loss", amount)}
          onAdd={(amount) => openAdjustment("pluck-restore", amount)}
          onSet={() =>
            openAdjustment("set-pluck", character.resources.currentPluck)
          }
        />
      </div>
      {renderQuickActions()}
    </>
  );

  const renderResources = () => (
    <div className="resource-grid">
      <ResourceReadout
        label="Maximum AP"
        value={maximumAP}
        detail=" from Total Scamperway"
      />
      <DoomMarks
        value={character.resources.doomMarks}
        onChange={(value) => updateResource("doomMarks", value)}
      />
      <ResourceReadout
        label="Short Rests"
        value={2 - character.resources.shortRestsUsed}
        detail=" / 2 remaining"
      />
      <ResourceReadout
        label="Skill Points"
        value={character.identity.skillPoints}
      />
      <ResourceReadout
        label="Grist"
        value={formatNumber(character.identity.grist)}
      />
      <ResourceReadout
        label="Boondollars"
        value={formatNumber(character.identity.boondollars)}
      />
    </div>
  );

  const renderCharacter = () => {
    const expPercent = Math.max(
      0,
      Math.min(
        100,
        (character.identity.currentExp /
          character.identity.expRequiredForNextLevel) *
          100,
      ),
    );
    return (
      <div className="page-stack">
        <SectionHeading
          eyebrow="Player overview"
          title="Character"
          description="Persistent identity, meters, character resources, and complete Stats."
          action={
            <div className="authoring-actions">
              <span className={`save-indicator ${hydrated ? "saved" : ""}`}>
                <span />
                {hydrated ? "Saved locally" : "Loading save…"}
              </span>
              <button
                className="button button-primary"
                onClick={openCharacterEditor}
              >
                Edit character
              </button>
            </div>
          }
        />

        <section className="identity-card panel">
          <div
            className={`portrait-large ${
              character.identity.portraitUrl ? "has-image" : ""
            }`}
            style={
              character.identity.portraitUrl
                ? {
                    backgroundImage: `url(${character.identity.portraitUrl})`,
                  }
                : undefined
            }
            aria-hidden="true"
          >
            <span>{character.identity.portraitInitials}</span>
            <i>✦</i>
          </div>
          <div className="identity-main">
            <p className="eyebrow">{character.identity.playerName}&apos;s character</p>
            <h2>{character.identity.characterName}</h2>
            <p className="classpect-title">
              {character.identity.className} of {character.identity.aspectName}
            </p>
            <p className="land-name">{character.identity.landName}</p>
            <p className="character-note">{character.identity.notes}</p>
          </div>
          <div className="level-block">
            <span>Echeladder</span>
            <strong>Level {character.identity.level}</strong>
          </div>
          <div className="exp-block">
            <div>
              <span>EXP</span>
              <strong>
                {formatNumber(character.identity.currentExp)} /{" "}
                {formatNumber(character.identity.expRequiredForNextLevel)}
              </strong>
            </div>
            <div
              className="exp-track"
              role="progressbar"
              aria-label="Experience progress"
              aria-valuemin={0}
              aria-valuemax={character.identity.expRequiredForNextLevel}
              aria-valuenow={character.identity.currentExp}
            >
              <span style={{ width: `${expPercent}%` }} />
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Shared character state</p>
              <h2>Meters</h2>
            </div>
            <p>Negative Health and confirmed negative Pluck are supported.</p>
          </div>
          {renderMeters()}
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Character reference</p>
              <h2>Persistent Resources</h2>
            </div>
            <p>Current AP, Surge, and Stagger are controlled only in Strife.</p>
          </div>
          {renderResources()}
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Total ÷ 5, rounded down</p>
              <h2>Stats</h2>
            </div>
            <p>Equipment bonuses recalculate when gear changes.</p>
          </div>
          <div className="stat-columns">
            {categoryOrder.map((category) => (
              <StatSection
                key={category}
                category={category}
                character={character}
                onOverride={openStatOverride}
              />
            ))}
          </div>
          <details className="stat-category custom-stats" open>
            <summary>
              <span>Custom Stats</span>
              <span className="summary-hint">GM-defined behavior</span>
            </summary>
            <div className="custom-stat-grid">
              {character.customStats
                .slice()
                .sort((a, b) => a.displayOrder - b.displayOrder)
                .map((stat) => (
                  <article className="custom-stat-card" key={stat.id}>
                    <div>
                      <p className="eyebrow">
                        {stat.modifierType.replace("-", " ")}
                      </p>
                      <h3>{stat.name}</h3>
                    </div>
                    <strong className="custom-stat-value">
                      {formatModifier(stat.bonus)}
                    </strong>
                    <p>{stat.description}</p>
                    {stat.linkedStandardStat ? (
                      <span className="tag">
                        Linked: {stat.linkedStandardStat}
                      </span>
                    ) : null}
                    {stat.notes ? (
                      <p className="muted-copy">{stat.notes}</p>
                    ) : null}
                  </article>
                ))}
            </div>
          </details>
        </section>

        <section className="panel backup-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Schema v{SCHEMA_VERSION}</p>
              <h2>Backup & Recent Changes</h2>
            </div>
            <div className="action-row">
              <button className="button button-muted" onClick={exportCharacter}>
                Export JSON
              </button>
              <button
                className="button button-muted"
                onClick={() => importInputRef.current?.click()}
              >
                Import JSON
              </button>
              <input
                ref={importInputRef}
                className="sr-only"
                type="file"
                accept="application/json,.json"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void importCharacter(file);
                }}
              />
              <button className="button button-danger" onClick={resetDemo}>
                Reset demo
              </button>
            </div>
          </div>
          <div className="history-list">
            {history.slice(0, 6).map((entry) => (
              <article
                key={entry.id}
                className={entry.reverted ? "history-reverted" : ""}
              >
                <span className="history-mark" />
                <div>
                  <strong>{entry.label}</strong>
                  <small>
                    {new Date(entry.timestamp).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                    {entry.reverted ? " · reverted" : ""}
                  </small>
                </div>
              </article>
            ))}
            {!history.length ? (
              <p className="empty-copy">
                Resource, inventory, equipment, and tracking changes will appear
                here.
              </p>
            ) : null}
          </div>
        </section>
      </div>
    );
  };

  const renderInventory = () => {
    const activeFilters =
      inventoryTab === "equipment"
        ? inventoryEquipmentFilters
        : inventoryItemFilters;

    return (
      <div className="page-stack">
      <SectionHeading
        eyebrow={`${character.items.length} owned entries`}
        title="Inventory"
        description="Manage equipped gear and carried items from one place, with complete rules, quantities, charges, and Affixes."
        action={
          <div className="authoring-actions">
            <button className="button button-primary" onClick={openNewItem}>
              + New entry
            </button>
            <button
              className="button button-quiet"
              onClick={undoLast}
              disabled={!undoStack.length}
            >
              Undo last change
            </button>
          </div>
        }
      />
      <section className="equipment-toolbar panel">
        <div
          className="inventory-primary-tabs"
          role="tablist"
          aria-label="Inventory sections"
        >
          <button
            className={inventoryTab === "equipment" ? "active" : ""}
            onClick={() => {
              setInventoryTab("equipment");
              setEquipmentFilter("Equipped");
            }}
            role="tab"
            aria-selected={inventoryTab === "equipment"}
          >
            Equipment
          </button>
          <button
            className={inventoryTab === "items" ? "active" : ""}
            onClick={() => {
              setInventoryTab("items");
              setEquipmentFilter("All Items");
            }}
            role="tab"
            aria-selected={inventoryTab === "items"}
          >
            Items
          </button>
        </div>
        <div
          className="filter-scroll"
          role="tablist"
          aria-label={
            inventoryTab === "equipment"
              ? "Equipment categories"
              : "Item categories"
          }
        >
          {activeFilters.map((filter) => (
            <button
              key={filter}
              className={equipmentFilter === filter ? "active" : ""}
              onClick={() => setEquipmentFilter(filter)}
              role="tab"
              aria-selected={equipmentFilter === filter}
            >
              {filter}
            </button>
          ))}
        </div>
        <div className="search-sort-row">
          <label className="search-field">
            <span className="sr-only">Search inventory</span>
            <span aria-hidden="true">⌕</span>
            <input
              type="search"
              placeholder="Search inventory…"
              value={equipmentSearch}
              onChange={(event) => setEquipmentSearch(event.target.value)}
            />
          </label>
          <label className="select-field">
            <span>Sort</span>
            <select
              value={equipmentSort}
              onChange={(event) => setEquipmentSort(event.target.value)}
            >
              <option>Equipped first</option>
              <option>Name</option>
              <option>Item Level</option>
              <option>Rarity</option>
              <option>Item type</option>
            </select>
          </label>
        </div>
      </section>
      <section className="equipment-list">
        {filteredEquipment.map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            onToggleEquip={() => toggleEquipment(item.id)}
            onQuantityChange={(next) => changeQuantity(item.id, next)}
            onSpendCharge={() => spendItemCharge(item.id)}
            onUse={() => setItemUseId(item.id)}
            onMoveCost={(move) =>
              setCostRequest({
                source: `${item.name}: ${move.name}`,
                healthCost: move.healthCost ?? 0,
                pluckCost: move.pluckCost ?? 0,
              })
            }
            onMoveCharge={(move) => updateMove(item.id, move.id, "charge")}
            onMoveUsed={(move) => updateMove(item.id, move.id, "used")}
            onEdit={() =>
              setItemEditor({ mode: "edit", item: clone(item) })
            }
            onDuplicate={() => duplicateInventoryItem(item)}
            onDelete={() => requestDeleteItem(item)}
          />
        ))}
        {!filteredEquipment.length ? (
          <div className="empty-state panel">
            <span>◇</span>
            <h2>No matching inventory entries</h2>
            <p>Try another category or clear the search.</p>
          </div>
        ) : null}
      </section>
      </div>
    );
  };

  const renderClasspectEntries = (
    type: ClasspectEntry["entryType"],
    filter: (typeof classpectCategories)[number],
  ) =>
    character.classpectEntries
      .filter(
        (entry) =>
          entry.entryType === type &&
          (filter === "All" || entry.category === filter),
      )
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((entry) => (
        <ClasspectCard
          key={entry.id}
          entry={entry}
          onApplyCost={() =>
            setCostRequest({
              source: entry.name,
              healthCost: entry.healthCost ?? 0,
              pluckCost: entry.pluckCost ?? 0,
            })
          }
          onSpendCharge={() => updateClasspectUse(entry.id, "charge")}
          onMarkUsed={() => updateClasspectUse(entry.id, "used")}
          onEdit={() =>
            setClasspectEditor({ mode: "edit", entry: clone(entry) })
          }
          onDuplicate={() => duplicateClasspect(entry)}
          onDelete={() => requestDeleteClasspect(entry)}
          onMove={(direction) => moveClasspectEntry(entry, direction)}
        />
      ));

  const renderClasspect = () => (
    <div className="page-stack">
      <SectionHeading
        eyebrow={`${character.identity.className} / ${character.identity.aspectName}`}
        title={`${character.identity.className} of ${character.identity.aspectName}`}
        description="Class Skills and Aspect Abilities stay separate, readable, and under Player control."
        action={
          <div className="authoring-actions">
            <button
              className="button button-primary"
              onClick={() => openNewClasspectEntry("Class Skill")}
            >
              + New Skill
            </button>
            <button
              className="button button-muted"
              onClick={() => openNewClasspectEntry("Aspect Ability")}
            >
              + New Ability
            </button>
            <div className="skill-points-callout">
              <span>Available Skill Points</span>
              <strong>{character.identity.skillPoints}</strong>
            </div>
          </div>
        }
      />
      <section className="classpect-intro-grid">
        <article className="panel class-intro">
          <p className="eyebrow">Class · {character.identity.className}</p>
          <h2>Class Skill library</h2>
          <p>{character.identity.classDescription}</p>
        </article>
        <article className="panel aspect-intro">
          <p className="eyebrow">Aspect · {character.identity.aspectName}</p>
          <h2>Aspect Ability library</h2>
          <p>{character.identity.aspectDescription}</p>
        </article>
      </section>
      <section className="panel classpect-section">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">
              {character.identity.className} reference
            </p>
            <h2>Class Skills</h2>
          </div>
          <CategoryFilters value={classFilter} onChange={setClassFilter} />
        </div>
        <div className="classpect-list">
          {renderClasspectEntries("Class Skill", classFilter)}
        </div>
      </section>
      <section className="panel classpect-section">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">
              {character.identity.aspectName} reference
            </p>
            <h2>Aspect Abilities</h2>
          </div>
          <CategoryFilters value={aspectFilter} onChange={setAspectFilter} />
        </div>
        <div className="classpect-list">
          {renderClasspectEntries("Aspect Ability", aspectFilter)}
        </div>
      </section>
    </div>
  );

  const renderStatusStrip = () => (
    <section className="status-panel panel">
      <div className="panel-heading compact">
        <div>
          <p className="eyebrow">Reference notes only</p>
          <h2>Active Statuses</h2>
        </div>
        <button
          className="button button-muted"
          onClick={() => setStatusDraft({ ...emptyStatusDraft })}
        >
          + Add Status
        </button>
      </div>
      <div className="status-chip-row">
        {character.statuses.map((status) => (
          <article className="status-chip" key={status.id}>
            <div>
              <strong>{status.statusName}</strong>
              <span>
                {status.potency ? `${status.potency}` : ""}
                {status.potency && status.remainingDuration ? " · " : ""}
                {status.remainingDuration
                  ? `${status.remainingDuration} ${
                      status.durationType ?? "turns"
                    }`
                  : ""}
              </span>
            </div>
            <button
              onClick={() => removeStatus(status)}
              aria-label={`Remove ${status.statusName} note`}
            >
              ×
            </button>
          </article>
        ))}
        <article className="status-chip stack-chip">
          <div>
            <strong>{character.resources.stagger} Stagger</strong>
            <span>Tracked stack</span>
          </div>
        </article>
      </div>
    </section>
  );

  const renderStrifeRoot = () => (
    <>
      <section className="strife-menu-grid" aria-label="Primary Strife menu">
        {[
          {
            id: "weapon" as const,
            index: "01",
            label: "Weapon",
            detail: equippedWeapon?.name ?? "No weapon equipped",
          },
          {
            id: "classpect" as const,
            index: "02",
            label: "Classpect",
            detail: "Skills & Abilities",
          },
          {
            id: "item" as const,
            index: "03",
            label: "Item",
            detail: `${character.items.filter(isStrifeItem).length} ready`,
          },
          {
            id: "act" as const,
            index: "04",
            label: "Act",
            detail: "Universal options",
          },
        ].map((option) => (
          <button
            className={`strife-menu-button menu-${option.id}`}
            key={option.id}
            onClick={() => setStrifeMenu(option.id)}
          >
            <span>{option.index}</span>
            <strong>{option.label}</strong>
            <small>{option.detail}</small>
            <i aria-hidden="true">→</i>
          </button>
        ))}
      </section>
      <section className="strife-readout panel">
        <p className="eyebrow">Console reminder</p>
        <h2>Select an option to inspect it.</h2>
        <p>
          Nothing on this page rolls dice, chooses targets, spends AP, or
          resolves an effect. Cost buttons apply only listed HP or Pluck.
        </p>
      </section>
    </>
  );

  const renderStrifeWeapon = () => (
    <section className="strife-submenu panel">
      <SubmenuHeader title="Weapon" onBack={() => setStrifeMenu("root")} />
      {equippedWeapon ? (
        <>
          <div className="equipped-weapon-banner">
            <span className="item-icon">{equippedWeapon.icon}</span>
            <div>
              <p className="eyebrow">Equipped · {equippedWeapon.weaponkind}</p>
              <h2>{equippedWeapon.name}</h2>
              <p>{equippedWeapon.shortDescription}</p>
            </div>
            <span className="rarity">{equippedWeapon.rarity}</span>
          </div>
          <AffixBlock
            title="Major Affix"
            affixes={equippedWeapon.majorAffixes}
          />
          <AffixBlock
            title="Minor Affixes"
            affixes={equippedWeapon.minorAffixes}
          />
          {equippedWeapon.curses?.length ? (
            <div className="curse-callout">
              <strong>Curse</strong>
              <span>{equippedWeapon.curses.join(" ")}</span>
            </div>
          ) : null}
          <div className="move-list">
            {equippedWeapon.weaponMoves?.map((move) => (
              <MoveCard
                key={move.id}
                move={move}
                compact
                onApplyCost={() =>
                  setCostRequest({
                    source: `${equippedWeapon.name}: ${move.name}`,
                    healthCost: move.healthCost ?? 0,
                    pluckCost: move.pluckCost ?? 0,
                  })
                }
                onSpendCharge={() =>
                  updateMove(equippedWeapon.id, move.id, "charge")
                }
                onMarkUsed={() =>
                  updateMove(equippedWeapon.id, move.id, "used")
                }
              />
            ))}
          </div>
        </>
      ) : (
        <p className="empty-copy">No weapon is equipped.</p>
      )}
    </section>
  );

  const renderStrifeClasspect = () => {
    const prioritized = character.classpectEntries
      .filter((entry) => entry.unlocked && entry.category !== "Passive")
      .sort((a, b) => {
        const priority = ["Active", "Reaction", "Augment", "Other"];
        return (
          priority.indexOf(a.category) - priority.indexOf(b.category) ||
          a.displayOrder - b.displayOrder
        );
      });
    const passives = character.classpectEntries.filter(
      (entry) => entry.unlocked && entry.category === "Passive",
    );
    return (
      <section className="strife-submenu panel">
        <SubmenuHeader title="Classpect" onBack={() => setStrifeMenu("root")} />
        <div className="classpect-list">
          {prioritized.map((entry) => (
            <ClasspectCard
              key={entry.id}
              entry={entry}
              onApplyCost={() =>
                setCostRequest({
                  source: entry.name,
                  healthCost: entry.healthCost ?? 0,
                  pluckCost: entry.pluckCost ?? 0,
                })
              }
              onSpendCharge={() => updateClasspectUse(entry.id, "charge")}
              onMarkUsed={() => updateClasspectUse(entry.id, "used")}
            />
          ))}
        </div>
        <details className="relevant-passives">
          <summary>Relevant Passives ({passives.length})</summary>
          <div className="classpect-list">
            {passives.map((entry) => (
              <ClasspectCard
                key={entry.id}
                entry={entry}
                onApplyCost={() => undefined}
                onSpendCharge={() => undefined}
                onMarkUsed={() => undefined}
              />
            ))}
          </div>
        </details>
      </section>
    );
  };

  const renderStrifeItem = () => (
    <section className="strife-submenu panel">
      <SubmenuHeader title="Items" onBack={() => setStrifeMenu("root")} />
      <div className="strife-item-list">
        {character.items.filter(isStrifeItem).map((item) => (
          <article className="strife-item-row" key={item.id}>
            <span className="item-icon">{item.icon}</span>
            <div>
              <p className="eyebrow">{costsLabel(item)}</p>
              <h3>{item.name}</h3>
              <p>{item.shortDescription}</p>
              {item.majorAffixes[0] ? (
                <small>Major: {item.majorAffixes[0].name}</small>
              ) : null}
            </div>
            <div className="strife-item-actions">
              <span>×{item.quantity}</span>
              <button
                className="button button-primary"
                onClick={() => setItemUseId(item.id)}
              >
                Preview changes
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );

  const acts = [
    {
      name: "Defend",
      cost: "1 AP",
      detail:
        "Mark Defend as active for personal reference. Resolve its defensive rules manually; this app does not alter incoming damage.",
      action: () =>
        commit(
          "Guard state set — Defend",
          { resourceType: "Guard state", operationType: "manual-tracking" },
          (draft) => {
            draft.guardState = "Defend";
          },
        ),
    },
    {
      name: "Dodge",
      cost: "1 AP",
      detail: `Current Triggerance Modifier: ${formatModifier(
        triggerance.modifier,
      )}. Mark Dodge active, then resolve enemy Hit Rolls manually.`,
      action: () =>
        commit(
          "Guard state set — Dodge",
          { resourceType: "Guard state", operationType: "manual-tracking" },
          (draft) => {
            draft.guardState = "Dodge";
          },
        ),
    },
    {
      name: "Spare",
      cost: "1 AP",
      detail: `Current Verballistamina Modifier: ${formatModifier(
        verballistamina.modifier,
      )}. Make the Spare attempt at the table; no roll occurs here.`,
    },
    {
      name: "Abscond",
      cost: "1 AP",
      detail:
        "Review the option, then resolve the Contest manually. Current Scamperway is shown in the Character page.",
    },
    {
      name: "Change Equipment",
      cost: "Table cost",
      detail:
        "Open the Equipment section of Inventory. Equipping recalculates persistent bonuses but never deducts AP automatically.",
      action: () => {
        setInventoryTab("equipment");
        setEquipmentFilter("Equipped");
        setSelectedSection("equipment");
      },
    },
    {
      name: "Custom Act",
      cost: "Manual AP note",
      detail:
        "Describe an improvised action in Turn Notes. The GM determines rolls, targets, costs, and outcomes.",
    },
    {
      name: "End Turn",
      cost: "0 AP",
      detail:
        "Reminder only: review Status notes, ongoing effects, Reactions, and table rulings. Nothing refreshes or ticks automatically.",
    },
  ];

  const renderStrifeAct = () => (
    <section className="strife-submenu panel">
      <SubmenuHeader title="Act" onBack={() => setStrifeMenu("root")} />
      <div className="act-grid">
        {acts.map((act) => (
          <details className="act-card" key={act.name}>
            <summary>
              <span>
                <small>{act.cost}</small>
                <strong>{act.name}</strong>
              </span>
              <i>+</i>
            </summary>
            <div>
              <p>{act.detail}</p>
              {act.action ? (
                <button className="button button-primary" onClick={act.action}>
                  {act.name === "Change Equipment"
                    ? "Open Inventory"
                    : `Mark ${act.name} active`}
                </button>
              ) : null}
            </div>
          </details>
        ))}
      </div>
    </section>
  );

  const renderStrife = () => (
    <div className="page-stack strife-page">
      <SectionHeading
        eyebrow="Personal combat reference"
        title="Strife"
        description="See your options, inspect their rules, and track only your own resources."
        action={
          <span className="guard-indicator">
            Guard state <strong>{character.guardState}</strong>
          </span>
        }
      />
      <section className="strife-resource-bar panel">
        <button onClick={() => openAdjustment("set-health", character.resources.currentHealth)}>
          <span>HP</span>
          <strong>
            {character.resources.currentHealth} / {maximumHealth}
          </strong>
        </button>
        <button onClick={() => openAdjustment("set-temp", character.resources.temporaryHealth)}>
          <span>Temp</span>
          <strong>{character.resources.temporaryHealth}</strong>
        </button>
        <button onClick={() => openAdjustment("set-pluck", character.resources.currentPluck)}>
          <span>Pluck</span>
          <strong>
            {character.resources.currentPluck} / {maximumPluck}
          </strong>
        </button>
        <StrifeCounter
          label="AP"
          value={character.resources.currentAP}
          detail={` / ${maximumAP}`}
          onChange={(value) => updateResource("currentAP", value)}
        />
        <StrifeCounter
          label="Surge"
          value={character.resources.surge}
          onChange={(value) => updateResource("surge", value)}
        />
        <StrifeCounter
          label="Stagger"
          value={character.resources.stagger}
          onChange={(value) => updateResource("stagger", value)}
        />
        <div className="strife-static-resource">
          <span>Doom</span>
          <strong>{character.resources.doomMarks} / 3</strong>
        </div>
      </section>
      <section className="strife-quickbar">{renderQuickActions()}</section>
      {renderStatusStrip()}
      <section className="turn-notes panel">
        <label htmlFor="turn-notes">
          <span>
            <strong>Player Turn Notes</strong>
            <small>Autosaved locally · free text only</small>
          </span>
          <textarea
            id="turn-notes"
            value={character.turnNotes}
            onChange={(event) =>
              setCharacter((current) => ({
                ...current,
                turnNotes: event.target.value,
              }))
            }
            placeholder="Targets, reactions, GM rulings, reminders…"
          />
        </label>
      </section>
      {strifeMenu === "root" ? renderStrifeRoot() : null}
      {strifeMenu === "weapon" ? renderStrifeWeapon() : null}
      {strifeMenu === "classpect" ? renderStrifeClasspect() : null}
      {strifeMenu === "item" ? renderStrifeItem() : null}
      {strifeMenu === "act" ? renderStrifeAct() : null}
    </div>
  );

  const adjustmentLabels: Record<
    AdjustmentKind,
    { title: string; description: string }
  > = {
    "health-loss": {
      title: "Lose Health",
      description:
        "Temporary Health is removed before Current Health. This is not damage.",
    },
    "hp-cost": {
      title: "Pay HP Cost",
      description:
        "Temporary Health is removed before Current Health. The listed effect is not resolved.",
    },
    heal: {
      title: "Apply Healing",
      description:
        "Healing affects Current Health, including negative Health, and normally stops at Maximum Health.",
    },
    "set-health": {
      title: "Set Health",
      description:
        "Replace Current Health with an exact value. Damage and healing rules are bypassed.",
    },
    "temp-gain": {
      title: "Add Temporary Health",
      description: "Add a separate buffer without changing Current Health.",
    },
    "temp-remove": {
      title: "Remove Temporary Health",
      description: "Remove only the Temporary Health buffer.",
    },
    "set-temp": {
      title: "Set Temporary Health",
      description: "Replace the Temporary Health buffer with an exact value.",
    },
    "pluck-cost": {
      title: "Pay Pluck Cost",
      description:
        "A voluntary cost may reduce Pluck below 0 after confirmation. Stasis and Saving Throws stay manual.",
    },
    "pluck-loss": {
      title: "Lose Pluck",
      description:
        "Forced Pluck loss stops at 0 unless the explicit override is enabled.",
    },
    "pluck-restore": {
      title: "Restore Pluck",
      description: "Restoration normally stops at Maximum Pluck.",
    },
    "set-pluck": {
      title: "Set Pluck",
      description: "Replace Current Pluck with an exact value.",
    },
  };

  return (
    <div className="app-shell">
      <aside className="desktop-sidebar">
        <div className="brand-mark">
          <span>SB</span>
          <div>
            <strong>SBURB</strong>
            <small>Character Manager</small>
          </div>
        </div>
        <nav aria-label="Primary navigation">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={selectedSection === item.id ? "active" : ""}
              onClick={() => setSelectedSection(item.id)}
              aria-current={selectedSection === item.id ? "page" : undefined}
            >
              <span>{item.short}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span>LOCAL PROTOTYPE</span>
          <a href="/gm">GM route preview →</a>
        </div>
      </aside>

      <div className="app-column">
        <header className="persistent-header">
          <div className="header-identity">
            <div
              className={`portrait-small ${
                character.identity.portraitUrl ? "has-image" : ""
              }`}
              style={
                character.identity.portraitUrl
                  ? {
                      backgroundImage: `url(${character.identity.portraitUrl})`,
                    }
                  : undefined
              }
              aria-hidden="true"
            >
              <span>{character.identity.portraitInitials}</span>
            </div>
            <div>
              <strong>{character.identity.characterName}</strong>
              <span>
                {character.identity.className} of {character.identity.aspectName}
                <i>·</i> Level {character.identity.level}
              </span>
            </div>
          </div>
          <div className="header-meters">
            <button
              className="header-meter health"
              onClick={() =>
                openAdjustment(
                  "set-health",
                  character.resources.currentHealth,
                )
              }
            >
              <span>Health Vial</span>
              <strong className="header-health-value">
                {character.resources.temporaryHealth > 0 ? (
                  <b className="header-temp-health">
                    {character.resources.temporaryHealth} +
                  </b>
                ) : null}
                {character.resources.currentHealth} / {maximumHealth}
              </strong>
            </button>
            <button
              className="header-meter pluck"
              onClick={() =>
                openAdjustment(
                  "set-pluck",
                  character.resources.currentPluck,
                )
              }
            >
              <span>Pluck</span>
              <strong>
                {character.resources.currentPluck} / {maximumPluck}
              </strong>
            </button>
          </div>
        </header>

        <main id="main-content" className="main-content">
          {selectedSection === "character" ? renderCharacter() : null}
          {selectedSection === "equipment" ? renderInventory() : null}
          {selectedSection === "classpect" ? renderClasspect() : null}
          {selectedSection === "strife" ? renderStrife() : null}
        </main>
      </div>

      <nav className="mobile-nav" aria-label="Primary navigation">
        {navItems.map((item) => (
          <button
            key={item.id}
            className={selectedSection === item.id ? "active" : ""}
            onClick={() => setSelectedSection(item.id)}
            aria-current={selectedSection === item.id ? "page" : undefined}
          >
            <span>{item.short}</span>
            {item.label}
          </button>
        ))}
      </nav>

      {toast ? (
        <div className="toast" role="status">
          <span>✓</span>
          <p>{toast}</p>
          {undoStack.length ? (
            <button onClick={undoLast}>Undo</button>
          ) : null}
        </div>
      ) : null}

      {characterDraft ? (
        <CharacterEditor
          draft={characterDraft}
          onChange={setCharacterDraft}
          onSave={saveCharacterEditor}
          onClose={() => setCharacterDraft(null)}
        />
      ) : null}

      {itemEditor ? (
        <ItemEditor
          state={itemEditor}
          onChange={setItemEditor}
          onSave={saveItemEditor}
          onClose={() => setItemEditor(null)}
        />
      ) : null}

      {classpectEditor ? (
        <ClasspectEditor
          state={classpectEditor}
          onChange={setClasspectEditor}
          onSave={saveClasspectEditor}
          onClose={() => setClasspectEditor(null)}
        />
      ) : null}

      {adjustment ? (
        <AdjustmentModal
          request={adjustment}
          labels={adjustmentLabels[adjustment.kind]}
          maximumHealth={maximumHealth}
          maximumPluck={maximumPluck}
          preview={getAdjustmentPreview}
          onRequestChange={setAdjustment}
          onApply={applyAdjustment}
          onClose={() => setAdjustment(null)}
        />
      ) : null}

      {damageOpen ? (
        <ModalFrame
          eyebrow="Final amount from the GM"
          title="Incoming Damage"
          onClose={() => setDamageOpen(false)}
        >
          <div className="modal-body">
            <div className="form-grid">
              <label className="field">
                <span>Damage amount</span>
                <input
                  type="number"
                  min={0}
                  value={damageAmount}
                  onChange={(event) =>
                    setDamageAmount(Math.max(0, Number(event.target.value) || 0))
                  }
                />
              </label>
              <label className="field">
                <span>Damage type</span>
                <select
                  value={damageType}
                  onChange={(event) =>
                    setDamageType(
                      event.target.value as typeof damageType,
                    )
                  }
                >
                  <option>Physical</option>
                  <option>Special</option>
                  <option>True</option>
                  <option>Unmitigated</option>
                </select>
              </label>
              <label className="field">
                <span>Damage property</span>
                <select
                  value={damageProperty}
                  onChange={(event) =>
                    setDamageProperty(
                      event.target.value as typeof damageProperty,
                    )
                  }
                  disabled={
                    damageType === "True" || damageType === "Unmitigated"
                  }
                >
                  <option>None</option>
                  <option>Piercing</option>
                </select>
              </label>
            </div>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={manualDefense}
                onChange={(event) => setManualDefense(event.target.checked)}
                disabled={
                  damageType === "True" || damageType === "Unmitigated"
                }
              />
              <span>
                <strong>Use manual defense override</strong>
                <small>
                  Account for temporary defenses, reductions, Affixes, or a GM
                  ruling.
                </small>
              </span>
            </label>
            {manualDefense &&
            damageType !== "True" &&
            damageType !== "Unmitigated" ? (
              <label className="field">
                <span>Defense to subtract</span>
                <input
                  type="number"
                  value={manualDefenseValue}
                  onChange={(event) =>
                    setManualDefenseValue(Number(event.target.value) || 0)
                  }
                />
              </label>
            ) : null}
            <div className="calculation-preview">
              <div>
                <span>Incoming Damage</span>
                <strong>
                  {damagePreview.incoming} {damageType}
                </strong>
              </div>
              {damageType === "Physical" || damageType === "Special" ? (
                <div>
                  <span>
                    {damageType === "Physical"
                      ? "Gel Viscosity Modifier"
                      : "Moxie Muffling Modifier"}
                    {damageProperty === "Piercing" ? " · Piercing" : ""}
                    {manualDefense ? " · Override" : ""}
                  </span>
                  <strong>−{damagePreview.defenseUsed}</strong>
                </div>
              ) : (
                <div>
                  <span>Ordinary defense</span>
                  <strong>Ignored</strong>
                </div>
              )}
              <div className="preview-total">
                <span>Final Damage</span>
                <strong>{damagePreview.finalDamage}</strong>
              </div>
              <div>
                <span>Temporary Health Used</span>
                <strong>{damagePreview.tempUsed}</strong>
              </div>
              <div>
                <span>Health Vial Lost</span>
                <strong>{damagePreview.healthLost}</strong>
              </div>
              <div className="preview-result">
                <span>Resulting Health</span>
                <strong>
                  {damagePreview.resultingHealth} / {maximumHealth}
                  <small> · {damagePreview.resultingTemp} Temp</small>
                </strong>
              </div>
            </div>
            <p className="automation-note">
              No Status, passive effect, target, Saving Throw, or trigger is
              resolved.
            </p>
          </div>
          <footer className="modal-actions">
            <button
              className="button button-quiet"
              onClick={() => setDamageOpen(false)}
            >
              Cancel
            </button>
            <button className="button button-health" onClick={applyDamage}>
              Confirm & apply {damagePreview.finalDamage} damage
            </button>
          </footer>
        </ModalFrame>
      ) : null}

      {costRequest ? (
        <ModalFrame
          eyebrow="Listed meter cost only"
          title={`Apply cost — ${costRequest.source}`}
          onClose={() => setCostRequest(null)}
        >
          <div className="modal-body">
            <div className="calculation-preview">
              {costRequest.healthCost ? (
                <>
                  <div>
                    <span>HP cost</span>
                    <strong>−{costRequest.healthCost}</strong>
                  </div>
                  <div>
                    <span>Temporary Health</span>
                    <strong>
                      {character.resources.temporaryHealth} →{" "}
                      {Math.max(
                        0,
                        character.resources.temporaryHealth -
                          costRequest.healthCost,
                      )}
                    </strong>
                  </div>
                  <div>
                    <span>Current Health</span>
                    <strong>
                      {character.resources.currentHealth} →{" "}
                      {character.resources.currentHealth -
                        Math.max(
                          0,
                          costRequest.healthCost -
                            character.resources.temporaryHealth,
                        )}
                    </strong>
                  </div>
                </>
              ) : null}
              {costRequest.pluckCost ? (
                <div
                  className={
                    character.resources.currentPluck - costRequest.pluckCost < 0
                      ? "warning-row"
                      : ""
                  }
                >
                  <span>Pluck cost</span>
                  <strong>
                    {character.resources.currentPluck} →{" "}
                    {character.resources.currentPluck - costRequest.pluckCost}
                  </strong>
                </div>
              ) : null}
            </div>
            {character.resources.currentPluck - costRequest.pluckCost < 0 ? (
              <p className="warning-callout">
                This cost will reduce Pluck below 0. Any Stasis or Saving Throw
                remains a manual tabletop ruling.
              </p>
            ) : null}
            <p className="automation-note">
              AP, targets, rolls, damage, timing, and the listed effect are not
              resolved.
            </p>
          </div>
          <footer className="modal-actions">
            <button
              className="button button-quiet"
              onClick={() => setCostRequest(null)}
            >
              Cancel
            </button>
            <button
              className="button button-primary"
              onClick={() => applyCombinedCost(costRequest)}
            >
              Confirm listed cost
            </button>
          </footer>
        </ModalFrame>
      ) : null}

      {itemUse ? (
        <ModalFrame
          eyebrow="Simple listed operations only"
          title={`Preview — ${itemUse.name}`}
          onClose={() => setItemUseId(null)}
        >
          <div className="modal-body">
            <p>{itemUse.shortDescription}</p>
            <div className="calculation-preview">
              {itemUse.healthCost ? (
                <div>
                  <span>HP cost</span>
                  <strong>−{itemUse.healthCost}</strong>
                </div>
              ) : null}
              {itemUse.pluckCost ? (
                <div>
                  <span>Pluck cost</span>
                  <strong>−{itemUse.pluckCost}</strong>
                </div>
              ) : null}
              {itemUse.healingAmount ? (
                <div>
                  <span>Healing</span>
                  <strong>
                    {character.resources.currentHealth} →{" "}
                    {Math.min(
                      maximumHealth,
                      character.resources.currentHealth +
                        itemUse.healingAmount,
                    )}
                  </strong>
                </div>
              ) : null}
              {itemUse.pluckRestorationAmount ? (
                <div>
                  <span>Pluck restoration</span>
                  <strong>
                    {character.resources.currentPluck} →{" "}
                    {Math.min(
                      maximumPluck,
                      character.resources.currentPluck +
                        itemUse.pluckRestorationAmount,
                    )}
                  </strong>
                </div>
              ) : null}
              {itemUse.temporaryHealthAmount ? (
                <div>
                  <span>Temporary Health</span>
                  <strong>
                    {character.resources.temporaryHealth} →{" "}
                    {character.resources.temporaryHealth +
                      itemUse.temporaryHealthAmount}
                  </strong>
                </div>
              ) : null}
              {itemUse.consumable ? (
                <div>
                  <span>Quantity</span>
                  <strong>
                    {itemUse.quantity} → {Math.max(0, itemUse.quantity - 1)}
                  </strong>
                </div>
              ) : null}
              {itemUse.remainingCharges !== undefined ? (
                <div>
                  <span>Charges</span>
                  <strong>
                    {itemUse.remainingCharges} →{" "}
                    {Math.max(0, itemUse.remainingCharges - 1)}
                  </strong>
                </div>
              ) : null}
            </div>
            <p className="automation-note">
              AP, targets, Statuses, buffs, Saving Throws, durations, reactions,
              and conditional effects are not resolved.
            </p>
          </div>
          <footer className="modal-actions">
            <button
              className="button button-quiet"
              onClick={() => setItemUseId(null)}
            >
              Cancel
            </button>
            <button
              className="button button-primary"
              onClick={() => applyItemUse(itemUse)}
              disabled={
                (itemUse.consumable && itemUse.quantity <= 0) ||
                (itemUse.remainingCharges !== undefined &&
                  itemUse.remainingCharges <= 0)
              }
            >
              Confirm listed changes
            </button>
          </footer>
        </ModalFrame>
      ) : null}

      {statOverride ? (
        <ModalFrame
          eyebrow="Player-controlled calculation"
          title={`Override ${
            statDefinitions.find((entry) => entry.id === statOverride.statId)
              ?.name ?? "Stat"
          }`}
          onClose={() => setStatOverride(null)}
        >
          <div className="modal-body">
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={statOverride.enabled}
                onChange={(event) =>
                  setStatOverride({
                    ...statOverride,
                    enabled: event.target.checked,
                  })
                }
              />
              <span>
                <strong>Enable manual Total and Modifier</strong>
                <small>
                  Base and calculated values remain visible in the breakdown.
                </small>
              </span>
            </label>
            <div className="form-grid">
              <label className="field">
                <span>Manual Total</span>
                <input
                  type="number"
                  value={statOverride.total}
                  disabled={!statOverride.enabled}
                  onChange={(event) =>
                    setStatOverride({
                      ...statOverride,
                      total: Number(event.target.value) || 0,
                    })
                  }
                />
              </label>
              <label className="field">
                <span>Manual Modifier</span>
                <input
                  type="number"
                  value={statOverride.modifier}
                  disabled={!statOverride.enabled}
                  onChange={(event) =>
                    setStatOverride({
                      ...statOverride,
                      modifier: Number(event.target.value) || 0,
                    })
                  }
                />
              </label>
            </div>
          </div>
          <footer className="modal-actions">
            <button
              className="button button-quiet"
              onClick={() => setStatOverride(null)}
            >
              Cancel
            </button>
            <button
              className="button button-primary"
              onClick={() => saveStatOverride(statOverride)}
            >
              Save manual override
            </button>
          </footer>
        </ModalFrame>
      ) : null}

      {statusDraft ? (
        <ModalFrame
          eyebrow="Reference note only"
          title="Add Active Status"
          onClose={() => setStatusDraft(null)}
        >
          <div className="modal-body">
            <div className="form-grid">
              <label className="field">
                <span>Status name</span>
                <input
                  list="status-suggestions"
                  value={statusDraft.statusName}
                  onChange={(event) =>
                    setStatusDraft({
                      ...statusDraft,
                      statusName: event.target.value,
                    })
                  }
                />
                <datalist id="status-suggestions">
                  {statusSuggestions.map((status) => (
                    <option value={status} key={status} />
                  ))}
                </datalist>
              </label>
              <label className="field">
                <span>Potency</span>
                <input
                  placeholder="d4, 2, etc."
                  value={statusDraft.potency}
                  onChange={(event) =>
                    setStatusDraft({
                      ...statusDraft,
                      potency: event.target.value,
                    })
                  }
                />
              </label>
              <label className="field">
                <span>Remaining duration</span>
                <input
                  type="number"
                  min={0}
                  value={statusDraft.remainingDuration}
                  onChange={(event) =>
                    setStatusDraft({
                      ...statusDraft,
                      remainingDuration: event.target.value,
                    })
                  }
                />
              </label>
              <label className="field">
                <span>Duration type</span>
                <input
                  value={statusDraft.durationType}
                  onChange={(event) =>
                    setStatusDraft({
                      ...statusDraft,
                      durationType: event.target.value,
                    })
                  }
                />
              </label>
              <label className="field">
                <span>Save Stat</span>
                <input
                  value={statusDraft.saveStat}
                  onChange={(event) =>
                    setStatusDraft({
                      ...statusDraft,
                      saveStat: event.target.value,
                    })
                  }
                />
              </label>
              <label className="field">
                <span>Save DC</span>
                <input
                  type="number"
                  value={statusDraft.saveDC}
                  onChange={(event) =>
                    setStatusDraft({
                      ...statusDraft,
                      saveDC: event.target.value,
                    })
                  }
                />
              </label>
            </div>
            <label className="field">
              <span>Source</span>
              <input
                value={statusDraft.source}
                onChange={(event) =>
                  setStatusDraft({
                    ...statusDraft,
                    source: event.target.value,
                  })
                }
              />
            </label>
            <label className="field">
              <span>Notes</span>
              <textarea
                value={statusDraft.notes}
                onChange={(event) =>
                  setStatusDraft({
                    ...statusDraft,
                    notes: event.target.value,
                  })
                }
              />
            </label>
            <p className="automation-note">
              Durations, saves, damage, restrictions, and Stat changes remain
              manual.
            </p>
          </div>
          <footer className="modal-actions">
            <button
              className="button button-quiet"
              onClick={() => setStatusDraft(null)}
            >
              Cancel
            </button>
            <button
              className="button button-primary"
              onClick={() => addStatus(statusDraft)}
            >
              Add Status note
            </button>
          </footer>
        </ModalFrame>
      ) : null}

      {confirmRequest ? (
        <ModalFrame
          eyebrow="Confirmation required"
          title={confirmRequest.title}
          onClose={() => setConfirmRequest(null)}
        >
          <div className="modal-body">
            <p>{confirmRequest.description}</p>
          </div>
          <footer className="modal-actions">
            <button
              className="button button-quiet"
              onClick={() => setConfirmRequest(null)}
            >
              Cancel
            </button>
            <button
              className="button button-danger"
              onClick={confirmRequest.action}
            >
              {confirmRequest.confirmLabel}
            </button>
          </footer>
        </ModalFrame>
      ) : null}
    </div>
  );
}

function CategoryFilters({
  value,
  onChange,
}: {
  value: (typeof classpectCategories)[number];
  onChange: (value: (typeof classpectCategories)[number]) => void;
}) {
  return (
    <div className="mini-filter-row" aria-label="Filter by category">
      {classpectCategories.map((category) => (
        <button
          key={category}
          className={value === category ? "active" : ""}
          onClick={() => onChange(category)}
        >
          {category}
        </button>
      ))}
    </div>
  );
}

function SubmenuHeader({
  title,
  onBack,
}: {
  title: string;
  onBack: () => void;
}) {
  return (
    <header className="submenu-header">
      <button className="button button-quiet" onClick={onBack}>
        ← Back
      </button>
      <div>
        <p className="eyebrow">Strife menu</p>
        <h2>{title}</h2>
      </div>
      <span>Reference mode</span>
    </header>
  );
}

function AdjustmentModal({
  request,
  labels,
  maximumHealth,
  maximumPluck,
  preview,
  onRequestChange,
  onApply,
  onClose,
}: {
  request: AdjustmentRequest;
  labels: { title: string; description: string };
  maximumHealth: number;
  maximumPluck: number;
  preview: (
    request: AdjustmentRequest,
    allowLossBelowZero?: boolean,
    ignoreMaximum?: boolean,
  ) => {
    beforeHealth: number;
    beforeTemp: number;
    beforePluck: number;
    health: number;
    temp: number;
    pluck: number;
  };
  onRequestChange: (request: AdjustmentRequest) => void;
  onApply: (
    request: AdjustmentRequest,
    allowLossBelowZero: boolean,
    ignoreMaximum: boolean,
  ) => void;
  onClose: () => void;
}) {
  const [allowLossBelowZero, setAllowLossBelowZero] = useState(false);
  const [ignoreMaximum, setIgnoreMaximum] = useState(false);
  const result = preview(request, allowLossBelowZero, ignoreMaximum);
  const isPluck = request.kind.includes("pluck");
  const isTemp = request.kind.includes("temp");
  const isSet = request.kind.startsWith("set");
  const canIgnoreMaximum =
    request.kind === "heal" || request.kind === "pluck-restore";
  const current = isPluck
    ? result.beforePluck
    : isTemp
      ? result.beforeTemp
      : result.beforeHealth;
  const resulting = isPluck
    ? result.pluck
    : isTemp
      ? result.temp
      : result.health;
  const maximum = isPluck
    ? maximumPluck
    : isTemp
      ? undefined
      : maximumHealth;

  return (
    <ModalFrame
      eyebrow={request.source ?? "Manual resource control"}
      title={labels.title}
      onClose={onClose}
    >
      <div className="modal-body">
        <p>{labels.description}</p>
        <label className="field amount-field">
          <span>{isSet ? "Exact value" : "Change amount"}</span>
          <input
            type="number"
            min={isSet ? undefined : 0}
            value={request.amount}
            onChange={(event) =>
              onRequestChange({
                ...request,
                amount: Number(event.target.value) || 0,
              })
            }
          />
        </label>
        {request.kind === "pluck-loss" ? (
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={allowLossBelowZero}
              onChange={(event) =>
                setAllowLossBelowZero(event.target.checked)
              }
            />
            <span>
              <strong>Explicitly allow forced loss below 0</strong>
              <small>Use only for a Player or GM override.</small>
            </span>
          </label>
        ) : null}
        {canIgnoreMaximum ? (
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={ignoreMaximum}
              onChange={(event) => setIgnoreMaximum(event.target.checked)}
            />
            <span>
              <strong>Override maximum</strong>
              <small>Allow the resulting value to exceed its normal maximum.</small>
            </span>
          </label>
        ) : null}
        <div className="calculation-preview">
          <div>
            <span>Current value</span>
            <strong>{current}</strong>
          </div>
          {!isSet ? (
            <div>
              <span>Requested change</span>
              <strong>{request.amount}</strong>
            </div>
          ) : null}
          {maximum !== undefined ? (
            <div>
              <span>Maximum</span>
              <strong>{maximum}</strong>
            </div>
          ) : null}
          {(request.kind === "health-loss" || request.kind === "hp-cost") &&
          result.beforeTemp !== result.temp ? (
            <div>
              <span>Temporary Health</span>
              <strong>
                {result.beforeTemp} → {result.temp}
              </strong>
            </div>
          ) : null}
          <div className="preview-result">
            <span>Resulting value</span>
            <strong>
              {resulting}
              {maximum !== undefined ? ` / ${maximum}` : ""}
            </strong>
          </div>
        </div>
        {request.kind === "pluck-cost" && result.pluck < 0 ? (
          <p className="warning-callout">
            This cost will reduce Pluck below 0. Confirming is allowed; no Stasis
            or Saving Throw will be resolved.
          </p>
        ) : null}
      </div>
      <footer className="modal-actions">
        <button className="button button-quiet" onClick={onClose}>
          Cancel
        </button>
        <button
          className="button button-primary"
          onClick={() => onApply(request, allowLossBelowZero, ignoreMaximum)}
        >
          Confirm & apply
        </button>
      </footer>
    </ModalFrame>
  );
}
