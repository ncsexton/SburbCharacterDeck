# SBURB Character Manager

A responsive interactive prototype for a custom SBURB tabletop RPG. It
combines a Player-editable digital character sheet, Inventory builder,
Classpect library, personal Strife menu, persistent resource tracking, and a
small incoming-damage calculator.

The prototype deliberately does not roll dice, choose targets, spend AP,
resolve Statuses, manage enemies, or automate tabletop rulings.

## Run locally

Prerequisite: Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open the local address printed by the development server. To verify a production
build:

```bash
npm run build
npm test
```

## Project structure

```text
app/
  gm/page.tsx        Reserved Stage 4 GM route
  PlayerEditors.tsx  Character, item, Weapon Move, Skill, and Ability editors
  persistence.ts     Versioned local-save and JSON-backup migration
  SburbApp.tsx       Shared state, calculations, interactions, and all Player pages
  globals.css        Responsive game-interface design system
  layout.tsx         Site metadata and document shell
  page.tsx           Player application entry
  seed.ts            Complete Mina Quill example character and rules text
  types.ts           Relational TypeScript data model
tests/
  rendered-html.test.mjs
.openai/
  hosting.json       Sites configuration; D1 and R2 remain disabled
```

## Prototype data model

The data is relational in shape even though Stage 1 is client-only:

- `CharacterData` owns editable identity, progression, current resources,
  Stats, Custom Stats, items, Classpect entries, Status notes, turn notes, and
  a manually selected guard state.
- items own optional Major Affixes, zero or more Minor Affixes, bonuses,
  charges, limited-use state, and optional Weapon Moves.
- Class Skills and Aspect Abilities share one typed record shape but retain a
  required `entryType` discriminator.
- resource history and undo records are separate from permanent character data.
- totals are derived from Base + equipped bonuses + persistent + temporary -
  penalties. Stat Modifier is `floor(Total / 5)` unless a manual override is active.
- Maximum AP is derived from Total Scamperway.

The export format includes `schemaVersion: 2`. Version 1 local saves and JSON
backups are migrated when opened.

## Persistence

The current local-authoring milestone uses one shared React state object and
device-local browser storage.
Health, Temporary Health, Pluck, AP, tracked resources, notes, equipped state,
quantities, charges, limited uses, Player-authored items, Weapon Moves, Skills,
Abilities, history, undo, and the selected Player tab survive refreshes on the
same device. JSON export and import provide manual backup and restoration.

Players can edit identity, progression, currencies, Stat components, Custom
Stats, Maximum Health and Pluck, items, Affixes, Weapon Moves, Class Skills,
and Aspect Abilities. Creation, duplication, deletion, and reordering use the
same undo history as resource changes.

Cloud synchronization is intentionally deferred until authentication and data
ownership rules are implemented.

## Responsive layouts

- **Phone (360px and up):** compact sticky identity/meters header, one-column
  content, bottom navigation, Equipment/Items Inventory subtabs, scrollable
  filters, a 2×2 Strife menu, and bottom-sheet confirmations.
- **Tablet:** bottom navigation remains, two-column summaries and resources
  appear where space allows, and full-width touch controls remain at least
  44px tall.
- **Desktop:** fixed left navigation, sticky top character header, multi-column
  meter/resource/inventory layouts, and centered confirmation dialogs.

## Intentionally deferred

- authentication, campaigns, ownership, Player/GM authorization, and cloud data
- campaign-wide GM administration, resource awards across multiple characters,
  and history repair
- PWA installation, service-worker caching, and multi-device offline sync
- attack/damage dice, Hit/Combo/Crit/Dubs calculations, targets, enemies,
  initiative, turns, maps, Effect Chains, Reactions, Status processing, Saving
  Throws, automatic AP/Surge/Stagger processing, and other combat automation
- alchemy generation, skill-tree purchasing, quest management, and
  human-readable PDF summaries

## Implementation assumptions

- Mina Quill is fictional seed content created only to demonstrate the supplied
  schema and interaction boundaries.
- Act AP costs are configurable demo copy because the brief requires costs to be
  shown but does not provide canonical values. They are not deducted.
- Temporary Health is not capped. Current Health and confirmed voluntary Pluck
  costs may go below zero.
- Generic forced Pluck loss stops at zero unless the explicit override is
  selected.
- Current AP, Surge, and Stagger are visible and adjustable only in Strife.
  The Character page shows Maximum AP and other persistent resources as a
  reference, with Doom Marks remaining directly editable there.
- The persistent header displays Temporary Health as a yellow additive value
  immediately before Current / Maximum Health whenever the buffer is nonzero.
- Equipping one Weapon replaces the prior Weapon, and equipping Armor replaces
  Armor in the same slot. Other unusual slot rules remain a GM concern.
- The `/gm` route is reserved and explains the Stage 4 boundary; only exact
  resource controls and per-Stat Total/Modifier overrides are included now.
