"use client";

import {
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { statDefinitions } from "./seed";
import type {
  Affix,
  CharacterData,
  ClasspectCategory,
  ClasspectEntry,
  ClasspectEntryType,
  CustomStat,
  Item,
  ItemType,
  ModifierType,
  WeaponMove,
} from "./types";

export type ItemEditorState = {
  mode: "create" | "edit";
  item: Item;
};

export type ClasspectEditorState = {
  mode: "create" | "edit";
  entry: ClasspectEntry;
};

const itemTypes: ItemType[] = [
  "Weapon",
  "Armor",
  "Trinket",
  "Badge",
  "Consumable",
  "Utility Item",
  "Catalyst",
  "Quest Item",
  "Miscellaneous Item",
];

const classpectEntryTypes: ClasspectEntryType[] = [
  "Class Skill",
  "Aspect Ability",
];

const classpectCategories: ClasspectCategory[] = [
  "Active",
  "Passive",
  "Reaction",
  "Augment",
  "Transformation",
  "Other",
];

const modifierTypes: ModifierType[] = [
  "standard",
  "full-value",
  "manual",
  "informational",
];

const equipmentSlots = [
  "Head Armor",
  "Chest Armor",
  "Hand Armor",
  "Leg Armor",
  "Feet Armor",
  "Accessory Armor",
  "Trinket",
  "Badge",
];

const affixRanks: NonNullable<Affix["rank"]>[] = [
  "Rank I",
  "Rank II",
  "Rank III",
  "Rank IV",
  "Rank V",
];

function editorId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function optionalNumber(value: string) {
  return value === "" ? undefined : Number(value) || 0;
}

function lines(value?: string[]) {
  return value?.join("\n") ?? "";
}

function parseLines(value: string) {
  return value
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function reindex<T extends { displayOrder: number }>(entries: T[]) {
  return entries.map((entry, index) => ({
    ...entry,
    displayOrder: index + 1,
  }));
}

function moveEntry<T>(entries: T[], index: number, direction: -1 | 1) {
  const target = index + direction;
  if (target < 0 || target >= entries.length) return entries;
  const next = [...entries];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function blankAffix(isMajor: boolean): Affix {
  return {
    id: editorId(isMajor ? "major-affix" : "minor-affix"),
    name: "New Affix",
    rank: isMajor ? "Rank I" : undefined,
    shortSummary: "",
    rulesText: "",
    displayOrder: 1,
  };
}

function blankMove(): WeaponMove {
  return {
    id: editorId("weapon-move"),
    name: "New Weapon Move",
    apCost: 1,
    hitChance: "Set Hit Chance",
    comboChance: "Set Combo Chance",
    damageText: "Set damage",
    damageType: "Physical",
    targetText: "One target",
    rollText: "Resolve manually",
    effectText: "",
    displayOrder: 1,
  };
}

function blankCustomStat(displayOrder: number): CustomStat {
  return {
    id: editorId("custom-stat"),
    name: "New Custom Stat",
    description: "",
    value: 0,
    bonus: 0,
    modifierType: "manual",
    displayOrder,
  };
}

export function createBlankItem(
  itemType: ItemType = "Miscellaneous Item",
): Item {
  return {
    id: editorId("item"),
    name: itemType === "Weapon" ? "New Weapon" : "New Item",
    itemType,
    rarity: "Common",
    quantity: 1,
    shortDescription: "",
    fullDescription: "",
    equipped: false,
    consumable: itemType === "Consumable",
    statBonuses: [],
    majorAffixes: [],
    minorAffixes: [],
    weaponMoves: itemType === "Weapon" ? [] : undefined,
    icon: itemType === "Weapon" ? "WP" : "IT",
  };
}

export function duplicateItem(item: Item): Item {
  const next = structuredClone(item);
  next.id = editorId("item");
  next.name = `${item.name} Copy`;
  next.equipped = false;
  next.majorAffixes = next.majorAffixes.map((affix) => ({
    ...affix,
    id: editorId("major-affix"),
  }));
  next.minorAffixes = next.minorAffixes.map((affix) => ({
    ...affix,
    id: editorId("minor-affix"),
  }));
  next.weaponMoves = next.weaponMoves?.map((move) => ({
    ...move,
    id: editorId("weapon-move"),
  }));
  return next;
}

export function createBlankClasspectEntry(
  entryType: ClasspectEntryType,
  displayOrder: number,
): ClasspectEntry {
  return {
    id: editorId("classpect"),
    entryType,
    category: "Active",
    name:
      entryType === "Class Skill"
        ? "New Class Skill"
        : "New Aspect Ability",
    apCost: 1,
    effect: "",
    shortSummary: "",
    fullDescription: "",
    unlocked: true,
    displayOrder,
    explorationCompatible: false,
  };
}

export function duplicateClasspectEntry(
  entry: ClasspectEntry,
  displayOrder: number,
): ClasspectEntry {
  return {
    ...structuredClone(entry),
    id: editorId("classpect"),
    name: `${entry.name} Copy`,
    displayOrder,
    used: false,
  };
}

function EditorModal({
  eyebrow,
  title,
  onClose,
  children,
}: {
  eyebrow: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    closeRef.current?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div
      className="modal-backdrop editor-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="modal-sheet editor-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="player-editor-title"
      >
        <header className="modal-header">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h2 id="player-editor-title">{title}</h2>
          </div>
          <button
            ref={closeRef}
            className="icon-button"
            onClick={onClose}
            aria-label="Close editor"
          >
            ×
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function EditorSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <fieldset className="editor-section">
      <legend>{title}</legend>
      {description ? <p className="editor-section-copy">{description}</p> : null}
      {children}
    </fieldset>
  );
}

function OptionalNumberField({
  label,
  value,
  onChange,
  min,
}: {
  label: string;
  value?: number;
  onChange: (value?: number) => void;
  min?: number;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        value={value ?? ""}
        onChange={(event) => {
          const parsed = optionalNumber(event.target.value);
          onChange(
            parsed === undefined || min === undefined
              ? parsed
              : Math.max(min, parsed),
          );
        }}
      />
    </label>
  );
}

function TextListField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value?: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
}) {
  return (
    <label className="field field-wide">
      <span>{label}</span>
      <textarea
        value={lines(value)}
        placeholder={placeholder ?? "One entry per line"}
        onChange={(event) => onChange(parseLines(event.target.value))}
      />
    </label>
  );
}

export function CharacterEditor({
  draft,
  onChange,
  onSave,
  onClose,
}: {
  draft: CharacterData;
  onChange: (draft: CharacterData) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const updateIdentity = (
    key: keyof CharacterData["identity"],
    value: string | number | undefined,
  ) => {
    onChange({
      ...draft,
      identity: { ...draft.identity, [key]: value },
    });
  };

  const updateResource = (
    key: keyof CharacterData["resources"],
    value: number,
  ) => {
    onChange({
      ...draft,
      resources: { ...draft.resources, [key]: value },
    });
  };

  const updateStat = (
    index: number,
    key:
      | "baseValue"
      | "otherPersistentBonus"
      | "temporaryModifier"
      | "penalty"
      | "growthFormula",
    value: number | string,
  ) => {
    const stats = [...draft.stats];
    stats[index] = { ...stats[index], [key]: value };
    onChange({ ...draft, stats });
  };

  const updateCustomStat = (
    index: number,
    patch: Partial<CustomStat>,
  ) => {
    const customStats = [...draft.customStats];
    customStats[index] = { ...customStats[index], ...patch };
    onChange({ ...draft, customStats });
  };

  return (
    <EditorModal
      eyebrow="Player-Owned Character Data"
      title={`Edit ${draft.identity.characterName}`}
      onClose={onClose}
    >
      <div className="modal-body editor-body">
        <EditorSection title="Identity">
          <div className="form-grid">
            <label className="field">
              <span>Player Name</span>
              <input
                value={draft.identity.playerName}
                onChange={(event) =>
                  updateIdentity("playerName", event.target.value)
                }
              />
            </label>
            <label className="field">
              <span>Character Name</span>
              <input
                required
                value={draft.identity.characterName}
                onChange={(event) =>
                  updateIdentity("characterName", event.target.value)
                }
              />
            </label>
            <label className="field">
              <span>Portrait Initials</span>
              <input
                maxLength={3}
                value={draft.identity.portraitInitials}
                onChange={(event) =>
                  updateIdentity(
                    "portraitInitials",
                    event.target.value.toUpperCase(),
                  )
                }
              />
            </label>
            <label className="field">
              <span>Portrait Image URL</span>
              <input
                type="url"
                placeholder="Optional HTTPS image"
                value={draft.identity.portraitUrl ?? ""}
                onChange={(event) =>
                  updateIdentity(
                    "portraitUrl",
                    event.target.value || undefined,
                  )
                }
              />
            </label>
            <label className="field">
              <span>Class</span>
              <input
                value={draft.identity.className}
                onChange={(event) =>
                  updateIdentity("className", event.target.value)
                }
              />
            </label>
            <label className="field">
              <span>Aspect</span>
              <input
                value={draft.identity.aspectName}
                onChange={(event) =>
                  updateIdentity("aspectName", event.target.value)
                }
              />
            </label>
            <label className="field field-wide">
              <span>Class Description</span>
              <textarea
                value={draft.identity.classDescription ?? ""}
                onChange={(event) =>
                  updateIdentity("classDescription", event.target.value)
                }
              />
            </label>
            <label className="field field-wide">
              <span>Aspect Description</span>
              <textarea
                value={draft.identity.aspectDescription ?? ""}
                onChange={(event) =>
                  updateIdentity("aspectDescription", event.target.value)
                }
              />
            </label>
            <label className="field field-wide">
              <span>Land Name</span>
              <input
                value={draft.identity.landName}
                onChange={(event) =>
                  updateIdentity("landName", event.target.value)
                }
              />
            </label>
            <label className="field field-wide">
              <span>Character Notes</span>
              <textarea
                value={draft.identity.notes}
                onChange={(event) =>
                  updateIdentity("notes", event.target.value)
                }
              />
            </label>
          </div>
        </EditorSection>

        <EditorSection title="Progression and Campaign Resources">
          <div className="form-grid form-grid-three">
            {[
              ["level", "Echeladder Level"],
              ["currentExp", "Current EXP"],
            ].map(([key, label]) => (
              <label className="field" key={key}>
                <span>{label}</span>
                <input
                  type="number"
                  min={key === "level" ? 1 : 0}
                  max={key === "level" ? 20 : undefined}
                  value={draft.identity[key as keyof typeof draft.identity] as number}
                  onChange={(event) =>
                    updateIdentity(
                      key as keyof typeof draft.identity,
                      key === "level"
                        ? Math.max(
                            1,
                            Math.min(
                              20,
                              Math.trunc(Number(event.target.value) || 1),
                            ),
                          )
                        : Math.max(0, Number(event.target.value) || 0),
                    )
                  }
                />
              </label>
            ))}
            <label className="field">
              <span>Maximum Short Rests</span>
              <input
                type="number"
                min={0}
                value={draft.resources.maximumShortRests}
                onChange={(event) =>
                  updateResource(
                    "maximumShortRests",
                    Math.max(0, Math.trunc(Number(event.target.value) || 0)),
                  )
                }
              />
            </label>
          </div>
        </EditorSection>

        <EditorSection title="Persistent Resource Foundations">
          <div className="form-grid form-grid-three">
            <label className="field">
              <span>Base Maximum Health</span>
              <input
                type="number"
                min={0}
                value={draft.resources.baseMaximumHealth}
                onChange={(event) =>
                  updateResource(
                    "baseMaximumHealth",
                    Math.max(0, Number(event.target.value) || 0),
                  )
                }
              />
            </label>
            <label className="field">
              <span>Base Maximum Pluck</span>
              <input
                type="number"
                min={0}
                value={draft.resources.baseMaximumPluck}
                onChange={(event) =>
                  updateResource(
                    "baseMaximumPluck",
                    Math.max(0, Number(event.target.value) || 0),
                  )
                }
              />
            </label>
          </div>
        </EditorSection>

        <EditorSection
          title="Standard Stats"
          description="Equipment bonuses remain calculated from currently equipped items."
        >
          <div className="stat-editor-list">
            {draft.stats.map((stat, index) => {
              const definition = statDefinitions.find(
                (entry) => entry.id === stat.definitionId,
              );
              return (
                <article className="stat-editor-row" key={stat.definitionId}>
                  <div>
                    <strong>{definition?.name ?? stat.definitionId}</strong>
                    <small>{definition?.category}</small>
                  </div>
                  <label>
                    <span>Base</span>
                    <input
                      type="number"
                      value={stat.baseValue}
                      onChange={(event) =>
                        updateStat(
                          index,
                          "baseValue",
                          Number(event.target.value) || 0,
                        )
                      }
                    />
                  </label>
                  <label>
                    <span>Persistent</span>
                    <input
                      type="number"
                      value={stat.otherPersistentBonus}
                      onChange={(event) =>
                        updateStat(
                          index,
                          "otherPersistentBonus",
                          Number(event.target.value) || 0,
                        )
                      }
                    />
                  </label>
                  <label>
                    <span>Temporary</span>
                    <input
                      type="number"
                      value={stat.temporaryModifier}
                      onChange={(event) =>
                        updateStat(
                          index,
                          "temporaryModifier",
                          Number(event.target.value) || 0,
                        )
                      }
                    />
                  </label>
                  <label>
                    <span>Penalty</span>
                    <input
                      type="number"
                      min={0}
                      value={stat.penalty}
                      onChange={(event) =>
                        updateStat(
                          index,
                          "penalty",
                          Math.max(0, Number(event.target.value) || 0),
                        )
                      }
                    />
                  </label>
                  <label>
                    <span>Growth</span>
                    <input
                      value={stat.growthFormula ?? ""}
                      onChange={(event) =>
                        updateStat(index, "growthFormula", event.target.value)
                      }
                    />
                  </label>
                </article>
              );
            })}
          </div>
        </EditorSection>

        <EditorSection
          title="Custom Stats"
          description="Custom Stats can use standard, full-value, manual, or informational behavior."
        >
          <div className="nested-editor-list">
            {draft.customStats.map((stat, index) => (
              <details className="nested-editor" open key={stat.id}>
                <summary>
                  <strong>{stat.name}</strong>
                  <span>{stat.modifierType}</span>
                </summary>
                <div className="nested-editor-body">
                  <div className="form-grid">
                    <label className="field">
                      <span>Name</span>
                      <input
                        value={stat.name}
                        onChange={(event) =>
                          updateCustomStat(index, { name: event.target.value })
                        }
                      />
                    </label>
                    <label className="field">
                      <span>Modifier Behavior</span>
                      <select
                        value={stat.modifierType}
                        onChange={(event) =>
                          updateCustomStat(index, {
                            modifierType: event.target.value as ModifierType,
                          })
                        }
                      >
                        {modifierTypes.map((type) => (
                          <option value={type} key={type}>
                            {type}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>Current Value</span>
                      <input
                        type="number"
                        value={stat.value}
                        onChange={(event) =>
                          updateCustomStat(index, {
                            value: Number(event.target.value) || 0,
                          })
                        }
                      />
                    </label>
                    <label className="field">
                      <span>Modifier or Bonus</span>
                      <input
                        type="number"
                        value={stat.bonus}
                        onChange={(event) =>
                          updateCustomStat(index, {
                            bonus: Number(event.target.value) || 0,
                          })
                        }
                      />
                    </label>
                    <label className="field">
                      <span>Linked Standard Stat</span>
                      <select
                        value={stat.linkedStandardStat ?? ""}
                        onChange={(event) =>
                          updateCustomStat(index, {
                            linkedStandardStat:
                              event.target.value || undefined,
                          })
                        }
                      >
                        <option value="">None</option>
                        {statDefinitions.map((definition) => (
                          <option value={definition.id} key={definition.id}>
                            {definition.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>Growth Information</span>
                      <input
                        value={stat.growthInfo ?? ""}
                        onChange={(event) =>
                          updateCustomStat(index, {
                            growthInfo: event.target.value || undefined,
                          })
                        }
                      />
                    </label>
                    <label className="field field-wide">
                      <span>Description</span>
                      <textarea
                        value={stat.description}
                        onChange={(event) =>
                          updateCustomStat(index, {
                            description: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label className="field field-wide">
                      <span>Notes</span>
                      <textarea
                        value={stat.notes ?? ""}
                        onChange={(event) =>
                          updateCustomStat(index, {
                            notes: event.target.value || undefined,
                          })
                        }
                      />
                    </label>
                  </div>
                  <div className="nested-editor-actions">
                    <button
                      className="button button-quiet"
                      onClick={() =>
                        onChange({
                          ...draft,
                          customStats: reindex(
                            moveEntry(draft.customStats, index, -1),
                          ),
                        })
                      }
                      disabled={index === 0}
                    >
                      Move Up
                    </button>
                    <button
                      className="button button-quiet"
                      onClick={() =>
                        onChange({
                          ...draft,
                          customStats: reindex(
                            moveEntry(draft.customStats, index, 1),
                          ),
                        })
                      }
                      disabled={index === draft.customStats.length - 1}
                    >
                      Move Down
                    </button>
                    <button
                      className="button button-danger"
                      onClick={() =>
                        onChange({
                          ...draft,
                          customStats: reindex(
                            draft.customStats.filter(
                              (entry) => entry.id !== stat.id,
                            ),
                          ),
                        })
                      }
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </details>
            ))}
          </div>
          <button
            className="button button-muted"
            onClick={() =>
              onChange({
                ...draft,
                customStats: [
                  ...draft.customStats,
                  blankCustomStat(draft.customStats.length + 1),
                ],
              })
            }
          >
            + Add Custom Stat
          </button>
        </EditorSection>
      </div>
      <footer className="modal-actions">
        <button className="button button-quiet" onClick={onClose}>
          Cancel
        </button>
        <button
          className="button button-primary"
          onClick={onSave}
          disabled={!draft.identity.characterName.trim()}
        >
          Save Character Sheet
        </button>
      </footer>
    </EditorModal>
  );
}

function AffixEditorList({
  title,
  affixes,
  major,
  onChange,
}: {
  title: string;
  affixes: Affix[];
  major: boolean;
  onChange: (affixes: Affix[]) => void;
}) {
  const update = (index: number, patch: Partial<Affix>) => {
    const next = [...affixes];
    next[index] = { ...next[index], ...patch };
    onChange(next);
  };

  return (
    <EditorSection
      title={title}
      description={
        major
          ? "Most items use zero or one, but unusual items may have more."
          : "Add as many optional Minor Affixes as the item needs."
      }
    >
      <div className="nested-editor-list">
        {affixes.map((affix, index) => (
          <details className="nested-editor" key={affix.id}>
            <summary>
              <strong>{affix.name}</strong>
              <span>{affix.rank ?? "Unranked"}</span>
            </summary>
            <div className="nested-editor-body">
              <div className="form-grid">
                <label className="field">
                  <span>Affix name</span>
                  <input
                    value={affix.name}
                    onChange={(event) =>
                      update(index, { name: event.target.value })
                    }
                  />
                </label>
                {major ? (
                  <label className="field">
                    <span>Rank</span>
                    <select
                      value={affix.rank ?? ""}
                      onChange={(event) =>
                        update(index, {
                          rank:
                            (event.target.value as Affix["rank"]) || undefined,
                        })
                      }
                    >
                      <option value="">No rank</option>
                      {affixRanks.map((rank) => (
                        <option value={rank} key={rank}>
                          {rank}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <label className="field">
                  <span>Timing or trigger</span>
                  <input
                    value={affix.timing ?? ""}
                    onChange={(event) =>
                      update(index, {
                        timing: event.target.value || undefined,
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>Saving Throw Stat</span>
                  <input
                    value={affix.saveStat ?? ""}
                    onChange={(event) =>
                      update(index, {
                        saveStat: event.target.value || undefined,
                      })
                    }
                  />
                </label>
                <OptionalNumberField
                  label="Saving Throw DC"
                  value={affix.saveDC}
                  onChange={(value) => update(index, { saveDC: value })}
                />
                <OptionalNumberField
                  label="AP cost"
                  value={affix.apCost}
                  min={0}
                  onChange={(value) => update(index, { apCost: value })}
                />
                <OptionalNumberField
                  label="HP cost"
                  value={affix.healthCost}
                  min={0}
                  onChange={(value) => update(index, { healthCost: value })}
                />
                <OptionalNumberField
                  label="Pluck cost"
                  value={affix.pluckCost}
                  min={0}
                  onChange={(value) => update(index, { pluckCost: value })}
                />
                <label className="field">
                  <span>Usage limit</span>
                  <input
                    value={affix.usageLimit ?? ""}
                    onChange={(event) =>
                      update(index, {
                        usageLimit: event.target.value || undefined,
                      })
                    }
                  />
                </label>
                <OptionalNumberField
                  label="Maximum charges"
                  value={affix.maximumCharges}
                  min={0}
                  onChange={(value) =>
                    update(index, {
                      maximumCharges: value,
                      currentCharges:
                        value === undefined
                          ? undefined
                          : Math.min(affix.currentCharges ?? value, value),
                    })
                  }
                />
                <OptionalNumberField
                  label="Current charges"
                  value={affix.currentCharges}
                  min={0}
                  onChange={(value) => update(index, { currentCharges: value })}
                />
                <label className="field">
                  <span>Recovery Type</span>
                  <select
                    value={affix.recoveryType ?? ""}
                    onChange={(event) =>
                      update(index, {
                        recoveryType: event.target.value || undefined,
                      })
                    }
                  >
                    <option value="">No Automatic Recovery</option>
                    <option value="Short Rest">Short Rest</option>
                    <option value="Long Rest">Long Rest</option>
                  </select>
                </label>
                <label className="field field-wide">
                  <span>Short summary</span>
                  <textarea
                    value={affix.shortSummary}
                    onChange={(event) =>
                      update(index, { shortSummary: event.target.value })
                    }
                  />
                </label>
                <label className="field field-wide">
                  <span>Full rules text</span>
                  <textarea
                    value={affix.rulesText}
                    onChange={(event) =>
                      update(index, { rulesText: event.target.value })
                    }
                  />
                </label>
              </div>
              <div className="nested-editor-actions">
                <button
                  className="button button-quiet"
                  onClick={() => onChange(reindex(moveEntry(affixes, index, -1)))}
                  disabled={index === 0}
                >
                  Move up
                </button>
                <button
                  className="button button-quiet"
                  onClick={() => onChange(reindex(moveEntry(affixes, index, 1)))}
                  disabled={index === affixes.length - 1}
                >
                  Move down
                </button>
                <button
                  className="button button-muted"
                  onClick={() =>
                    onChange(
                      reindex([
                        ...affixes,
                        {
                          ...structuredClone(affix),
                          id: editorId(major ? "major-affix" : "minor-affix"),
                          name: `${affix.name} Copy`,
                        },
                      ]),
                    )
                  }
                >
                  Duplicate
                </button>
                <button
                  className="button button-danger"
                  onClick={() =>
                    onChange(
                      reindex(
                        affixes.filter((entry) => entry.id !== affix.id),
                      ),
                    )
                  }
                >
                  Remove
                </button>
              </div>
            </div>
          </details>
        ))}
      </div>
      <button
        className="button button-muted"
        onClick={() =>
          onChange(
            reindex([
              ...affixes,
              { ...blankAffix(major), displayOrder: affixes.length + 1 },
            ]),
          )
        }
      >
        + Add {major ? "Major" : "Minor"} Affix
      </button>
    </EditorSection>
  );
}

function WeaponMoveEditorList({
  moves,
  onChange,
}: {
  moves: WeaponMove[];
  onChange: (moves: WeaponMove[]) => void;
}) {
  const update = (index: number, patch: Partial<WeaponMove>) => {
    const next = [...moves];
    next[index] = { ...next[index], ...patch };
    onChange(next);
  };

  return (
    <EditorSection
      title="Weapon Moves"
      description="Moves remain rules references. Saving them never rolls, targets, spends AP, or resolves effects."
    >
      <div className="nested-editor-list">
        {moves.map((move, index) => (
          <details className="nested-editor" key={move.id}>
            <summary>
              <strong>{move.name}</strong>
              <span>{move.apCost} AP</span>
            </summary>
            <div className="nested-editor-body">
              <div className="form-grid form-grid-three">
                <label className="field">
                  <span>Move name</span>
                  <input
                    value={move.name}
                    onChange={(event) =>
                      update(index, { name: event.target.value })
                    }
                  />
                </label>
                <label className="field">
                  <span>AP cost</span>
                  <input
                    type="number"
                    min={0}
                    value={move.apCost}
                    onChange={(event) =>
                      update(index, {
                        apCost: Math.max(0, Number(event.target.value) || 0),
                      })
                    }
                  />
                </label>
                <OptionalNumberField
                  label="HP cost"
                  value={move.healthCost}
                  min={0}
                  onChange={(value) => update(index, { healthCost: value })}
                />
                <OptionalNumberField
                  label="Pluck cost"
                  value={move.pluckCost}
                  min={0}
                  onChange={(value) => update(index, { pluckCost: value })}
                />
                <label className="field">
                  <span>Hit Chance</span>
                  <input
                    value={move.hitChance}
                    onChange={(event) =>
                      update(index, { hitChance: event.target.value })
                    }
                  />
                </label>
                <label className="field">
                  <span>Combo Chance</span>
                  <input
                    value={move.comboChance}
                    onChange={(event) =>
                      update(index, { comboChance: event.target.value })
                    }
                  />
                </label>
                <label className="field">
                  <span>Damage text</span>
                  <input
                    value={move.damageText}
                    onChange={(event) =>
                      update(index, { damageText: event.target.value })
                    }
                  />
                </label>
                <label className="field">
                  <span>Damage type</span>
                  <input
                    value={move.damageType}
                    onChange={(event) =>
                      update(index, { damageType: event.target.value })
                    }
                  />
                </label>
                <label className="field">
                  <span>Targets</span>
                  <input
                    value={move.targetText}
                    onChange={(event) =>
                      update(index, { targetText: event.target.value })
                    }
                  />
                </label>
                <label className="field">
                  <span>Saving Throw Stat</span>
                  <input
                    value={move.saveStat ?? ""}
                    onChange={(event) =>
                      update(index, {
                        saveStat: event.target.value || undefined,
                      })
                    }
                  />
                </label>
                <OptionalNumberField
                  label="Saving Throw DC"
                  value={move.saveDC}
                  onChange={(value) => update(index, { saveDC: value })}
                />
                <label className="field">
                  <span>Duration</span>
                  <input
                    value={move.durationText ?? ""}
                    onChange={(event) =>
                      update(index, {
                        durationText: event.target.value || undefined,
                      })
                    }
                  />
                </label>
                <label className="field">
                  <span>Usage limit</span>
                  <input
                    value={move.usageLimit ?? ""}
                    onChange={(event) =>
                      update(index, {
                        usageLimit: event.target.value || undefined,
                      })
                    }
                  />
                </label>
                <OptionalNumberField
                  label="Maximum charges"
                  value={move.maximumCharges}
                  min={0}
                  onChange={(value) =>
                    update(index, {
                      maximumCharges: value,
                      currentCharges:
                        value === undefined
                          ? undefined
                          : Math.min(move.currentCharges ?? value, value),
                    })
                  }
                />
                <OptionalNumberField
                  label="Current charges"
                  value={move.currentCharges}
                  min={0}
                  onChange={(value) => update(index, { currentCharges: value })}
                />
                <label className="field">
                  <span>Recovery Type</span>
                  <select
                    value={move.recoveryType ?? ""}
                    onChange={(event) =>
                      update(index, {
                        recoveryType: event.target.value || undefined,
                      })
                    }
                  >
                    <option value="">No Automatic Recovery</option>
                    <option value="Short Rest">Short Rest</option>
                    <option value="Long Rest">Long Rest</option>
                  </select>
                </label>
                <label className="field field-wide">
                  <span>Roll information</span>
                  <textarea
                    value={move.rollText}
                    onChange={(event) =>
                      update(index, { rollText: event.target.value })
                    }
                  />
                </label>
                <label className="field field-wide">
                  <span>On Hit</span>
                  <textarea
                    value={move.onHitText ?? ""}
                    onChange={(event) =>
                      update(index, {
                        onHitText: event.target.value || undefined,
                      })
                    }
                  />
                </label>
                <label className="field field-wide">
                  <span>On Combo</span>
                  <textarea
                    value={move.onComboText ?? ""}
                    onChange={(event) =>
                      update(index, {
                        onComboText: event.target.value || undefined,
                      })
                    }
                  />
                </label>
                <label className="field field-wide">
                  <span>On Crit</span>
                  <textarea
                    value={move.onCritText ?? ""}
                    onChange={(event) =>
                      update(index, {
                        onCritText: event.target.value || undefined,
                      })
                    }
                  />
                </label>
                <label className="field field-wide">
                  <span>Full effect text</span>
                  <textarea
                    value={move.effectText}
                    onChange={(event) =>
                      update(index, { effectText: event.target.value })
                    }
                  />
                </label>
              </div>
              <div className="nested-editor-actions">
                <button
                  className="button button-quiet"
                  onClick={() => onChange(reindex(moveEntry(moves, index, -1)))}
                  disabled={index === 0}
                >
                  Move up
                </button>
                <button
                  className="button button-quiet"
                  onClick={() => onChange(reindex(moveEntry(moves, index, 1)))}
                  disabled={index === moves.length - 1}
                >
                  Move down
                </button>
                <button
                  className="button button-muted"
                  onClick={() =>
                    onChange(
                      reindex([
                        ...moves,
                        {
                          ...structuredClone(move),
                          id: editorId("weapon-move"),
                          name: `${move.name} Copy`,
                          used: false,
                        },
                      ]),
                    )
                  }
                >
                  Duplicate
                </button>
                <button
                  className="button button-danger"
                  onClick={() =>
                    onChange(
                      reindex(moves.filter((entry) => entry.id !== move.id)),
                    )
                  }
                >
                  Remove
                </button>
              </div>
            </div>
          </details>
        ))}
      </div>
      <button
        className="button button-muted"
        onClick={() =>
          onChange(
            reindex([
              ...moves,
              { ...blankMove(), displayOrder: moves.length + 1 },
            ]),
          )
        }
      >
        + Add Weapon Move
      </button>
    </EditorSection>
  );
}

export function ItemEditor({
  state,
  onChange,
  onSave,
  onClose,
}: {
  state: ItemEditorState;
  onChange: (state: ItemEditorState) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const item = state.item;
  const update = (patch: Partial<Item>) =>
    onChange({ ...state, item: { ...item, ...patch } });

  return (
    <EditorModal
      eyebrow={state.mode === "create" ? "New character-owned entry" : "Player item editor"}
      title={state.mode === "create" ? "Create Inventory Entry" : `Edit ${item.name}`}
      onClose={onClose}
    >
      <div className="modal-body editor-body">
        <EditorSection title="Core item information">
          <div className="form-grid form-grid-three">
            <label className="field">
              <span>Item type</span>
              <select
                value={item.itemType}
                onChange={(event) => {
                  const itemType = event.target.value as ItemType;
                  update({
                    itemType,
                    consumable:
                      itemType === "Consumable" ? true : item.consumable,
                    weaponMoves:
                      itemType === "Weapon" ? item.weaponMoves ?? [] : undefined,
                  });
                }}
              >
                {itemTypes.map((type) => (
                  <option value={type} key={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Name</span>
              <input
                required
                value={item.name}
                onChange={(event) => update({ name: event.target.value })}
              />
            </label>
            <label className="field">
              <span>Icon text</span>
              <input
                maxLength={3}
                value={item.icon ?? ""}
                onChange={(event) =>
                  update({ icon: event.target.value || undefined })
                }
              />
            </label>
            <label className="field">
              <span>Rarity</span>
              <input
                value={item.rarity}
                onChange={(event) => update({ rarity: event.target.value })}
              />
            </label>
            <OptionalNumberField
              label="Item Level"
              value={item.itemLevel}
              min={0}
              onChange={(value) => update({ itemLevel: value })}
            />
            <label className="field">
              <span>Quantity</span>
              <input
                type="number"
                min={0}
                value={item.quantity}
                onChange={(event) =>
                  update({
                    quantity: Math.max(0, Number(event.target.value) || 0),
                  })
                }
              />
            </label>
            <label className="field">
              <span>Equipment slot</span>
              <input
                list="equipment-slot-suggestions"
                value={item.slot ?? ""}
                onChange={(event) =>
                  update({ slot: event.target.value || undefined })
                }
              />
              <datalist id="equipment-slot-suggestions">
                {equipmentSlots.map((slot) => (
                  <option value={slot} key={slot} />
                ))}
              </datalist>
            </label>
            <label className="field">
              <span>Weaponkind</span>
              <input
                value={item.weaponkind ?? ""}
                onChange={(event) =>
                  update({ weaponkind: event.target.value || undefined })
                }
              />
            </label>
          </div>
          <div className="toggle-grid">
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={item.equipped}
                onChange={(event) => update({ equipped: event.target.checked })}
              />
              <span>
                <strong>Equipped</strong>
                <small>Conflicting Weapon or Armor slots are replaced on save.</small>
              </span>
            </label>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={item.consumable}
                onChange={(event) => update({ consumable: event.target.checked })}
              />
              <span>
                <strong>Consumable</strong>
                <small>Using the listed operation may reduce quantity.</small>
              </span>
            </label>
          </div>
          <div className="form-grid">
            <label className="field field-wide">
              <span>Short description</span>
              <textarea
                value={item.shortDescription}
                onChange={(event) =>
                  update({ shortDescription: event.target.value })
                }
              />
            </label>
            <label className="field field-wide">
              <span>Full description</span>
              <textarea
                value={item.fullDescription}
                onChange={(event) =>
                  update({ fullDescription: event.target.value })
                }
              />
            </label>
            <label className="field field-wide">
              <span>Personal notes</span>
              <textarea
                value={item.notes ?? ""}
                onChange={(event) =>
                  update({ notes: event.target.value || undefined })
                }
              />
            </label>
          </div>
        </EditorSection>

        <EditorSection
          title="Costs, simple resource effects, and charges"
          description="Only these unambiguous personal resource changes can be previewed and applied automatically."
        >
          <div className="form-grid form-grid-three">
            <OptionalNumberField
              label="AP cost"
              value={item.apCost}
              min={0}
              onChange={(value) => update({ apCost: value })}
            />
            <OptionalNumberField
              label="HP cost"
              value={item.healthCost}
              min={0}
              onChange={(value) => update({ healthCost: value })}
            />
            <OptionalNumberField
              label="Pluck cost"
              value={item.pluckCost}
              min={0}
              onChange={(value) => update({ pluckCost: value })}
            />
            <OptionalNumberField
              label="Healing amount"
              value={item.healingAmount}
              min={0}
              onChange={(value) => update({ healingAmount: value })}
            />
            <OptionalNumberField
              label="Pluck restoration"
              value={item.pluckRestorationAmount}
              min={0}
              onChange={(value) =>
                update({ pluckRestorationAmount: value })
              }
            />
            <OptionalNumberField
              label="Temporary Health"
              value={item.temporaryHealthAmount}
              min={0}
              onChange={(value) => update({ temporaryHealthAmount: value })}
            />
            <OptionalNumberField
              label="Maximum charges"
              value={item.maximumCharges}
              min={0}
              onChange={(value) =>
                update({
                  maximumCharges: value,
                  remainingCharges:
                    value === undefined
                      ? undefined
                      : Math.min(item.remainingCharges ?? value, value),
                })
              }
            />
            <OptionalNumberField
              label="Remaining charges"
              value={item.remainingCharges}
              min={0}
              onChange={(value) => update({ remainingCharges: value })}
            />
            <label className="field">
              <span>Recovery Type</span>
              <select
                value={item.recoveryType ?? ""}
                onChange={(event) =>
                  update({ recoveryType: event.target.value || undefined })
                }
              >
                <option value="">No Automatic Recovery</option>
                <option value="Short Rest">Short Rest</option>
                <option value="Long Rest">Long Rest</option>
              </select>
            </label>
          </div>
        </EditorSection>

        <EditorSection title="Persistent bonuses">
          <div className="form-grid form-grid-three">
            <OptionalNumberField
              label="Maximum Health bonus"
              value={item.maximumHealthBonus}
              onChange={(value) => update({ maximumHealthBonus: value })}
            />
            <OptionalNumberField
              label="Maximum Pluck bonus"
              value={item.maximumPluckBonus}
              onChange={(value) => update({ maximumPluckBonus: value })}
            />
          </div>
          <div className="bonus-editor-list">
            {item.statBonuses.map((bonus, index) => (
              <div className="bonus-editor-row" key={`${bonus.statDefinitionId}-${index}`}>
                <label className="field">
                  <span>Stat</span>
                  <select
                    value={bonus.statDefinitionId}
                    onChange={(event) => {
                      const statBonuses = [...item.statBonuses];
                      statBonuses[index] = {
                        ...statBonuses[index],
                        statDefinitionId: event.target.value,
                      };
                      update({ statBonuses });
                    }}
                  >
                    {statDefinitions.map((definition) => (
                      <option value={definition.id} key={definition.id}>
                        {definition.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Bonus</span>
                  <input
                    type="number"
                    value={bonus.amount}
                    onChange={(event) => {
                      const statBonuses = [...item.statBonuses];
                      statBonuses[index] = {
                        ...statBonuses[index],
                        amount: Number(event.target.value) || 0,
                      };
                      update({ statBonuses });
                    }}
                  />
                </label>
                <button
                  className="button button-danger"
                  onClick={() =>
                    update({
                      statBonuses: item.statBonuses.filter(
                        (_, bonusIndex) => bonusIndex !== index,
                      ),
                    })
                  }
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <button
            className="button button-muted"
            onClick={() =>
              update({
                statBonuses: [
                  ...item.statBonuses,
                  { statDefinitionId: statDefinitions[0].id, amount: 0 },
                ],
              })
            }
          >
            + Add Stat bonus
          </button>
        </EditorSection>

        <AffixEditorList
          title="Major Affixes"
          affixes={item.majorAffixes}
          major
          onChange={(majorAffixes) => update({ majorAffixes })}
        />
        <AffixEditorList
          title="Minor Affixes"
          affixes={item.minorAffixes}
          major={false}
          onChange={(minorAffixes) => update({ minorAffixes })}
        />

        {item.itemType === "Weapon" ? (
          <WeaponMoveEditorList
            moves={item.weaponMoves ?? []}
            onChange={(weaponMoves) => update({ weaponMoves })}
          />
        ) : null}

        <EditorSection
          title="Additional rules text"
          description="Use one line for each independent entry."
        >
          <div className="form-grid">
            <TextListField
              label="Passive effects"
              value={item.passiveEffects}
              onChange={(passiveEffects) => update({ passiveEffects })}
            />
            <TextListField
              label="Special rules"
              value={item.specialRules}
              onChange={(specialRules) => update({ specialRules })}
            />
            <TextListField
              label="Refinements"
              value={item.refinements}
              onChange={(refinements) => update({ refinements })}
            />
            <TextListField
              label="Curses"
              value={item.curses}
              onChange={(curses) => update({ curses })}
            />
          </div>
        </EditorSection>
      </div>
      <footer className="modal-actions">
        <button className="button button-quiet" onClick={onClose}>
          Cancel
        </button>
        <button
          className="button button-primary"
          onClick={onSave}
          disabled={!item.name.trim()}
        >
          {state.mode === "create" ? "Create entry" : "Save changes"}
        </button>
      </footer>
    </EditorModal>
  );
}

export function ClasspectEditor({
  state,
  onChange,
  onSave,
  onClose,
}: {
  state: ClasspectEditorState;
  onChange: (state: ClasspectEditorState) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const entry = state.entry;
  const update = (patch: Partial<ClasspectEntry>) =>
    onChange({ ...state, entry: { ...entry, ...patch } });

  return (
    <EditorModal
      eyebrow={state.mode === "create" ? "New character-owned option" : "Player Classpect editor"}
      title={
        state.mode === "create"
          ? `Create ${entry.entryType}`
          : `Edit ${entry.name}`
      }
      onClose={onClose}
    >
      <div className="modal-body editor-body">
        <EditorSection title="Identity and availability">
          <div className="form-grid form-grid-three">
            <label className="field">
              <span>Entry type</span>
              <select
                value={entry.entryType}
                onChange={(event) =>
                  update({
                    entryType: event.target.value as ClasspectEntryType,
                  })
                }
              >
                {classpectEntryTypes.map((type) => (
                  <option value={type} key={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Category</span>
              <select
                value={entry.category}
                onChange={(event) =>
                  update({
                    category: event.target.value as ClasspectCategory,
                  })
                }
              >
                {classpectCategories.map((category) => (
                  <option value={category} key={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Name</span>
              <input
                required
                value={entry.name}
                onChange={(event) => update({ name: event.target.value })}
              />
            </label>
          </div>
          <div className="toggle-grid">
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={entry.unlocked}
                onChange={(event) => update({ unlocked: event.target.checked })}
              />
              <span>
                <strong>Unlocked</strong>
                <small>Locked entries are stored but hidden from play menus.</small>
              </span>
            </label>
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={entry.explorationCompatible}
                onChange={(event) =>
                  update({ explorationCompatible: event.target.checked })
                }
              />
              <span>
                <strong>Exploration compatible</strong>
                <small>Otherwise this entry is labeled Strife-only.</small>
              </span>
            </label>
          </div>
        </EditorSection>

        <EditorSection title="Costs and usage">
          <div className="form-grid form-grid-three">
            <OptionalNumberField
              label="AP cost"
              value={entry.apCost}
              min={0}
              onChange={(value) => update({ apCost: value })}
            />
            <OptionalNumberField
              label="HP cost"
              value={entry.healthCost}
              min={0}
              onChange={(value) => update({ healthCost: value })}
            />
            <OptionalNumberField
              label="Pluck cost"
              value={entry.pluckCost}
              min={0}
              onChange={(value) => update({ pluckCost: value })}
            />
            <label className="field">
              <span>Other cost</span>
              <input
                value={entry.otherCost ?? ""}
                onChange={(event) =>
                  update({ otherCost: event.target.value || undefined })
                }
              />
            </label>
            <label className="field">
              <span>Usage limit</span>
              <input
                value={entry.usageLimit ?? ""}
                onChange={(event) =>
                  update({ usageLimit: event.target.value || undefined })
                }
              />
            </label>
            <OptionalNumberField
              label="Maximum charges"
              value={entry.maximumCharges}
              min={0}
              onChange={(value) =>
                update({
                  maximumCharges: value,
                  currentCharges:
                    value === undefined
                      ? undefined
                      : Math.min(entry.currentCharges ?? value, value),
                })
              }
            />
            <OptionalNumberField
              label="Current charges"
              value={entry.currentCharges}
              min={0}
              onChange={(value) => update({ currentCharges: value })}
            />
            <label className="field">
              <span>Recovery Type</span>
              <select
                value={entry.recoveryType ?? ""}
                onChange={(event) =>
                  update({ recoveryType: event.target.value || undefined })
                }
              >
                <option value="">No Automatic Recovery</option>
                <option value="Short Rest">Short Rest</option>
                <option value="Long Rest">Long Rest</option>
              </select>
            </label>
          </div>
        </EditorSection>

        <EditorSection title="Timing and resolution text">
          <div className="form-grid">
            <label className="field">
              <span>Timing</span>
              <input
                value={entry.timing ?? ""}
                onChange={(event) =>
                  update({ timing: event.target.value || undefined })
                }
              />
            </label>
            <label className="field">
              <span>Trigger condition</span>
              <input
                value={entry.condition ?? ""}
                onChange={(event) =>
                  update({ condition: event.target.value || undefined })
                }
              />
            </label>
            <label className="field">
              <span>Targets</span>
              <input
                value={entry.target ?? ""}
                onChange={(event) =>
                  update({ target: event.target.value || undefined })
                }
              />
            </label>
            <label className="field">
              <span>Required roll or Saving Throw</span>
              <input
                value={entry.roll ?? ""}
                onChange={(event) =>
                  update({ roll: event.target.value || undefined })
                }
              />
            </label>
            <label className="field">
              <span>Saving Throw Stat</span>
              <input
                value={entry.saveStat ?? ""}
                onChange={(event) =>
                  update({ saveStat: event.target.value || undefined })
                }
              />
            </label>
            <OptionalNumberField
              label="Saving Throw DC"
              value={entry.saveDC}
              onChange={(value) => update({ saveDC: value })}
            />
            <label className="field">
              <span>Duration</span>
              <input
                value={entry.duration ?? ""}
                onChange={(event) =>
                  update({ duration: event.target.value || undefined })
                }
              />
            </label>
            <label className="field field-wide">
              <span>One-sentence summary</span>
              <textarea
                value={entry.shortSummary}
                onChange={(event) =>
                  update({ shortSummary: event.target.value })
                }
              />
            </label>
            <label className="field field-wide">
              <span>Effect</span>
              <textarea
                value={entry.effect}
                onChange={(event) => update({ effect: event.target.value })}
              />
            </label>
            <label className="field field-wide">
              <span>Full description</span>
              <textarea
                value={entry.fullDescription}
                onChange={(event) =>
                  update({ fullDescription: event.target.value })
                }
              />
            </label>
            <label className="field field-wide">
              <span>Player notes</span>
              <textarea
                value={entry.playerNotes ?? ""}
                onChange={(event) =>
                  update({ playerNotes: event.target.value || undefined })
                }
              />
            </label>
          </div>
        </EditorSection>
        <p className="automation-note">
          Saving this entry never spends AP, rolls dice, chooses targets, applies
          damage, or resolves its effect.
        </p>
      </div>
      <footer className="modal-actions">
        <button className="button button-quiet" onClick={onClose}>
          Cancel
        </button>
        <button
          className="button button-primary"
          onClick={onSave}
          disabled={!entry.name.trim()}
        >
          {state.mode === "create" ? `Create ${entry.entryType}` : "Save changes"}
        </button>
      </footer>
    </EditorModal>
  );
}
