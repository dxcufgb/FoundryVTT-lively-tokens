# Dxcufgb's lively tokens

FoundryVTT v13 module (id `dxcufgbs-lively-tokens`, the install folder must have the same name), system agnostic.
Draws animated rings and particle effects around tokens with PIXI (v7, Foundry's global `PIXI`): a ring is a stack
of up to 20 layers stored as a flag on the token (and optionally its actor's prototype token), edited in the
**Animated Border** window. No build step and no npm dependencies.

## Layout
- `scripts/main.js` – settings, API, the Token-controls button (it folds other "animated border/ring" modules' buttons into the window), syncing rings onto Token placeables (`syncToken`, `placeRing` right above the token's void mesh, `layout`), the single ticker, `setRing` / `clearRing` / `setActorRing` / `clearActorRing`, saved effects (User flag `presets`), and the sheet header, Actors-sidebar and Token HUD entries.
- `scripts/ring.js` – the renderer, needs only global PIXI: `BANDS` (GLSL band shaders), `DESIGNS` (63 designs), `RAMP` / `emitStyles`, `DESIGN_CATEGORIES`, `MOTIONS`, `COLOR_MODES`, `normalizeLayer` / `normalizeConfig` (clamps every field), `loadTextures` (Kenney sheets plus textures drawn on a canvas at runtime), `Swarm` (sprites; `mode: "emit"` is a pooled particle emitter), `LivelyLayer`, `LivelyRing`.
- `scripts/config-app.js`, `templates/config.hbs`, `styles/lively-tokens.css` – the Animated Border window (ApplicationV2) with its own `PIXI.Application` preview.
- `scripts/transfer.js` – `.lively-ring.json` export/import (format `dxcufgbs-lively-tokens.ring`, `FORMAT_VERSION` 1) with embedded images, uploaded on import to `worlds/<world>/dxcufgbs-lively-tokens/imported/`.
- `scripts/constants.js` – `MODULE_ID`, `FLAG` (`"ring"`).
- `textures/` – Kenney Particle Pack sheets (CC0): `smoke`, `flames`, `stars`, `twirls`, `rune`, `ring` (`SHEETS` in `ring.js`).
- `.github/workflows/ci.yml` / `release.yml` – thin callers of `dxcufgb/foundry-module-ci` (checks, packaging, release); identical in every module, do not edit here.

## Conventions
- `MODULE_ID` must equal `id` in `module.json`; every visible setting needs a Name and Hint in `lang/en.json` (CI checks both). UI strings are under `DXLT.*`; design and style labels are plain English in `DESIGNS`.
- A complete new **design** in `DESIGNS`: `label`, a Font Awesome `icon`, `blend`, four `styles` (every existing design has four), each with `label` and `colors: [bright, main, dark]`. Either a `band` that names a shader in `BANDS` (plus optional `swarms` per style), or effects only: no `band`, and every style has `swarms` (usually `emitStyles([...emitters], {id: [label, bright, main, dark]})` with `mode: "emit"` and `RAMP` colours). Class, species and background designs go into their `DESIGN_CATEGORIES` list (anything else is "General"). Then the README designs table and count, and the design list and count in `module.json`'s `description`.
- A new texture name used by a swarm (`tex`) must exist in `loadTextures` (a sheet in `SHEETS` or a drawn texture) and, for emitters, in `EMIT_SCALE`.
- Update `README.md` when designs, settings or the API change.

## Review focus
- **Per-frame cost** scales with tokens × layers × particles: `tick` runs for every ringed token every frame (skipping hidden ones). In `update` paths, no new PIXI objects, filters, textures or arrays per particle beyond what is there, no document lookups, no `normalizeConfig`. Emitters keep a fixed pool (`EMIT_MAX` 600); `count` and `rate` are scaled by the `quality` setting and token size (`sizeFactorOf`). Swarms are rebuilt only when the size factor changes. Shader programs are cached per band (`programs`).
- **Cleanup**: the ring is a child of the Token placeable and is destroyed with it (`destroyToken`, `canvasTearDown` clear `state.tokens`); `syncToken` must destroy an old ring before making a new one and check `token.destroyed` after its `await`. `LivelyLayer.destroy` destroys the band shader; the window's `close()` must destroy the preview ring and `previewApp`. Textures loaded once (`state.textures`) are shared and must not be destroyed with a ring.
- **Permissions**: rings are written only through `setRing` / `clearRing` / `setActorRing` / `clearActorRing`, which require `isOwner` on the token or actor; the window and every entry point check `canUse()` (GM, or the world setting `playersCanUse`) and ownership. Keep those checks on any new write path.
- **Untrusted ring data**: flags written by other users and imported files go through `normalizeConfig` before use. Keep the clamps, the hex check on `color`, and the `javascript:` / `data:text` filter on a custom layer's `src`; on import, images are accepted only by sniffed bytes (PNG, WebP, JPEG, GIF, AVIF; never SVG) and under `MAX_IMAGE_BYTES`. Every client that sees the token loads that `src`.
- **Escaping**: templates use `{{ }}` only; dialog HTML built in code goes through `escapeHTML`.
- **Setting scopes**: `playersCanUse` and `autoRings` are `world`; `enabled`, `quality` and `lastConfig` are `client`.
- **Stored data**: design ids, style ids and layer field names are saved in token flags, prototype tokens, presets and exported files; renaming one silently falls back to the first style or the default design. `normalizeConfig` also accepts a bare single layer (the 1.0 format); keep that.
- Rings sit right after the token's void mesh (see `placeRing`): moving them elsewhere puts them under the token art or above bars and nameplates.
