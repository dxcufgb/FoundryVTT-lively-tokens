/**
 * Export a ring to a single file and import it again, in this world or any other Foundry.
 *
 * The file is plain JSON (*.lively-ring.json):
 *   {
 *     format: "dxcufgbs-lively-tokens.ring", formatVersion: 1,
 *     name, exported, moduleVersion,
 *     ring: {layers: [...]},              // custom layers keep their original src, plus `image: "<key>"`
 *     images: { "<key>": {name, type, size, data: "data:image/...;base64,..."} }
 *   }
 * Images used by "your image" layers are embedded, so the file is all another world needs.
 * On import the images are uploaded into worlds/<world>/dxcufgbs-lively-tokens/imported/ (the same
 * image is only uploaded once) and the ring points at the uploaded copies.
 */

import { MODULE_ID } from "./constants.js";
import { CUSTOM, normalizeConfig } from "./ring.js";

export const FORMAT = "dxcufgbs-lively-tokens.ring";
export const FORMAT_VERSION = 1;
export const FILE_SUFFIX = ".lively-ring.json";

/** Image types that are embedded and accepted on import (no SVG: it can carry scripts). */
const IMAGE_TYPES = {
  "image/png": "png", "image/webp": "webp", "image/jpeg": "jpg", "image/gif": "gif", "image/avif": "avif"
};
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

const FP = () => foundry.applications.apps.FilePicker.implementation;

/* -------------------------------------------- */
/*  Small helpers                               */
/* -------------------------------------------- */

/** A safe file name part: letters, digits, - and _. */
function slug(str, fallback = "ring") {
  const s = String(str ?? "")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^\w-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")
    .slice(0, 40);
  return s || fallback;
}

