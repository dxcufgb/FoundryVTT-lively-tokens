/**
 * Dxcufgb's lively tokens (dxcufgbs-lively-tokens) - Foundry VTT V13
 *
 * Animated rings around tokens. A ring is stored on the token as a flag
 *   flags["dxcufgbs-lively-tokens"].ring = {design, style, scale, speed, alpha, density, color}
 * and drawn as a child of the Token placeable, so it moves, hides and sorts with the token
 * with no extra work (the same way Foundry's own combat turn marker works).
 *
 * API: game.modules.get("dxcufgbs-lively-tokens").api
 *   .open()                      open the Animated Border window
 *   .setRing(token, cfg)         give a token (Token or TokenDocument) a ring
 *   .clearRing(token)            remove it
 *   .designs                     available designs and styles
 */

import { MODULE_ID, FLAG } from "./constants.js";
import { DESIGNS, normalizeConfig, loadTextures, LivelyRing } from "./ring.js";
import { LivelyTokensConfig } from "./config-app.js";

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
  if (mod) mod.api = { open: () => LivelyTokensConfig.open(), setRing, clearRing, designs: DESIGNS };
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

function ringFlag(doc) {
  return doc?.flags?.[MODULE_ID]?.[FLAG] ?? null;
}

async function syncToken(token) {
  if (!token || token.destroyed || !token.document) return;
  const flag = game.settings.get(MODULE_ID, "enabled") ? ringFlag(token.document) : null;
  let ring = token._dxltRing;
  if (ring?.destroyed) ring = token._dxltRing = null;

  if (!flag) {
    if (ring) { ring.destroy(); token._dxltRing = null; }
    state.tokens.delete(token);
    return;
  }

  const cfg = normalizeConfig(flag);
  if (ring && ring.key === JSON.stringify(cfg)) { layout(token); return; }

  const tex = await textures();
  if (token.destroyed) return;
  if (token._dxltRing && !token._dxltRing.destroyed) token._dxltRing.destroy();
  ring = new LivelyRing(cfg, tex, quality());
  ring.zIndex = -100;                 // under the border, bars and nameplate
  token.addChild(ring);
  token.sortChildren?.();
  token._dxltRing = ring;
  state.tokens.add(token);
  layout(token);
  startTicker();
}

function layout(token) {
  const ring = token._dxltRing;
  if (!ring || ring.destroyed) return;
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

export async function setRing(token, cfg, { prototype = false } = {}) {
  const doc = docOf(token);
  if (!doc?.isOwner) return false;
  const data = normalizeConfig(cfg);
  await doc.update({ [`flags.${MODULE_ID}.${FLAG}`]: data });
  if (prototype && doc.actor?.isOwner) await doc.actor.update({ [`prototypeToken.flags.${MODULE_ID}.${FLAG}`]: data });
  return true;
}

export async function clearRing(token, { prototype = false } = {}) {
  const doc = docOf(token);
  if (!doc?.isOwner) return false;
  await doc.update({ [`flags.${MODULE_ID}.-=${FLAG}`]: null });
  if (prototype && doc.actor?.isOwner) await doc.actor.update({ [`prototypeToken.flags.${MODULE_ID}.-=${FLAG}`]: null });
  return true;
}

export function tokenRing(token) {
  const f = ringFlag(docOf(token));
  return f ? normalizeConfig(f) : null;
}

// Keep the window's selection list current.
Hooks.on("controlToken", () => LivelyTokensConfig.instance?.onSelectionChanged());
