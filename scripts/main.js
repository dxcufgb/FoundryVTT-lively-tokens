/**
 * Dxcufgb's lively tokens (dxcufgbs-lively-tokens) - Foundry VTT V13
 *
 * Animated rings around tokens. A ring is stored on the token as a flag
 *   flags["dxcufgbs-lively-tokens"].ring = {layers: [{design, style, scale, speed, alpha, density, color,
 *                                                      glow, pulse, rainbow, spin, ...}, ...]}
 * Layers are drawn bottom to top, so several effects combine into one ring. A layer with
 * design "custom" shows an image of the user's own (src) instead of a built-in design.
 * and drawn as a child of the Token placeable, so it moves, hides and sorts with the token
 * with no extra work. It sits just above the token's void mesh, so it shows on top of the token
 * art but under the bars, nameplate and status effects (see placeRing).
 *
 * API: game.modules.get("dxcufgbs-lively-tokens").api
 *   .open()                      open the Animated Border window (selected tokens)
 *   .open({actor})               open it for one actor: its tokens on the scene and its prototype token
 *   .open({token})               open it for one token (plus the other selected tokens), showing that token's ring
 *   .setRing(token, cfg)         give a token (Token or TokenDocument) a ring
 *   .clearRing(token)            remove it
 *   .designs                     available designs and styles
 *   .presets()                   this user's saved effects
 *   .exportRing(cfg, name)       save a ring (with its own images) as one .lively-ring.json file
 *   .importRing(file)            read such a file, add its images to this world -> {name, cfg, uploaded, skipped}
 */

import { MODULE_ID, FLAG } from "./constants.js";
import { DESIGNS, normalizeConfig, loadTextures, customSources, LivelyRing, insertAbove } from "./ring.js";
import { LivelyTokensConfig } from "./config-app.js";
import { exportRing, importRing } from "./transfer.js";

export { MODULE_ID, FLAG };
const TOOL = "dxcufgbs-lively-tokens";

const state = {
  textures: null,
  loading: null,
  tokens: new Set(),      // Token placeables that currently carry a ring
  ticking: false,
  partners: []            // tool buttons of other animated-ring/border modules folded into our window
};
export const partners = () => state.partners;

/* -------------------------------------------- */
/*  Settings                                    */
/* -------------------------------------------- */

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "playersCanUse", {
    name: "DXLT.Settings.Players.Name", hint: "DXLT.Settings.Players.Hint",
    scope: "world", config: true, type: Boolean, default: true,
    onChange: () => ui.controls?.render({ reset: true })
  });
  game.settings.register(MODULE_ID, "autoRings", {
    name: "DXLT.Settings.Auto.Name", hint: "DXLT.Settings.Auto.Hint",
    scope: "world", config: true, type: Boolean, default: true,
    onChange: () => refreshAll()
  });
  game.settings.register(MODULE_ID, "enabled", {
    name: "DXLT.Settings.Enabled.Name", hint: "DXLT.Settings.Enabled.Hint",
    scope: "client", config: true, type: Boolean, default: true,
    onChange: () => refreshAll(true)
  });
  game.settings.register(MODULE_ID, "quality", {
    name: "DXLT.Settings.Quality.Name", hint: "DXLT.Settings.Quality.Hint",
    scope: "client", config: true, type: String, default: "high",
    choices: { high: "DXLT.Settings.Quality.High", medium: "DXLT.Settings.Quality.Medium", low: "DXLT.Settings.Quality.Low" },
    onChange: () => refreshAll(true)
  });
  game.settings.register(MODULE_ID, "lastConfig", { scope: "client", config: false, type: Object, default: {} });

  const mod = game.modules.get(MODULE_ID);
  if (mod) mod.api = { open: opts => LivelyTokensConfig.open(opts), setRing, clearRing, setActorRing, clearActorRing, presets, exportRing, importRing, designs: DESIGNS };
});

export function canUse() {
  return game.user.isGM || game.settings.get(MODULE_ID, "playersCanUse");
}

function quality() {
  return { high: 1, medium: 0.6, low: 0.3 }[game.settings.get(MODULE_ID, "quality")] ?? 1;
}

/* -------------------------------------------- */
/*  Token Controls button                       */
/* -------------------------------------------- */

// Registered at "setup" so it runs after other modules added their buttons in "init":
// another animated border/ring module's button is folded into our window (one shared UI).
Hooks.once("setup", () => Hooks.on("getSceneControlButtons", addControls));

