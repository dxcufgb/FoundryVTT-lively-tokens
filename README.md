# Dxcufgb's lively tokens

Cinematic animated rings around tokens: vines that sway, smoke that curls, chains that creep, gears that tick, flames, runes, sunbeams, drifting petals, fireflies and swirling wormholes. Give your players' characters (or your villains) a presence on the map.

**Foundry VTT:** v13 · system agnostic (tested with dnd5e 5.2.5)

## Installation

In Foundry: **Add-on Modules → Install Module**, paste this link into **Manifest URL** at the bottom, and click **Install**:

```
https://github.com/dxcufgb/FoundryVTT-lively-tokens/releases/latest/download/module.json
```

## Features

- **10 ring designs, each with several styles:**

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

- **Auto-scaling:** rings grow with the token's size (Medium, Large, Huge, ...), particles too.
- **Token Controls button** (ring icon) opens the **Animated Border** window:
  - live preview of the ring around your selected token
  - fine-tune size, speed, opacity, number of particles and an optional colour of your own
  - apply to or remove from all selected tokens, copy a ring from a token
  - optionally also store it on the actor's prototype token, so new tokens of that actor get it too
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
api.setRing(token, { design: "flame", style: "blue", scale: 1.2 });
api.clearRing(token);
api.designs;                                                  // all designs and styles
```

## License

Code: [MIT](LICENSE).

The sprites in `textures/` (smoke, flames, stars, swirls, rune circle) come from the [Particle Pack](https://kenney.nl/assets/particle-pack) by Kenney (www.kenney.nl), [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain), see [textures/LICENSE-Kenney.txt](textures/LICENSE-Kenney.txt). The ring bands, leaves, petals and glows are drawn by the module's own code. Everything is free to use, change and share.
