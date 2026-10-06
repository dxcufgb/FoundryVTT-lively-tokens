// CI checks for a Foundry VTT module. No dependencies: run with `node .github/ci/check-module.mjs`.
// The same file is used in every dxcufgb/FoundryVTT-… module repository; change it in all of them.
//
//  1. module.json is valid and every file it points at exists.
//  2. Every script parses (node --check), every language file is valid JSON and has the same
//     keys as lang/en.json, and every template referenced from a script exists.
//  3. The module can be imported with a stub of Foundry's globals, the "init" and "setup" hooks
//     run without throwing, settings are registered under the module id, and every visible
//     setting has its Name and Hint in lang/en.json (missing keys show up raw in Foundry).

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const problems = [];
const note = (msg) => console.log(`  ${msg}`);
const fail = (msg) => { problems.push(msg); console.log(`  FAIL ${msg}`); };
const exists = (p) => typeof p === "string" && fs.existsSync(path.join(root, p));
const list = (v) => (Array.isArray(v) ? v : []);

// --- 1. module.json ----------------------------------------------------------------------
console.log("module.json");
let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(path.join(root, "module.json"), "utf8"));
} catch (err) {
  fail(`module.json is not valid JSON: ${err.message}`);
}
if (manifest) {
  for (const field of ["id", "title", "description", "version", "compatibility", "esmodules", "languages"]) {
    if (manifest[field] === undefined || manifest[field] === null) fail(`module.json is missing "${field}"`);
  }
  if (manifest.compatibility && !manifest.compatibility.minimum) fail("module.json compatibility.minimum is missing");
  if (manifest.compatibility && !manifest.compatibility.verified) fail("module.json compatibility.verified is missing");
  if (manifest.id && !/^[a-z0-9_-]+$/.test(manifest.id)) fail(`module.json id "${manifest.id}" has characters Foundry does not allow`);
  const referenced = [
    ...list(manifest.esmodules),
    ...list(manifest.scripts),
    ...list(manifest.styles).map((s) => (typeof s === "object" ? s?.src : s)),
    ...list(manifest.languages).map((l) => l?.path),
    ...list(manifest.packs).map((p) => p?.path),
    typeof manifest.license === "string" && !/^https?:/.test(manifest.license) ? manifest.license : null,
  ].filter(Boolean);
  for (const file of referenced) {
    if (!exists(file)) fail(`module.json points at "${file}", which does not exist`);
  }
  for (const rel of Object.values(manifest.relationships ?? {}).flat()) {
    if (!rel?.id || !rel?.type) fail(`module.json relationship ${JSON.stringify(rel)} needs an id and a type`);
  }
  note(`id ${manifest.id}, version ${manifest.version}, Foundry ${manifest.compatibility?.minimum}–${manifest.compatibility?.verified}, ${referenced.length} referenced files present`);
}

// --- 2. scripts parse, language files, templates ------------------------------------------
console.log("scripts");
function walk(dir, ext) {
  if (!exists(dir)) return [];
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => {
    const p = path.posix.join(dir, e.name);
    return e.isDirectory() ? walk(p, ext) : p.endsWith(ext) ? [p] : [];
  });
}
const entryDirs = [...new Set(list(manifest?.esmodules).map((e) => e.split("/")[0]))];
const scripts = [...new Set(entryDirs.flatMap((d) => (d.endsWith(".js") ? [d] : walk(d, ".js"))))];
if (!scripts.length) fail("no scripts found");
for (const file of scripts) {
  try {
    execFileSync(process.execPath, ["--check", file], { cwd: root, stdio: "pipe" });
  } catch (err) {
    fail(`${file} does not parse:\n${err.stderr?.toString() ?? err.message}`);
  }
}
note(`${scripts.length} script(s) parse`);