function addControls(controls) {
  const tokens = controls.tokens;
  if (!tokens?.tools) return;
  const found = [];
  for (const [name, tool] of Object.entries(tokens.tools)) {
    if (name === TOOL) continue;
    const text = `${name} ${game.i18n.localize(tool.title ?? "")}`;
    if (/anim\w*[\s_-]*(token)?[\s_-]*(border|ring)/i.test(text)) {
      found.push({ name, title: game.i18n.localize(tool.title ?? name), icon: tool.icon, onChange: tool.onChange, onClick: tool.onClick });
      delete tokens.tools[name];
    }
  }
  state.partners = found;
  const orders = Object.values(tokens.tools).map(t => t.order ?? 0);
  tokens.tools[TOOL] = {
    name: TOOL,
    order: Math.max(0, ...orders) + 1,
    title: "DXLT.Control.Title",
    icon: "fa-solid fa-ring",
    button: true,
    visible: canUse(),
    onChange: () => LivelyTokensConfig.open()
  };
}

/** Other animated ring / border modules that are active (by id or title). */
export function partnerModules() {
  return game.modules.filter(m => m.active && m.id !== MODULE_ID
    && /anim\w*[\s_-]*token[\s_-]*(border|ring)/i.test(`${m.id} ${m.title}`));
}

/* -------------------------------------------- */
/*  Rings on tokens                             */
/* -------------------------------------------- */

export async function textures() {
  if (state.textures) return state.textures;
  state.loading ??= loadTextures(`modules/${MODULE_ID}/`, src => foundry.canvas.loadTexture(src));
  state.textures = await state.loading;
  return state.textures;
}

/** The shared textures plus the user images a ring's custom layers need ({custom: {src: texture}}). */
export async function ringTextures(cfg) {
  const base = await textures();
  const srcs = customSources(cfg);
  if (!srcs.length) return base;
  const custom = {};
  await Promise.all(srcs.map(async src => {
    try { custom[src] = await foundry.canvas.loadTexture(src); }
    catch (err) { console.warn(`${MODULE_ID} | image ${src} could not be loaded`, err); }
  }));
  return { ...base, custom };
}

/* -------------------------------------------- */
/*  Automatic rings (dnd5e characters)          */
/* -------------------------------------------- */

// Keyword in the item's name/identifier (letters only, lower case) -> design. First match wins,
// so "halfelf" comes before "elf" and "halforc" before "orc".
const AUTO_DESIGNS = {
  background: [["acolyte", "votiveglow"], ["artisan", "makersmark"], ["charlatan", "sleightofhand"], ["criminal", "alleysmoke"],
    ["entertainer", "showstopper"], ["farmer", "harvestbreeze"], ["guard", "lanternwatch"], ["guide", "waypoint"],
    ["hermit", "stillmind"], ["merchant", "coinshower"], ["noble", "regalbearing"], ["sage", "inklore"], ["sailor", "seaspray"],
    ["pirate", "seaspray"], ["scribe", "quillwork"], ["soldier", "veteransmarch"], ["wayfarer", "wanderlust"],
    ["folkhero", "hearthfire"], ["outlander", "starlitcamp"], ["urchin", "streetscraps"]],
  race: [["aasimar", "celestialplumes"], ["dragonborn", "dragonbreath"], ["halfelf", "twinheritage"], ["halforc", "relentless"],
    ["dwarf", "stoneheart"], ["duergar", "stoneheart"], ["elf", "feygrace"], ["eladrin", "feygrace"], ["drow", "feygrace"],
    ["gnome", "gnomishfizz"], ["goliath", "giantstride"], ["halfling", "luckystars"], ["human", "heroicinspiration"],
    ["orc", "adrenaline"], ["tiefling", "hellishlegacy"]],
  class: [["barbarian", "rage"], ["bard", "encore"], ["cleric", "radiance"], ["druid", "wildbloom"], ["fighter", "steelsparks"],
    ["monk", "kiflow"], ["paladin", "holyaura"], ["ranger", "huntertrail"], ["rogue", "shadowstep"], ["sorcerer", "wildsurge"],
    ["warlock", "eldritch"], ["wizard", "spellweave"], ["artificer", "arcforge"]]
};
const AUTO_TYPES = new Set(["background", "race", "class", "subclass"]);
const plain = s => String(s ?? "").toLowerCase().replace(/[^a-z]/g, "");
const itemText = item => item ? plain(item.system?.identifier) + plain(item.name) : "";

