/**
 * The Animated Border window: build a ring out of one or more layers (a design and style, or an
 * image of your own), tune each layer and its effects, preview it live around the selected token,
 * and apply it to the selected tokens. Rings can be saved by name and loaded again later.
 *
 * Opened with an actor (from its character sheet, the Actors sidebar or the API) the window works
 * on that actor instead: its tokens on the current scene and its prototype token.
 */

import {
  DESIGNS, CUSTOM, MOTIONS, MAX_LAYERS, normalizeConfig, normalizeLayer, layerLabel, LivelyRing
} from "./ring.js";
import { MODULE_ID } from "./constants.js";
import {
  canUse, partners, partnerModules, setRing, clearRing, tokenRing, ringTextures,
  actorTokens, baseActor, prototypeRing, setActorRing, clearActorRing, presets, savePreset, deletePreset
} from "./main.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const PREVIEW = 320;   // preview canvas size in px

const escapeHTML = str => String(str ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** How a slider's value is shown next to it. */
const FORMAT = {
  pct: v => `${Math.round(v * 100)}%`,
  int: v => `${Math.round(v)}`,
  deg: v => `${Math.round(v)}°`,
  spin: v => (v > 0 ? "↻ " : v < 0 ? "↺ " : "") + `${Math.round(Math.abs(v) * 100)}%`
};

export class LivelyTokensConfig extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: "dxlt-config",
    classes: ["dxlt-config"],
    tag: "div",
    window: { title: "DXLT.App.Title", icon: "fa-solid fa-ring", resizable: false },
    position: { width: 880, height: "auto" },
    actions: {
      design: LivelyTokensConfig.#onDesign,
      style: LivelyTokensConfig.#onStyle,
      selectLayer: LivelyTokensConfig.#onSelectLayer,
      addLayer: LivelyTokensConfig.#onAddLayer,
      duplicateLayer: LivelyTokensConfig.#onDuplicateLayer,
      moveLayer: LivelyTokensConfig.#onMoveLayer,
      removeLayer: LivelyTokensConfig.#onRemoveLayer,
      browseImage: LivelyTokensConfig.#onBrowseImage,
      uploadImage: LivelyTokensConfig.#onUploadImage,
      loadPreset: LivelyTokensConfig.#onLoadPreset,
      savePreset: LivelyTokensConfig.#onSavePreset,
      deletePreset: LivelyTokensConfig.#onDeletePreset,
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
    this.#setConfig(this.#initialConfig());
    this.prototype = true;
    this.presetId = null;
    this.previewApp = null;
    this.previewRing = null;
    this.previewToken = null;
    this.previewSrc = null;
    this.previewBuild = 0;
  }

  /** The layer being edited. */
  get layer() {
    return this.cfg.layers[this.sel];
  }

  #setConfig(cfg, sel = 0) {
    this.cfg = normalizeConfig(cfg);
    this.sel = Math.min(Math.max(0, sel), this.cfg.layers.length - 1);
  }

  /** Tokens the window works on: the actor's tokens on this scene, or the selected tokens the user may change. */
  #targets() {
    if (this.actor) return actorTokens(this.actor);
    return (canvas?.tokens?.controlled ?? []).filter(t => t.document?.isOwner);
  }

  /** The ring to start the editor with: the target's own ring, else the last one used. */
  #initialConfig() {
    const own = tokenRing(this.#targets()[0]) ?? (this.actor ? prototypeRing(this.actor) : null);
    return own ?? game.settings.get(MODULE_ID, "lastConfig");
  }

  /** Switch between an actor and the token selection (null) while the window is open. */
  setActor(actor) {
    if ((actor ?? null) === this.actor) return;
    this.actor = actor ?? null;
    this.#setConfig(this.#initialConfig());
    this.previewSrc = null;
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  async _prepareContext(options) {
    const targets = this.#targets();
    const layer = this.layer;
    const isCustom = layer.design === CUSTOM;
    const design = isCustom ? null : DESIGNS[layer.design];
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
    const slider = (name, label, min, max, step, fmt = "pct") =>
      ({ name, label, min, max, step, fmt, value: layer[name], text: FORMAT[fmt](layer[name]) });
    const motion = isCustom ? MOTIONS[layer.motion] : null;
    const saved = presets();
    if (this.presetId && !saved.some(p => p.id === this.presetId)) this.presetId = null;

    return {
      layers: this.cfg.layers.map((l, i) => ({
        index: i,
        label: layerLabel(l) ?? game.i18n.localize("DXLT.App.CustomImage"),
        icon: l.design === CUSTOM ? "fa-solid fa-image" : DESIGNS[l.design].icon,
        thumb: l.design === CUSTOM && l.src ? l.src : null,
        active: i === this.sel
      })),
      layerNumber: this.sel + 1,
      layerCount: this.cfg.layers.length,
      canAddLayer: this.cfg.layers.length < MAX_LAYERS,
      canRemoveLayer: this.cfg.layers.length > 1,
      canMoveDown: this.sel > 0,
      canMoveUp: this.sel < this.cfg.layers.length - 1,
      maxLayers: MAX_LAYERS,

      designs: [
        ...Object.entries(DESIGNS).map(([id, d]) => ({ id, label: d.label, icon: d.icon, active: id === layer.design })),
        { id: CUSTOM, label: game.i18n.localize("DXLT.App.CustomImage"), icon: "fa-solid fa-image", active: isCustom, custom: true }
      ],
      isCustom,
      styles: design ? Object.entries(design.styles).map(([id, s]) => ({ id, label: s.label, active: id === layer.style })) : [],
      designLabel: design?.label ?? "",

      // Your own image
      src: isCustom ? layer.src : "",
      canUpload: game.user.can("FILES_UPLOAD"),
      canBrowse: game.user.can("FILES_BROWSE"),
      motions: Object.entries(MOTIONS).map(([id, m]) => ({ id, label: game.i18n.localize(m.label), selected: id === layer.motion })),
      colorModes: ["original", "tint", "colorize", "hue"].map(id => ({ id, label: game.i18n.localize(`DXLT.ColorMode.${id}`), selected: id === layer.colorMode })),
      customSliders: isCustom ? [
        slider("size", "DXLT.App.ImageSize", 0.05, 2.5, 0.01),
        ...(motion.single ? [] : [slider("count", "DXLT.App.Count", 1, 30, 1, "int")]),
        ...(layer.colorMode === "hue" ? [slider("hue", "DXLT.App.Hue", 0, 360, 1, "deg")] : [])
      ] : [],
      showImageColor: isCustom && (layer.colorMode === "tint" || layer.colorMode === "colorize"),
      additive: isCustom && layer.blend === "add",

      sliders: [
        slider("scale", "DXLT.App.Size", 0.6, 2, 0.05),
        slider("speed", "DXLT.App.Speed", 0, 3, 0.05),
        slider("alpha", "DXLT.App.Opacity", 0.1, 1, 0.05),
        ...(isCustom ? [] : [slider("density", "DXLT.App.Density", 0, 2.5, 0.05)])
      ],
      effects: [
        slider("glow", "DXLT.Effect.Glow", 0, 1, 0.05),
        slider("pulse", "DXLT.Effect.Pulse", 0, 1, 0.05),
        slider("rainbow", "DXLT.Effect.Rainbow", 0, 1, 0.05),
        slider("spin", "DXLT.Effect.Spin", -2, 2, 0.05, "spin")
      ],
      useColor: !!layer.color,
      color: layer.color ?? "#8a5aff",

      presets: saved.map(p => ({ id: p.id, name: p.name, selected: p.id === this.presetId })),
      hasPreset: !!this.presetId,

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
    const layer = () => this.layer;

    // Sliders and colours update the preview live, without re-rendering the window.
    for (const input of html.querySelectorAll("input[type=range]")) {
      input.addEventListener("input", ev => {
        const el = ev.currentTarget;
        const v = Number(el.value);
        layer()[el.name] = el.dataset.fmt === "int" ? Math.round(v) : v;
        const out = html.querySelector(`output[data-for="${el.name}"]`);
        if (out) out.textContent = FORMAT[el.dataset.fmt ?? "pct"](v);
        this.#rebuildPreview();
      });
    }

    const useColor = html.querySelector("input[name=useColor]");
    const color = html.querySelector("input[name=color]");
    if (useColor) {
      const onColor = () => {
        layer().color = useColor.checked ? color.value : null;
        color.disabled = !useColor.checked;
        this.#rebuildPreview();
      };
      useColor.addEventListener("change", onColor);
      color?.addEventListener("input", onColor);
    } else {
      // Own image in "tint" or "colorize" mode: the colour is always on.
      color?.addEventListener("input", ev => { layer().color = ev.currentTarget.value; this.#rebuildPreview(); });
    }

    html.querySelector("select[name=motion]")?.addEventListener("change", ev => {
      const m = MOTIONS[ev.currentTarget.value];
      if (!m) return;
      Object.assign(layer(), { motion: ev.currentTarget.value, size: m.size, count: m.count });
      this.render({ parts: ["main"] });
    });
    html.querySelector("select[name=colorMode]")?.addEventListener("change", ev => {
      const l = layer();
      l.colorMode = ev.currentTarget.value;
      if ((l.colorMode === "tint" || l.colorMode === "colorize") && !l.color) l.color = "#8a5aff";
      this.render({ parts: ["main"] });
    });
    html.querySelector("input[name=additive]")?.addEventListener("change", ev => {
      layer().blend = ev.currentTarget.checked ? "add" : "normal";
      this.#rebuildPreview();
    });
    html.querySelector("input[name=src]")?.addEventListener("change", ev => {
      layer().src = ev.currentTarget.value.trim();
      this.render({ parts: ["main"] });
    });
    html.querySelector("input[name=imageFile]")?.addEventListener("change", ev => {
      const file = ev.currentTarget.files?.[0];
      ev.currentTarget.value = "";
      if (file) this.#upload(file);
    });
    html.querySelector("select[name=preset]")?.addEventListener("change", ev => {
      this.presetId = ev.currentTarget.value || null;
      this.render({ parts: ["main"] });
    });
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

  /** Radius of the token in the preview, so the biggest layer fits the canvas. */
  #previewRadius() {
    const reach = Math.max(...this.cfg.layers.map(l => {
      const own = l.design === CUSTOM && MOTIONS[l.motion].single ? Math.max(1, l.size) : 1.55;
      return own * l.scale * (1 + 0.06 * l.pulse);
    }));
    return Math.min(78, (PREVIEW / 2 - 6) / reach);
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
    const build = ++this.previewBuild;
    const tex = await ringTextures(this.cfg);
    // A newer change arrived while the images loaded, or the window closed.
    if (build !== this.previewBuild || !this.previewApp) return;
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
    this.previewBuild++;
    this.previewRing?.destroy();
    this.previewApp?.destroy(true, { children: true });
    this.previewApp = this.previewRing = this.previewToken = null;
    this.previewSrc = null;
    LivelyTokensConfig.instance = null;
    return super.close(options);
  }

  /* -------------------------------------------- */
  /*  Your own image                              */
  /* -------------------------------------------- */

  #setImage(path) {
    if (!path || this.layer.design !== CUSTOM) return;
    this.layer.src = path;
    this.render({ parts: ["main"] });
  }

  /** Upload a file into the world's folder for this module and use it. */
  async #upload(file) {
    if (!game.user.can("FILES_UPLOAD")) return ui.notifications.warn(game.i18n.localize("DXLT.App.NoUpload"));
    if (!file.type.startsWith("image/")) return ui.notifications.warn(game.i18n.localize("DXLT.App.NotImage"));
    const FP = foundry.applications.apps.FilePicker.implementation;
    const dir = `worlds/${game.world.id}/${MODULE_ID}`;
    try { await FP.createDirectory("data", dir, {}); } catch (_) { /* already there */ }
    try {
      const res = await FP.upload("data", dir, file, {}, { notify: true });
      if (res?.path) this.#setImage(res.path);
    } catch (err) {
      console.error(`${MODULE_ID} | upload failed`, err);
      ui.notifications.error(game.i18n.localize("DXLT.App.UploadFailed"));
    }
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  static #onDesign(event, target) {
    const id = target.dataset.design;
    const old = this.layer;
    if (id === old.design || (id !== CUSTOM && !DESIGNS[id])) return;
    // Keep the fine-tuning and effects, change what is drawn.
    const keep = { scale: old.scale, speed: old.speed, alpha: old.alpha, glow: old.glow, pulse: old.pulse, rainbow: old.rainbow, spin: old.spin };
    this.cfg.layers[this.sel] = normalizeLayer(id === CUSTOM
      ? { ...keep, design: CUSTOM }
      : { ...keep, density: old.density, design: id, style: Object.keys(DESIGNS[id].styles)[0] });
    this.render({ parts: ["main"] });
  }

  static #onStyle(event, target) {
    const id = target.dataset.style;
    const layer = this.layer;
    if (layer.design === CUSTOM || !DESIGNS[layer.design].styles[id]) return;
    layer.style = id;
    this.render({ parts: ["main"] });
  }

  static #onSelectLayer(event, target) {
    const i = Number(target.dataset.index);
    if (!this.cfg.layers[i] || i === this.sel) return;
    this.sel = i;
    this.render({ parts: ["main"] });
  }

  static #onAddLayer() {
    if (this.cfg.layers.length >= MAX_LAYERS) return;
    // A light particle layer is the most common thing to add on top of a ring.
    this.cfg.layers.push(normalizeLayer({ design: "particles", style: "stardust" }));
    this.sel = this.cfg.layers.length - 1;
    this.render({ parts: ["main"] });
  }

  static #onDuplicateLayer() {
    if (this.cfg.layers.length >= MAX_LAYERS) return;
    this.cfg.layers.splice(this.sel + 1, 0, foundry.utils.deepClone(this.layer));
    this.sel++;
    this.render({ parts: ["main"] });
  }

  /** Move the layer towards the top (+1, drawn later) or the bottom (-1). */
  static #onMoveLayer(event, target) {
    const to = this.sel + Number(target.dataset.dir);
    if (to < 0 || to >= this.cfg.layers.length) return;
    const [l] = this.cfg.layers.splice(this.sel, 1);
    this.cfg.layers.splice(to, 0, l);
    this.sel = to;
    this.render({ parts: ["main"] });
  }

  static #onRemoveLayer() {
    if (this.cfg.layers.length <= 1) return;
    this.cfg.layers.splice(this.sel, 1);
    this.sel = Math.min(this.sel, this.cfg.layers.length - 1);
    this.render({ parts: ["main"] });
  }

  static #onBrowseImage() {
    const FP = foundry.applications.apps.FilePicker.implementation;
    new FP({ type: "image", current: this.layer.src || "", callback: path => this.#setImage(path) }).render(true);
  }

  static #onUploadImage() {
    this.element.querySelector("input[name=imageFile]")?.click();
  }

  static #onLoadPreset() {
    const p = presets().find(x => x.id === this.presetId);
    if (!p) return;
    this.#setConfig(foundry.utils.deepClone(p.cfg));
    this.render({ parts: ["main"] });
  }

  static async #onSavePreset() {
    const current = presets().find(x => x.id === this.presetId);
    const value = escapeHTML(current?.name);
    let name;
    try {
      name = await foundry.applications.api.DialogV2.prompt({
        window: { title: "DXLT.App.SaveTitle" },
        content: `<label>${game.i18n.localize("DXLT.App.SaveName")} <input type="text" name="name" value="${value}" maxlength="60" autofocus></label>`,
        ok: { label: "DXLT.App.Save", icon: "fa-solid fa-floppy-disk", callback: (ev, button) => button.form.elements.name.value },
        rejectClose: false
      });
    } catch (_) { return; }
    if (!name?.trim()) return;
    this.presetId = await savePreset(name, this.cfg);
    ui.notifications.info(game.i18n.format("DXLT.App.Saved", { name: name.trim() }));
    this.render({ parts: ["main"] });
  }

  static async #onDeletePreset() {
    const p = presets().find(x => x.id === this.presetId);
    if (!p) return;
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: "DXLT.App.DeleteTitle" },
      content: `<p>${game.i18n.format("DXLT.App.DeleteConfirm", { name: escapeHTML(p.name) })}</p>`,
      rejectClose: false
    });
    if (!ok) return;
    await deletePreset(p.id);
    this.presetId = null;
    this.render({ parts: ["main"] });
  }

  static async #onApply() {
    const cfg = normalizeConfig(this.cfg);
    if (cfg.layers.some(l => l.design === CUSTOM && !l.src)) {
      return ui.notifications.warn(game.i18n.localize("DXLT.App.NoImage"));
    }
    if (this.actor) {
      const n = await setActorRing(this.actor, cfg, { prototype: this.prototype });
      await game.settings.set(MODULE_ID, "lastConfig", cfg);
      return ui.notifications.info(game.i18n.format(n ? "DXLT.App.Applied" : "DXLT.App.AppliedPrototype", { n, name: this.actor.name }));
    }
    const targets = this.#targets();
    if (!targets.length) return ui.notifications.warn(game.i18n.localize("DXLT.App.NoneSelected"));
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
    this.#setConfig(cfg);
    this.render({ parts: ["main"] });
  }

  /** Reset the current layer's fine-tuning and effects (keeps what it shows). */
  static #onReset() {
    const l = this.layer;
    const keep = l.design === CUSTOM
      ? { design: CUSTOM, src: l.src, motion: l.motion, size: MOTIONS[l.motion].size, count: MOTIONS[l.motion].count }
      : { design: l.design, style: l.style };
    this.cfg.layers[this.sel] = normalizeLayer(keep);
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
