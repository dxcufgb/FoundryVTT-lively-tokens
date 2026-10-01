# Dxcufgb's lively tokens

Cinematic animated rings around tokens: vines that sway, smoke that curls, chains that creep, gears that tick, flames, runes, sunbeams, drifting petals, fireflies, swirling wormholes, lightning, ice, water, force fields, music, hearts, necrotic tendrils, orbiting stones and circling knives. Stack several into one ring, or bring your own image. Give your players' characters (or your villains) a presence on the map.

**Foundry VTT:** v13 · system agnostic (tested with dnd5e 5.2.5)

## Installation

In Foundry: **Add-on Modules → Install Module**, paste this link into **Manifest URL** at the bottom, and click **Install**:

```
https://github.com/dxcufgb/FoundryVTT-lively-tokens/releases/latest/download/module.json
```

## Features

- **19 ring designs, each with several styles:**

  | Design | Styles |
  | --- | --- |
  | Druid | Verdant, Autumn, Moonlit, Thornwild |
  | Magic Smoke | Arcane, Shadow, Emerald, Crimson |
  | Chains | Iron, Gold, Spectral, Hellforged |
  | Clockwork | Brass, Steel, Copper, Arcane Engine |
  | Swirling Flame | Fire, Blue Flame, Fel Fire, Shadowflame |
  | Glyphs | Arcane, Infernal, Holy, Fey |
  | God Rays | Holy, Sunfire, Moonlight, Eclipse |
  | Leaves & Petals | Cherry Blossom, Autumn Leaves, Spring Leaves, Snowfall |
  | Particles | Fireflies, Embers, Stardust, Arcane Motes |
  | Wormholes | Void, Nebula, Abyss, Solar Rift |
  | Storm | Thunder, Arcane, Golden, Crimson |
  | Frost | Frost, Glacier, Rime, Amethyst |
  | Tide | Ocean, Tropical, Swamp, Blood |
  | Arcane Ward | Arcane, Holy, Nature, Infernal |
  | Bard's Song | Golden, Silver, Rose, Azure |
  | Charm | Rose, Lovesick, Crimson, Fae |
  | Necrotic | Necrotic, Shadow, Blood, Bone |
  | Orbiting Stones | Granite, Sandstone, Obsidian, Jade |
  | Knives | Steel, Assassin, Gilded, Spectral |

- **Layers: combine effects into one ring.** Stack up to 6 layers, for example Swirling Flame + Hellforged Chains + Embers. Each layer has its own design, style, fine-tuning and effects; reorder, duplicate or remove them.
- **Your own image as an effect.** Pick *Your image*, then **Browse** to an image or **Upload** a PNG (it goes into `worlds/<your world>/dxcufgbs-lively-tokens/`). Choose how it moves (centred, turning, circling, drifting, rising, fluttering, puffs, swirling in), its size and how many, and its colour:
  - *Original colours*, *Tint* (multiply by a colour), *Recolour* (keep the light and shade, paint it in one colour) or *Shift hue*
  - optionally *Glow like light* (additive blending)

  Uploading needs Foundry's *Upload New Files* permission; players without it can still pick an image that is already on the server, or type its path or URL.
- **Effects for every layer:** *Glow* (a soft halo in the layer's own colours), *Pulse* (breathes in and out), *Rainbow* (cycles through all colours) and *Spin* (turns the whole layer either way).
- **Saved effects:** save the whole stack under a name and load it again later. Saved effects belong to your user, so they follow you to any computer.

- **Auto-scaling:** rings grow with the token's size (Medium, Large, Huge, ...), particles too.
- **Token Controls button** (ring icon) opens the **Animated Border** window:
  - live preview of the ring around your selected token
  - fine-tune size, speed, opacity, number of particles and an optional colour of your own, per layer
  - apply to or remove from all selected tokens, copy a ring from a token
  - optionally also store it on the actor's prototype token, so new tokens of that actor get it too
- **Open it for a character**, wherever you are working with it:
  - **Character sheet:** *Animated token ring* in the sheet's header controls menu (the **⋮** button), or a **Ring** header button on older-style sheets
  - **Actors sidebar:** right-click an actor → *Animated token ring*
  - **Token HUD:** the ring button in the left column (for the selected tokens)

  Opened for a character, the window works on that character's tokens on the current scene and its prototype token (so a character with no token placed yet still gets its ring). *Use selected tokens instead* switches back to the canvas selection.
- Rings are part of the token on the canvas, so they follow movement, visibility and elevation instantly: no drift, no lag.
- **Players** can give rings to tokens they own (a world setting lets the GM turn this off).
- If another animated token border / ring module is active and adds its own Token Controls button, that button is moved into this window, so both share one place in the toolbar.

## Settings

- **Players can give their tokens rings** (world): on by default.
- **Show animated rings** (per user): turn the rings off on this computer only.
- **Ring detail** (per user): High / Medium / Low number of particles.

## API

```js
const api = game.modules.get("dxcufgbs-lively-tokens").api;
api.open();                                                   // the Animated Border window
api.open({ actor });                                          // ... for one actor
api.setActorRing(actor, { design: "druid" });                 // its tokens on the scene + prototype token
api.clearActorRing(actor);
api.setRing(token, { design: "flame", style: "blue", scale: 1.2 });   // one layer
api.setRing(token, { layers: [                                // several, bottom to top
  { design: "flame", style: "fire" },
  { design: "chains", style: "hellforged", glow: 0.5 },
  { design: "custom", src: "path/to/crest.png", motion: "orbit", count: 4, size: 0.25, colorMode: "colorize", color: "#ff8a2a" }
] });
api.clearRing(token);
api.designs;                                                  // all designs and styles
api.presets();                                                // your saved effects
```

## License

Code: [MIT](LICENSE).

The sprites in `textures/` (smoke, flames, stars, swirls, rune circle) come from the [Particle Pack](https://kenney.nl/assets/particle-pack) by Kenney (www.kenney.nl), [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain), see [textures/LICENSE-Kenney.txt](textures/LICENSE-Kenney.txt). The ring bands, leaves, petals, glows, sparkles, bubbles, notes, hearts, stones and knives are drawn by the module's own code; no other image files are included. Everything is free to use, change and share.