/** A layer for an item, with the style named in `styleText` (subclass, lineage) when there is one. */
function autoLayer(type, item, styleText) {
  const text = itemText(item);
  const design = text && AUTO_DESIGNS[type].find(([key]) => text.includes(key))?.[1];
  if (!design || !DESIGNS[design]) return null;
  const style = Object.keys(DESIGNS[design].styles).find(s => styleText.includes(s));
  return { design, style };
}

/**
 * The ring a dnd5e character gets when it has none of its own: background, species and class
 * (highest level, styled by its subclass), bottom to top. Null for anything else.
 */
export function autoRing(actor) {
  actor = baseActor(actor);
  if (game.system.id !== "dnd5e" || actor?.type !== "character" || !game.settings.get(MODULE_ID, "autoRings")) return null;
  const items = actor.items;
  const race = items.find(i => i.type === "race");
  const cls = items.filter(i => i.type === "class").sort((a, b) => (b.system?.levels ?? 0) - (a.system?.levels ?? 0))[0];
  const clsId = cls?.system?.identifier || plain(cls?.name);
  const sub = cls && items.find(i => i.type === "subclass" && plain(i.system?.classIdentifier) === plain(clsId));
  const layers = [
    autoLayer("background", items.find(i => i.type === "background"), ""),
    autoLayer("race", race, itemText(race)),
    autoLayer("class", cls, itemText(sub))
  ].filter(Boolean);
  return layers.length ? normalizeConfig({ layers }) : null;
}

/** The ring shown for these flags: the saved one, else the automatic one unless the ring was removed. */
function shownRing(flags, actor) {
  const own = flags?.[MODULE_ID]?.[FLAG];
  if (own) return normalizeConfig(own);
  return flags?.[MODULE_ID]?.noAuto ? null : autoRing(actor);
}

async function syncToken(token) {
  if (!token || token.destroyed || !token.document) return;
  const flag = game.settings.get(MODULE_ID, "enabled") ? shownRing(token.document.flags, token.document.actor) : null;
  let ring = token._dxltRing;
  if (ring?.destroyed) ring = token._dxltRing = null;

  if (!flag) {
    if (ring) { ring.destroy(); token._dxltRing = null; }
    state.tokens.delete(token);
    return;
  }

  const cfg = normalizeConfig(flag);
  if (ring && ring.key === JSON.stringify(cfg)) { layout(token); return; }

  const tex = await ringTextures(cfg);
  if (token.destroyed) return;
  if (token._dxltRing && !token._dxltRing.destroyed) token._dxltRing.destroy();
  ring = new LivelyRing(cfg, tex, quality());
  token._dxltRing = ring;
  state.tokens.add(token);
  layout(token);
  startTicker();
}

/**
 * Put the ring on top of the token art. The token art itself is drawn in the primary canvas group,
 * below the Token placeable, but the Token draws it once more as its void mesh with ERASE blending:
 * whatever comes before the void mesh in the Token is cut out where the art is (that is how
 * Foundry keeps the turn marker under the token). So the ring goes right after the void mesh, which
 * also keeps it under the bars, nameplate and effects that follow.
 */
function placeRing(token, ring) {
  const voidMesh = token.voidMesh;
  if (voidMesh?.parent === token) {
    ring.zIndex = voidMesh.zIndex;
    insertAbove(token, ring, voidMesh);
  } else if (ring.parent !== token) {
    ring.zIndex = -100;               // no void mesh: nothing is erased, keep it under the bars and nameplate
    token.addChildAt(ring, 0);
  }
}

function layout(token) {
  const ring = token._dxltRing;
  if (!ring || ring.destroyed) return;
  placeRing(token, ring);             // also after a redraw replaced the void mesh
  const w = token.w ?? token.document.width * canvas.dimensions.size;
  const h = token.h ?? token.document.height * canvas.dimensions.size;
  ring.position.set(w / 2, h / 2);
  ring.setRadius(Math.max(w, h) / 2);   // grows with the creature's size
}

function refreshAll(rebuild = false) {
  if (!canvas?.ready) return;
  for (const token of canvas.tokens.placeables) {
    if (rebuild && token._dxltRing) { token._dxltRing.destroy(); token._dxltRing = null; }
    syncToken(token);
  }
}

