/**
 * The Animated Border window: pick a design and style, tune it, preview it live
 * around the selected token, and apply it to the selected tokens.
 *
 * Opened with an actor (from its character sheet, the Actors sidebar or the API) the window works
 * on that actor instead: its tokens on the current scene and its prototype token.
 */

import { DESIGNS, normalizeConfig, LivelyRing } from "./ring.js";
import { MODULE_ID } from "./constants.js";
import {
  canUse, partners, partnerModules, setRing, clearRing, tokenRing, textures,
  actorTokens, baseActor, prototypeRing, setActorRing, clearActorRing
} from "./main.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const PREVIEW = 320;   // preview canvas size in px

export class LivelyTokensConfig extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "dxlt-config",
    classes: ["dxlt-config"],
    tag: "div",
    window: { title: "DXLT.App.Title", icon: "fa-solid fa-ring", resizable: false },
    position: { width: 800, height: "auto" },
    actions: {
      design: LivelyTokensConfig.#onDesign,
      style: LivelyTokensConfig.#onStyle,
      apply: LivelyTokensConfig.#onApply,
      remove: LivelyTokensConfig.#onRemove,
      copy: LivelyTokensConfig.#onCopy,
      reset: LivelyTokensConfig.#onReset,
      partner: LivelyTokensConfig.#onPartner,
      useSelection: LivelyTokensConfig.#onUseSelection
    }
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/config.hbs` }
  };

  /** The open window, if any. */
  static instance = null;

  /**
   * Open the window.
   * @param {object} [opts]
   * @param {Actor} [opts.actor]  work on this actor (its tokens and prototype token) instead of the selected tokens
   */
  static open({ actor = null } = {}) {
    if (!canUse()) {
      ui.notifications.warn(game.i18n.localize("DXLT.App.NotAllowed"));
      return null;
    }
    if (actor && !actor.isOwner) return null;
    if (this.instance) this.instance.setActor(actor);
    else this.instance = new this({ actor });
    // Only a window that is already on screen has an element to raise; a new one opens on top anyway.
    if (this.instance.rendered) this.instance.bringToFront();
    this.instance.render({ force: true });
    return this.instance;
  }

  constructor({ actor = null, ...options } = {}) {
    super(options);
    this.actor = actor;
    this.cfg = this.#initialConfig();
    this.prototype = true;
    this.previewApp = null;
    this.previewRing = null;
    this.previewToken = null;
    this.previewSrc = null;
  }

  /** Tokens the window works on: the actor's tokens on this scene, or the selected tokens the user may change. */
  #targets() {
    if (this.actor) return actorTokens(this.actor);
    return (canvas?.tokens?.controlled ?? []).filter(t => t.document?.isOwner);
  }

  /** The ring to start the editor with: the target's own ring, else the last one used. */
  #initialConfig() {
    const own = tokenRing(this.#targets()[0]) ?? (this.actor ? prototypeRing(this.actor) : null);
    return normalizeConfig(own ?? game.settings.get(MODULE_ID, "lastConfig"));
  }

  /** Switch between an actor and the token selection (null) while the window is open. */
  setActor(actor) {
    if ((actor ?? null) === this.actor) return;
    this.actor = actor ?? null;
    this.cfg = this.#initialConfig();
    this.previewSrc = null;
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  async _prepareContext(options) {
    const targets = this.#targets();
    const design = DESIGNS[this.cfg.design];
    const names = list => list.slice(0, 4).join(", ") + (list.length > 4 ? ", …" : "");
    let targetText;
    if (this.actor) {
      targetText = game.i18n.format(targets.length ? "DXLT.App.ForActor" : "DXLT.App.ForActorNoTokens",
        { name: this.actor.name, n: targets.length });
    } else {
      targetText = targets.length
        ? game.i18n.format("DXLT.App.Selected", { names: names(targets.map(t => t.name)) })
        : game.i18n.localize("DXLT.App.NoneSelected");
    }
    const pct = v => Math.round(v * 100);
    return {
      designs: Object.entries(DESIGNS).map(([id, d]) => ({ id, label: d.label, icon: d.icon, active: id === this.cfg.design })),
      styles: Object.entries(design.styles).map(([id, s]) => ({ id, label: s.label, active: id === this.cfg.style })),
      designLabel: design.label,
      cfg: this.cfg,
      sliders: [
        { name: "scale", label: "DXLT.App.Size", min: 0.6, max: 2, step: 0.05, value: this.cfg.scale, text: `${pct(this.cfg.scale)}%` },
        { name: "speed", label: "DXLT.App.Speed", min: 0, max: 3, step: 0.05, value: this.cfg.speed, text: `${pct(this.cfg.speed)}%` },
        { name: "alpha", label: "DXLT.App.Opacity", min: 0.1, max: 1, step: 0.05, value: this.cfg.alpha, text: `${pct(this.cfg.alpha)}%` },
        { name: "density", label: "DXLT.App.Density", min: 0, max: 2.5, step: 0.05, value: this.cfg.density, text: `${pct(this.cfg.density)}%` }
      ],
      useColor: !!this.cfg.color,
      color: this.cfg.color ?? "#8a5aff",
      prototype: this.prototype || (!!this.actor && !targets.length),
      prototypeLocked: !!this.actor && !targets.length,
      actor: this.actor ? { name: this.actor.name, img: this.actor.img } : null,
      targets: targets.map(t => t.name),
      targetText,
      canApply: this.actor ? baseActor(this.actor)?.isOwner ?? false : targets.length > 0,
      canCopy: targets.length > 0 || (!!this.actor && !!prototypeRing(this.actor)),
      partners: partners().map((p, i) => ({ index: i, title: p.title, icon: p.icon || "fa-solid fa-circle-notch" })),
      partnerModules: partners().length ? [] : partnerModules().map(m => m.title)
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const html = this.element;

    // Sliders and colour update the preview live, without re-rendering the window.
    for (const input of html.querySelectorAll("input[type=range]")) {
      input.addEventListener("input", ev => {
        const k = ev.currentTarget.name;
        this.cfg[k] = Number(ev.currentTarget.value);
        const out = html.querySelector(`output[data-for="${k}"]`);
        if (out) out.textContent = `${Math.round(this.cfg[k] * 100)}%`;
        this.#rebuildPreview();
      });
    }
    const useColor = html.querySelector("input[name=useColor]");
    const color = html.querySelector("input[name=color]");
    const onColor = () => {
      this.cfg.color = useColor.checked ? color.value : null;
      color.disabled = !useColor.checked;
      this.#rebuildPreview();
    };
    useColor?.addEventListener("change", onColor);
    color?.addEventListener("input", onColor);
    html.querySelector("input[name=prototype]")?.addEventListener("change", ev => { this.prototype = ev.currentTarget.checked; });

    await this.#mountPreview();
  }

  /* -------------------------------------------- */
  /*  Preview                                     */
  /* -------------------------------------------- */

  async #mountPreview() {
    const host = this.element.querySelector(".dxlt-preview");
    if (!host) return;
    if (!this.previewApp) {
      this.previewApp = new PIXI.Application({ width: PREVIEW, height: PREVIEW, backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: window.devicePixelRatio || 1 });
      this.previewStage = new PIXI.Container();
      this.previewStage.position.set(PREVIEW / 2, PREVIEW / 2);
      this.previewApp.stage.addChild(this.previewStage);
      this.previewApp.ticker.add(() => this.previewRing?.update(this.previewApp.ticker.deltaMS / 1000));
    }
    host.appendChild(this.previewApp.view);
    await this.#updatePreviewToken();
    this.#rebuildPreview();
  }

  /** Radius of the token in the preview, so the ring fits the canvas at any size. */
  #previewRadius() {
    return Math.min(78, (PREVIEW / 2 - 6) / (1.55 * this.cfg.scale));
  }

  async #updatePreviewToken() {
    const token = this.#targets()[0] ?? (this.actor ? null : canvas?.tokens?.controlled?.[0]);
    const src = token?.document?.texture?.src
      ?? baseActor(this.actor)?.prototypeToken?.texture?.src ?? this.actor?.img ?? CONST.DEFAULT_TOKEN;
    if (src === this.previewSrc && this.previewToken) return;
    this.previewSrc = src;
    this.previewToken?.destroy();
    let tex;
    try { tex = await foundry.canvas.loadTexture(src); } catch (_) { tex = null; }
    const sprite = new PIXI.Sprite(tex ?? PIXI.Texture.WHITE);
    sprite.anchor.set(0.5);
    if (!tex) sprite.tint = 0x555555;
    this.previewToken = sprite;
    this.previewStage.addChildAt(sprite, 0);
  }

  async #rebuildPreview() {
    if (!this.previewApp) return;
    const tex = await textures();
    const R = this.#previewRadius();
    if (this.previewToken) {
      const t = this.previewToken.texture;
      const s = (2 * R) / Math.max(t.width || 1, t.height || 1);
      this.previewToken.scale.set(s);
    }
    this.previewRing?.destroy();
    this.previewRing = new LivelyRing(this.cfg, tex, 1);
    this.previewRing.setRadius(R);
    this.previewStage.addChild(this.previewRing);
  }

  /** Called when the token selection changes on the canvas. */
  onSelectionChanged() {
    if (!this.rendered || this.actor) return;
    clearTimeout(this._selTimer);
    this._selTimer = setTimeout(() => this.render({ parts: ["main"] }), 50);
  }

  async close(options) {
    this.previewRing?.destroy();
    this.previewApp?.destroy(true, { children: true });
    this.previewApp = this.previewRing = this.previewToken = null;
    this.previewSrc = null;
    LivelyTokensConfig.instance = null;
    return super.close(options);
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  static #onDesign(event, target) {
    const id = target.dataset.design;
    if (!DESIGNS[id] || id === this.cfg.design) return;
    this.cfg.design = id;
    this.cfg.style = Object.keys(DESIGNS[id].styles)[0];
    this.render({ parts: ["main"] });
  }

  static #onStyle(event, target) {
    const id = target.dataset.style;
    if (!DESIGNS[this.cfg.design].styles[id]) return;
    this.cfg.style = id;
    this.render({ parts: ["main"] });
  }

  static async #onApply() {
    if (this.actor) {
      const cfg = normalizeConfig(this.cfg);
      const n = await setActorRing(this.actor, cfg, { prototype: this.prototype });
      await game.settings.set(MODULE_ID, "lastConfig", cfg);
      return ui.notifications.info(game.i18n.format(n ? "DXLT.App.Applied" : "DXLT.App.AppliedPrototype", { n, name: this.actor.name }));
    }
    const targets = this.#targets();
    if (!targets.length) return ui.notifications.warn(game.i18n.localize("DXLT.App.NoneSelected"));
    const cfg = normalizeConfig(this.cfg);
    await Promise.all(targets.map(t => setRing(t, cfg, { prototype: this.prototype })));
    await game.settings.set(MODULE_ID, "lastConfig", cfg);
    ui.notifications.info(game.i18n.format("DXLT.App.Applied", { n: targets.length }));
  }

  static async #onRemove() {
    if (this.actor) {
      const n = await clearActorRing(this.actor, { prototype: this.prototype });
      return ui.notifications.info(game.i18n.format(n ? "DXLT.App.Removed" : "DXLT.App.RemovedPrototype", { n, name: this.actor.name }));
    }
    const targets = this.#targets();
    if (!targets.length) return ui.notifications.warn(game.i18n.localize("DXLT.App.NoneSelected"));
    await Promise.all(targets.map(t => clearRing(t, { prototype: this.prototype })));
    ui.notifications.info(game.i18n.format("DXLT.App.Removed", { n: targets.length }));
  }

  static #onCopy() {
    const cfg = tokenRing(this.#targets()[0]) ?? (this.actor ? prototypeRing(this.actor) : null);
    if (!cfg) return ui.notifications.info(game.i18n.localize("DXLT.App.NoRing"));
    this.cfg = cfg;
    this.render({ parts: ["main"] });
  }

  static #onReset() {
    this.cfg = normalizeConfig({ design: this.cfg.design, style: this.cfg.style });
    this.render({ parts: ["main"] });
  }

  /** Leave the actor and work on the selected tokens again. */
  static #onUseSelection() {
    this.setActor(null);
    this.render({ parts: ["main"] });
  }

  static #onPartner(event, target) {
    const p = partners()[Number(target.dataset.index)];
    if (!p) return;
    try {
      if (p.onChange) p.onChange(event, true);
      else if (p.onClick) p.onClick(event);
    } catch (err) {
      console.error(`${MODULE_ID} | could not open ${p.title}`, err);
    }
  }
}