/** File name without folder and extension. */
function baseName(path) {
  let file = String(path ?? "").split(/[?#]/)[0].split(/[\\/]/).pop() || "";
  try { file = decodeURIComponent(file); } catch (_) { /* keep as is */ }
  return file.replace(/\.[a-z0-9]+$/i, "");
}

/** FNV-1a hash of the bytes, as 8 hex digits (crypto.subtle is missing on plain http). */
function hashBytes(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function dataURLToBytes(dataURL) {
  const m = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataURL ?? ""));
  if (!m) return null;
  const bin = atob(m[2].replace(/\s+/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { type: m[1].toLowerCase(), bytes };
}

/** Image type from the first bytes, so a file can't pretend to be something it isn't. */
function sniffType(bytes) {
  const b = i => bytes[i];
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) return "image/png";
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return "image/jpeg";
  if (b(0) === 0x47 && b(1) === 0x49 && b(2) === 0x46) return "image/gif";
  const ascii = (from, to) => String.fromCharCode(...bytes.slice(from, to));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(4, 8) === "ftyp" && /avi[fs]/.test(ascii(8, 12))) return "image/avif";
  return null;
}

/* -------------------------------------------- */
/*  Export                                      */
/* -------------------------------------------- */

/**
 * Build the export data for a ring. Images are fetched and embedded; an image that can't be read
 * (e.g. a web address that doesn't allow it) keeps its address only.
 * @returns {Promise<{data: object, missing: string[]}>}
 */
export async function buildExport(cfg, name) {
  const ring = normalizeConfig(cfg);
  const images = {};
  const keyBySrc = new Map();
  const missing = [];

  for (const layer of ring.layers) {
    if (layer.design !== CUSTOM || !layer.src) continue;
    if (keyBySrc.has(layer.src)) {
      const key = keyBySrc.get(layer.src);
      if (key) layer.image = key;
      continue;
    }
    let key = null;
    try {
      const res = await fetch(layer.src, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      if (blob.size > MAX_IMAGE_BYTES) throw new Error("too large");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const type = sniffType(bytes);
      if (!type) throw new Error("not a supported image type");
      key = `${slug(baseName(layer.src), "image")}-${hashBytes(bytes)}`;
      if (!images[key]) {
        images[key] = {
          name: baseName(layer.src) || key,
          type,
          size: bytes.length,
          data: await blobToDataURL(new Blob([bytes], { type }))
        };
      }
    } catch (err) {
      console.warn(`${MODULE_ID} | export: could not embed ${layer.src}`, err);
      missing.push(layer.src);
      key = null;
    }
    keyBySrc.set(layer.src, key);
    if (key) layer.image = key;
  }

  return {
    data: {
      format: FORMAT,
      formatVersion: FORMAT_VERSION,
      name: String(name ?? "").trim() || game.i18n.localize("DXLT.Transfer.DefaultName"),
      exported: new Date().toISOString(),
      moduleVersion: game.modules.get(MODULE_ID)?.version ?? "",
      ring,
      images
    },
    missing
  };
}

/** Export a ring and let the browser save it as one file. */
export async function exportRing(cfg, name) {
  const { data, missing } = await buildExport(cfg, name);
  const file = `${slug(data.name)}${FILE_SUFFIX}`;
  foundry.utils.saveDataToFile(JSON.stringify(data, null, 2), "application/json", file);
  if (missing.length) {
    ui.notifications.warn(game.i18n.format("DXLT.Transfer.NotEmbedded", { files: missing.map(baseName).join(", ") }));
  }
  return { file, data, missing };
}

/* -------------------------------------------- */
/*  Import                                      */
/* -------------------------------------------- */

/** The folder imported images go into. */
function importFolder() {
  return `worlds/${game.world.id}/${MODULE_ID}/imported`;
}

async function ensureFolder(path) {
  const parts = path.split("/");
  for (let i = 1; i <= parts.length; i++) {
    try { await FP().createDirectory("data", parts.slice(0, i).join("/"), {}); } catch (_) { /* exists */ }
  }
}

/** Does a file already exist at this path (served by Foundry)? */
async function exists(path) {
  try {
    const res = await fetch(path, { method: "HEAD", cache: "no-store" });
    return res.ok;
  } catch (_) {
    return false;
  }
}

/**
 * Upload one embedded image (once: the file name carries a hash of the content).
 * @returns {Promise<string|null>} the path of the image in this world
 */
async function placeImage(key, img) {
  const decoded = dataURLToBytes(img?.data);
  if (!decoded || decoded.bytes.length > MAX_IMAGE_BYTES) return null;
  const type = sniffType(decoded.bytes);
  if (!type || !IMAGE_TYPES[type]) return null;

  const fileName = `${slug(img.name, "image")}-${hashBytes(decoded.bytes)}.${IMAGE_TYPES[type]}`;
  const dir = importFolder();
  const path = `${dir}/${fileName}`;
  if (await exists(path)) return path;

  await ensureFolder(dir);
  const file = new File([decoded.bytes], fileName, { type });
  const res = await FP().upload("data", dir, file, {}, { notify: false });
  return res?.path ?? null;
}

/**
 * Read an exported ring (File, text or parsed object), put its images into this world and
 * return the ring ready to use.
 * @returns {Promise<{name: string, cfg: object, uploaded: number, skipped: string[]}>}
 */
export async function importRing(source) {
  let data = source;
  if (source instanceof Blob) data = await foundry.utils.readTextFromFile(source);
  if (typeof data === "string") {
    try { data = JSON.parse(data); }
    catch (_) { throw new Error(game.i18n.localize("DXLT.Transfer.BadFile")); }
  }
  if (!data || typeof data !== "object") throw new Error(game.i18n.localize("DXLT.Transfer.BadFile"));

  // A bare ring ({layers: [...]}) is accepted too.
  const isFile = data.format === FORMAT;
  if (!isFile && !Array.isArray(data.layers)) throw new Error(game.i18n.localize("DXLT.Transfer.BadFile"));
  if (isFile && Number(data.formatVersion) > FORMAT_VERSION) {
    throw new Error(game.i18n.localize("DXLT.Transfer.TooNew"));
  }

  const ring = isFile ? data.ring : data;
  const images = (isFile && data.images && typeof data.images === "object") ? data.images : {};
  const layers = Array.isArray(ring?.layers) ? ring.layers.map(l => ({ ...l })) : [];
  const canUpload = game.user.can("FILES_UPLOAD");
  const placed = new Map();
  const skipped = [];
  let uploaded = 0;

  for (const layer of layers) {
    if (layer?.design !== CUSTOM) continue;
    const key = typeof layer.image === "string" ? layer.image : null;
    delete layer.image;
    const img = key ? images[key] : null;
    if (!img) continue;                         // no embedded copy: keep the original address

    if (!placed.has(key)) {
      let path = null;
      if (canUpload) {
        try {
          path = await placeImage(key, img);
          if (path) uploaded++;
        } catch (err) {
          console.error(`${MODULE_ID} | import: could not upload ${key}`, err);
        }
      } else if (layer.src && await exists(layer.src)) {
        path = layer.src;                         // the same image is already in this world
      }
      if (!path) skipped.push(img.name || key);
      placed.set(key, path);
    }
    const path = placed.get(key);
    if (path) layer.src = path;
  }

  return {
    name: String((isFile ? data.name : "") || "").trim().slice(0, 60) || game.i18n.localize("DXLT.Transfer.DefaultName"),
    cfg: normalizeConfig({ layers }),
    uploaded,
    skipped
  };
}