Hooks.on("drawToken", token => syncToken(token));
Hooks.on("refreshToken", token => { if (token._dxltRing) layout(token); });
Hooks.on("updateToken", (doc, changes) => {
  if (changes.flags !== undefined || changes.width !== undefined || changes.height !== undefined) syncToken(doc.object);
});
Hooks.on("destroyToken", token => {
  state.tokens.delete(token);
  token._dxltRing = null;             // the ring is destroyed with the token's children
});
Hooks.on("canvasTearDown", () => state.tokens.clear());
// Class, species or background changed (e.g. an import finishing): refresh the automatic ring.
for (const hook of ["createItem", "updateItem", "deleteItem"]) {
  Hooks.on(hook, item => {
    if (AUTO_TYPES.has(item.type) && game.system.id === "dnd5e" && game.settings.get(MODULE_ID, "autoRings")) {
      item.parent?.getActiveTokens?.().forEach(t => syncToken(t));
    }
  });
}
Hooks.on("canvasReady", () => { refreshAll(); startTicker(); });

/* -------------------------------------------- */
/*  Animation                                   */
/* -------------------------------------------- */

function startTicker() {
  if (state.ticking || !canvas?.app?.ticker) return;
  state.ticking = true;
  canvas.app.ticker.add(tick);
}

function tick() {
  const dt = Math.min(0.1, (canvas.app.ticker.deltaMS ?? 16.7) / 1000);
  for (const token of state.tokens) {
    const ring = token._dxltRing;
    if (!ring || ring.destroyed || token.destroyed) { state.tokens.delete(token); continue; }
    if (!token.visible || !token.renderable) continue;
    ring.update(dt);
  }
}

/* -------------------------------------------- */
/*  Assigning rings                             */
/* -------------------------------------------- */

const docOf = t => t?.document ?? t;

/**
 * The world actor whose prototype token should carry a token's ring: always for a linked token
 * (the token is the character, so its ring travels with it), and when asked for any other token.
 * An unlinked token's own actor is synthetic; its prototype lives on the world actor.
 */
function prototypeOwner(doc, prototype) {
  if (!prototype && !doc.actorLink) return null;
  const base = baseActor(doc.actor);
  return base?.isOwner ? base : null;
}

export async function setRing(token, cfg, { prototype = false } = {}) {
  const doc = docOf(token);
  if (!doc?.isOwner) return false;
  const data = normalizeConfig(cfg);
  await doc.update({ [`flags.${MODULE_ID}.${FLAG}`]: data });
  await prototypeOwner(doc, prototype)?.update({ [`prototypeToken.flags.${MODULE_ID}.${FLAG}`]: data });
  return true;
}

// Removing a ring also marks it off, so the automatic ring does not come back in its place.
const cleared = (prefix = "") => ({ [`${prefix}flags.${MODULE_ID}.-=${FLAG}`]: null, [`${prefix}flags.${MODULE_ID}.noAuto`]: true });

export async function clearRing(token, { prototype = false } = {}) {
  const doc = docOf(token);
  if (!doc?.isOwner) return false;
  await doc.update(cleared());
  await prototypeOwner(doc, prototype)?.update(cleared("prototypeToken."));
  return true;
}

/** The ring a token shows: its own, else (unless `auto` is false) its character's automatic one. */
export function tokenRing(token, { auto = true } = {}) {
  const doc = docOf(token);
  return doc ? shownRing(doc.flags, auto ? doc.actor : null) : null;
}

/* -------------------------------------------- */
/*  Saved effects (per user)                    */
/* -------------------------------------------- */

/** This user's saved effects: [{id, name, cfg}], kept in a flag on their User document. */
export function presets() {
  const list = game.user.getFlag(MODULE_ID, "presets");
  return Array.isArray(list) ? list.filter(p => p?.id && p.cfg) : [];
}

/** Save a ring under a name; an effect with the same name is replaced. Returns its id. */
export async function savePreset(name, cfg) {
  name = String(name ?? "").trim().slice(0, 60);
  if (!name) return null;
  const list = presets();
  const old = list.find(p => p.name.toLowerCase() === name.toLowerCase());
  const entry = { id: old?.id ?? foundry.utils.randomID(), name, cfg: normalizeConfig(cfg) };
  const next = old ? list.map(p => (p === old ? entry : p)) : [...list, entry];
  next.sort((a, b) => a.name.localeCompare(b.name));
  await game.user.setFlag(MODULE_ID, "presets", next);
  return entry.id;
}

export async function deletePreset(id) {
  await game.user.setFlag(MODULE_ID, "presets", presets().filter(p => p.id !== id));
}

