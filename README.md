# Dxcufgb's lively tokens

[![Foundry v13](https://img.shields.io/github/v/release/dxcufgb/FoundryVTT-lively-tokens?label=Foundry%20v13&logo=foundryvirtualtabletop&color=ff6400)](https://github.com/dxcufgb/FoundryVTT-lively-tokens/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/dxcufgb/FoundryVTT-lively-tokens/module.zip?label=downloads&color=blue)](https://github.com/dxcufgb/FoundryVTT-lively-tokens/releases)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-support-FF5E5B?logo=kofi&logoColor=white)](https://ko-fi.com/dxcufgb)\
[![CI](https://img.shields.io/github/actions/workflow/status/dxcufgb/FoundryVTT-lively-tokens/ci.yml?branch=main&label=CI)](https://github.com/dxcufgb/FoundryVTT-lively-tokens/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/dxcufgb/FoundryVTT-lively-tokens)](LICENSE)

<a href="https://dxcufgb.github.io/FVTT-dev-showcase/"><img src="https://dxcufgb.github.io/FVTT-dev-showcase/assets/img/workshop-badge.png" alt="Dxcufgb's Workshop: every Foundry VTT project, video and changelog in one place" width="650"></a>

Cinematic animated effects around tokens: vines that sway, smoke that curls, chains that creep, gears that tick, flames, runes, sunbeams, drifting petals, fireflies, swirling wormholes, lightning, ice, water, force fields, music, hearts, necrotic tendrils, orbiting stones and circling knives, plus a particle effect for every D&D 5e class, species and background. Stack several into one ring, or bring your own image. Give your players' characters (or your villains) a presence on the map.

Everything is drawn live around the token: particle emitters, and for the general designs also a moving band drawn by a shader. A "ring" in this module is the stack of those effects on a token. It is not a token frame, and it does not use or replace Foundry's own dynamic token rings.

**Foundry VTT:** v13 · system agnostic (tested with dnd5e 5.2.5)

## Installation

In Foundry: **Add-on Modules → Install Module**, paste this link into **Manifest URL** at the bottom, and click **Install**:

```
https://github.com/dxcufgb/FoundryVTT-lively-tokens/releases/latest/download/module.json
```

Requirements and updating: see [Installation](https://github.com/dxcufgb/FoundryVTT-lively-tokens/wiki/Installation) in the wiki.

## Documentation

The full guide is in the [wiki](https://github.com/dxcufgb/FoundryVTT-lively-tokens/wiki):

- [The Animated Border Window](https://github.com/dxcufgb/FoundryVTT-lively-tokens/wiki/The-Animated-Border-Window): opening it, layers, your own images, applying rings, saving, export and import
- [Designs and Styles](https://github.com/dxcufgb/FoundryVTT-lively-tokens/wiki/Designs-and-Styles): all 63 designs and their styles
- [Automatic Character Rings](https://github.com/dxcufgb/FoundryVTT-lively-tokens/wiki/Automatic-Character-Rings): D&D 5e rings from class, species and background
- [Settings](https://github.com/dxcufgb/FoundryVTT-lively-tokens/wiki/Settings): every world and per-user setting
- [API](https://github.com/dxcufgb/FoundryVTT-lively-tokens/wiki/API): for macro and module authors, with the ring and file formats and stored data
- [Troubleshooting](https://github.com/dxcufgb/FoundryVTT-lively-tokens/wiki/Troubleshooting): common problems and fixes
- [Credits](https://github.com/dxcufgb/FoundryVTT-lively-tokens/wiki/Credits): code and texture licences

## License

Code: [MIT](LICENSE).

The sprites in `textures/` (smoke, flames, stars, swirls, rune circle) come from the [Particle Pack](https://kenney.nl/assets/particle-pack) by Kenney (www.kenney.nl), [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain), see [textures/LICENSE-Kenney.txt](textures/LICENSE-Kenney.txt). The ring bands, leaves, petals, glows, sparkles, bubbles, notes, hearts, stones and knives are drawn by the module's own code; no other image files are included. Everything is free to use, change and share.

## Releasing

For the maintainer: **Actions → Release module → Run workflow**, type the version (for example `1.2.3`) and run it. The module is checked and packaged first; only then is the release `v1.2.3` published with `module.json` and `module.zip`. CI and releases come from [dxcufgb/foundry-module-ci](https://github.com/dxcufgb/foundry-module-ci), the same for every module.
