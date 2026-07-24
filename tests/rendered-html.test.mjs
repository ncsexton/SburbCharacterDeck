import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { previewIncomingDamage } from "../app/rules.ts";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${path}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the SBURB Player prototype", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>SBURB Character Manager<\/title>/i);
  assert.match(html, /Mina Quill/);
  assert.match(html, /Seer/);
  assert.match(html, /Light/);
  assert.match(html, /Health Vial/);
  assert.match(html, /header-temp-health/);
  assert.match(html, /Character/);
  assert.match(html, /Inventory/);
  assert.match(html, /Classpect/);
  assert.match(html, /Strife/);
  assert.match(html, /Maximum AP/);
  assert.doesNotMatch(html, />\s*Surge\s*</);
  assert.doesNotMatch(html, />\s*Stagger\s*</);
  assert.doesNotMatch(html, /Equipped Equipment|Inventory Summary/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
});

test("keeps the prototype source-of-truth content and removes the starter", async () => {
  const [source, seed, packageJson] = await Promise.all([
    readFile(new URL("../app/SburbApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/seed.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  for (const stat of [
    "Mangrit",
    "Gel Viscosity",
    "Scamperway",
    "Flummoxie",
    "Moxie Muffling",
    "Semperstand",
    "Dexcellence",
    "Triggerance",
    "Soulicity",
    "Brainitude",
    "Wisdomentality",
    "Verballistamina",
    "Radnaturality",
  ]) {
    assert.match(seed, new RegExp(stat));
  }

  assert.match(source, /applyHealthRemoval/);
  assert.match(source, /window\.localStorage/);
  assert.match(source, /Export JSON/);
  assert.match(source, /Incoming Damage/);
  assert.match(source, /header-temp-health/);
  assert.match(source, /inventory-primary-tabs/);
  assert.match(source, /updateResource\("surge"/);
  assert.match(source, /updateResource\("stagger"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(
    access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)),
  );
});

test("reserves the separate GM route", async () => {
  const response = await render("/gm");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Game Master management is intentionally deferred/);
  assert.match(html, /Stage 4/);
});

test("calculates the required incoming-damage cases", () => {
  const physical = previewIncomingDamage({
    incomingDamage: 15,
    damageType: "Physical",
    damageProperty: "None",
    gelViscosityModifier: 4,
    moxieMufflingModifier: 3,
    currentHealth: 30,
    temporaryHealth: 0,
  });
  assert.equal(physical.finalDamage, 11);
  assert.equal(physical.resultingHealth, 19);

  const special = previewIncomingDamage({
    incomingDamage: 15,
    damageType: "Special",
    damageProperty: "None",
    gelViscosityModifier: 4,
    moxieMufflingModifier: 3,
    currentHealth: 30,
    temporaryHealth: 0,
  });
  assert.equal(special.finalDamage, 12);

  const trueDamage = previewIncomingDamage({
    incomingDamage: 10,
    damageType: "True",
    damageProperty: "None",
    gelViscosityModifier: 4,
    moxieMufflingModifier: 3,
    currentHealth: 30,
    temporaryHealth: 0,
  });
  assert.equal(trueDamage.finalDamage, 10);

  const buffered = previewIncomingDamage({
    incomingDamage: 15,
    damageType: "Physical",
    damageProperty: "None",
    gelViscosityModifier: 4,
    moxieMufflingModifier: 3,
    currentHealth: 30,
    temporaryHealth: 5,
  });
  assert.equal(buffered.finalDamage, 11);
  assert.equal(buffered.temporaryHealthUsed, 5);
  assert.equal(buffered.healthLost, 6);
  assert.equal(buffered.resultingTemporaryHealth, 0);
  assert.equal(buffered.resultingHealth, 24);
});

test("halves Piercing defense upward and permits negative resulting Health", () => {
  const piercing = previewIncomingDamage({
    incomingDamage: 15,
    damageType: "Physical",
    damageProperty: "Piercing",
    gelViscosityModifier: 7,
    moxieMufflingModifier: 0,
    currentHealth: 5,
    temporaryHealth: 0,
  });
  assert.equal(piercing.defenseUsed, 4);
  assert.equal(piercing.finalDamage, 11);
  assert.equal(piercing.resultingHealth, -6);
});