/** The world actor behind an actor (an unlinked token's synthetic actor stores its prototype there). */
export function baseActor(actor) {
  return actor?.isToken ? (game.actors.get(actor.id) ?? actor) : actor;
}

/** The actor's tokens on the current scene that the user may change. */
export function actorTokens(actor) {
  return (actor?.getActiveTokens?.() ?? []).filter(t => t.document?.isOwner);
}

/** The ring of the actor's prototype token: the stored one, else (unless `auto` is false) the automatic one. */
export function prototypeRing(actor, { auto = true } = {}) {
  const base = baseActor(actor);
  return base ? shownRing(base.prototypeToken?.flags, auto ? base : null) : null;
}

/**
 * Give an actor a ring: its tokens on the current scene and, if asked (or if it has none there),
 * its prototype token, so new tokens get it too. Returns the number of tokens changed.
 */
export async function setActorRing(actor, cfg, { prototype = true } = {}) {
  const data = normalizeConfig(cfg);
  const tokens = actorTokens(actor);
  await Promise.all(tokens.map(t => setRing(t, data)));
  const base = baseActor(actor);
  // A linked token already put it on its character's prototype token (see setRing).
  if (tokens.some(t => t.document.actorLink)) return tokens.length;
  if ((prototype || !tokens.length) && base?.isOwner) await base.update({ [`prototypeToken.flags.${MODULE_ID}.${FLAG}`]: data });
  return tokens.length;
}

export async function clearActorRing(actor, { prototype = true } = {}) {
  const tokens = actorTokens(actor);
  await Promise.all(tokens.map(t => clearRing(t)));
  const base = baseActor(actor);
  // A linked token already put it on its character's prototype token (see setRing).
  if (tokens.some(t => t.document.actorLink)) return tokens.length;
  if ((prototype || !tokens.length) && base?.isOwner) await base.update(cleared("prototypeToken."));
  return tokens.length;
}

// Keep the window's selection list current.
Hooks.on("controlToken", () => LivelyTokensConfig.instance?.onSelectionChanged());

/* -------------------------------------------- */
/*  Access points                               */
/* -------------------------------------------- */

const SHEET_ACTION = "dxltRing";

function canOpenFor(actor) {
  return !!actor && actor.isOwner && canUse();
}

// Character sheets (ApplicationV2, e.g. dnd5e 5.x): an entry in the header controls menu (the "..." button).
Hooks.on("getHeaderControlsDocumentSheetV2", (app, controls) => {
  const actor = app.document;
  if (actor?.documentName !== "Actor" || !canOpenFor(actor)) return;
  if (controls.some(c => c.action === SHEET_ACTION)) return;
  app.options.actions[SHEET_ACTION] ??= function () { LivelyTokensConfig.open({ actor: this.document }); };
  controls.push({ action: SHEET_ACTION, icon: "fa-solid fa-ring", label: "DXLT.Sheet.Control" });
});

// Character sheets still built on the legacy Application class: a header button.
Hooks.on("getActorSheetHeaderButtons", (app, buttons) => {
  const actor = app.actor ?? app.document;
  if (!canOpenFor(actor)) return;
  buttons.unshift({
    label: "DXLT.Sheet.Button", class: "dxlt-ring", icon: "fa-solid fa-ring",
    onclick: () => LivelyTokensConfig.open({ actor })
  });
});

// Actors sidebar: right-click an actor.
Hooks.on("getActorContextOptions", (app, options) => {
  const actorOf = li => game.actors.get((li?.dataset ?? li?.[0]?.dataset)?.entryId);
  options.push({
    name: "DXLT.Sheet.Control",
    icon: '<i class="fa-solid fa-ring"></i>',
    condition: li => canOpenFor(actorOf(li)),
    callback: li => LivelyTokensConfig.open({ actor: actorOf(li) })
  });
});

// Token HUD: a ring button in the left column, for the selected token(s).
Hooks.on("renderTokenHUD", (hud, html) => {
  const root = html instanceof HTMLElement ? html : html?.[0];
  const col = root?.querySelector(".col.left");
  if (!col || !canUse() || !hud.object?.document?.isOwner) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.classList.add("control-icon", "dxlt-hud");
  btn.dataset.tooltip = game.i18n.localize("DXLT.Control.Title");
  btn.innerHTML = '<i class="fa-solid fa-ring"></i>';
  btn.addEventListener("click", ev => {
    ev.preventDefault();
    ev.stopPropagation();
    LivelyTokensConfig.open({ token: hud.object });
  });
  col.appendChild(btn);
});