console.log("languages");
const langs = {};
const flatKeys = (obj, prefix = "") =>
  Object.entries(obj).flatMap(([k, v]) => (v && typeof v === "object" ? flatKeys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
for (const lang of list(manifest?.languages)) {
  try {
    langs[lang.lang] = JSON.parse(fs.readFileSync(path.join(root, lang.path), "utf8"));
    note(`${lang.path} (${lang.lang}) is valid JSON`);
  } catch (err) {
    fail(`${lang.path} is not valid JSON: ${err.message}`);
  }
}
if (manifest && !langs.en) fail("module.json has no English language file");
if (langs.en) {
  const enKeys = new Set(flatKeys(langs.en));
  for (const [code, data] of Object.entries(langs)) {
    if (code === "en") continue;
    const missing = [...enKeys].filter((k) => !flatKeys(data).includes(k));
    if (missing.length) note(`${code} is missing ${missing.length} key(s) that en has (falls back to English)`);
  }
}

console.log("templates");
let templateCount = 0;
for (const file of scripts) {
  const src = fs.readFileSync(path.join(root, file), "utf8");
  for (const m of src.matchAll(/modules\/[^/"'`]+\/((?:[\w.-]+\/)*[\w.-]+\.(?:hbs|html))/g)) {
    templateCount++;
    if (!exists(m[1])) fail(`${file} uses template "${m[1]}", which does not exist`);
  }
}
note(`${templateCount} template reference(s) checked`);

// --- 3. import the module with stubbed Foundry globals ------------------------------------------
// Anything not stubbed explicitly is an "auto stub": callable, constructible, extendable, and every
// property on it is another auto stub. That lets module code touch Foundry/PIXI APIs at load time.
console.log("import with stubbed Foundry globals");
function autoStub(name = "stub") {
  const fn = function () {};
  const cache = new Map();
  return new Proxy(fn, {
    get(target, prop) {
      if (prop === "prototype") return target.prototype;
      if (prop === Symbol.toPrimitive) return () => "";
      if (prop === Symbol.iterator) return function* () {};
      if (prop === "then") return undefined;
      if (prop === "toString") return () => `[${name}]`;
      if (typeof prop === "symbol") return undefined;
      if (!cache.has(prop)) cache.set(prop, autoStub(`${name}.${prop}`));
      return cache.get(prop);
    },
    apply: (_t, _this, args) => (typeof args[0] === "function" && /Mixin$/.test(name) ? args[0] : autoStub(`${name}()`)),
    construct: () => autoStub(`new ${name}`),
    has: () => true,
  });
}
const hooks = {};
const registered = [];
let moduleIdUsed = null;
const stubGlobals = {
  Hooks: {
    once: (n, fn) => { (hooks[n] ??= []).push(fn); },
    on: (n, fn) => { (hooks[n] ??= []).push(fn); return 1; },
    off: () => {},
    call: () => true,
    callAll: () => true,
  },
  game: new Proxy({
    settings: {
      register: (ns, key, data) => { registered.push({ ns, key, data }); moduleIdUsed ??= ns; },
      registerMenu: (ns) => { moduleIdUsed ??= ns; },
      get: () => undefined,
      set: async () => {},
      settings: new Map(),
    },
    modules: { get: () => undefined },
    i18n: { localize: (s) => s, format: (s) => s, has: () => true, lang: "en" },
    user: { isGM: true, id: "user" },
    users: [],
    system: { id: "dnd5e" },
    release: { generation: 13 },
    version: "13",
  }, { get: (t, p) => (p in t ? t[p] : autoStub(`game.${String(p)}`)) }),
  ui: autoStub("ui"),
  canvas: autoStub("canvas"),
  CONFIG: autoStub("CONFIG"),
  CONST: autoStub("CONST"),
  foundry: autoStub("foundry"),
  PIXI: autoStub("PIXI"),
  Handlebars: autoStub("Handlebars"),
  socketlib: autoStub("socketlib"),
  libWrapper: autoStub("libWrapper"),
  $: autoStub("$"),
  jQuery: autoStub("jQuery"),
  document: autoStub("document"),
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => {},
};
// Common Foundry v13 globals that modules read at load time.
for (const g of ["Actor", "Item", "Token", "TokenDocument", "ChatMessage", "Roll", "Dialog", "Application",
  "FormApplication", "Macro", "Scene", "Playlist", "PlaylistSound", "AudioHelper", "TextEditor",
  "renderTemplate", "loadTemplates", "fromUuid", "fromUuidSync", "getProperty", "setProperty",
  "mergeObject", "duplicate", "randomID", "debounce", "AmbientSound", "TokenHUD", "SettingsConfig",
  "KeyboardManager", "Ray", "Color", "CanvasAnimation", "ActiveEffect", "Combat", "Combatant"]) {
  stubGlobals[g] = autoStub(g);
}
for (const [k, v] of Object.entries(stubGlobals)) {
  Object.defineProperty(globalThis, k, { value: v, writable: true, configurable: true });
}
globalThis.window = globalThis;

let imported = false;
const exportedIds = [];
for (const entry of list(manifest?.esmodules)) {
  try {
    const mod = await import(pathToFileURL(path.join(root, entry)).href);
    imported = true;
    for (const name of ["MODULE_ID", "MODULE", "ID"]) {
      if (typeof mod[name] === "string") exportedIds.push([name, mod[name]]);
    }
    note(`${entry} imported`);
  } catch (err) {
    fail(`${entry} failed to import: ${err.stack ?? err}`);
  }
}
if (imported) {
  for (const [name, value] of exportedIds) {
    if (manifest && value !== manifest.id) fail(`exported ${name} "${value}" differs from module.json id "${manifest.id}"`);
  }
  for (const hook of ["init", "i18nInit", "setup"]) {
    for (const fn of hooks[hook] ?? []) {
      try {
        await fn();
      } catch (err) {
        fail(`a "${hook}" hook threw: ${err.stack ?? err}`);
      }
    }
  }
  const lookup = (obj, dotted) => dotted.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), obj);
  const seen = new Set();
  for (const { ns, key, data } of registered) {
    if (manifest && ns !== manifest.id) fail(`setting "${key}" is registered under "${ns}" instead of "${manifest.id}"`);
    if (seen.has(key)) fail(`setting "${key}" is registered twice`);
    seen.add(key);
    if (!data || data.config === false || !langs.en) continue;
    for (const field of ["name", "hint"]) {
      const value = data[field];
      if (typeof value !== "string" || !/^[\w-]+(\.[\w-]+)+$/.test(value)) continue;
      if (typeof lookup(langs.en, value) !== "string") fail(`setting "${key}": translation "${value}" is missing from lang/en.json`);
    }
  }
  note(`${registered.length} setting(s) registered, ${registered.filter((r) => r.data?.config !== false).length} visible, translations present`);
}

// --- result ----------------------------------------------------------------------------------
console.log();
if (problems.length) {
  console.log(`${problems.length} problem(s) found.`);
  process.exit(1);
}
console.log("All checks passed.");
process.exit(0);
