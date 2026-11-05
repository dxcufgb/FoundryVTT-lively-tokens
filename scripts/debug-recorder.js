/**
 * Optional integration with Dxcufgb's Debug Recorder (module id `dxcufgbs-debug-recorder`).
 *
 * The recorder is NOT a dependency: without it (or while it is not recording) everything here does
 * nothing. When it is there, this module registers a snapshot of its runtime state (ringed tokens,
 * layers by design, emitters and particle counts, ...) and leaves breadcrumbs at its main actions,
 * so a GM's recording for a bug report shows what lively tokens was doing.
 *
 * Load order does not matter: we connect on the recorder's ready hook, or at our own init / ready
 * when its API is already there, and register only once. A recorder error never reaches this module.
 *
 * Privacy: snapshot and breadcrumb data only hold counts, booleans, numbers, this module's own design
 * ids and other modules' ids; never names, free text, image paths or URLs.
 */

import { MODULE_ID } from "./constants.js";

const RECORDER_ID = "dxcufgbs-debug-recorder";

let recorder = null;          // the recorder's API once we registered with it
let snapshotFn = null;        // () => plain data, given by registerDebugRecorder

/** The recorder's API, if it is installed and ready. */
function api() {
  return recorder ?? game.modules?.get(RECORDER_ID)?.api ?? null;
}

function connect(rec) {
  if (recorder || !rec || typeof rec.register !== "function") return;
  try {
    rec.register(MODULE_ID, {
      snapshot: () => {
        try { return snapshotFn?.() ?? {}; }
        catch (err) {
          console.warn(`${MODULE_ID} | debug snapshot failed`, err);
          return { snapshotError: true };
        }
      }
    });
    recorder = rec;
  } catch (err) {
    console.warn(`${MODULE_ID} | could not register with the debug recorder`, err);
  }
}

/**
 * Register with the recorder (call once, at init). `snapshot` returns plain JSON data describing
 * this module's state right now.
 */
export function registerDebugRecorder(snapshot) {
  snapshotFn = snapshot;
  Hooks.once(`${RECORDER_ID}.ready`, rec => connect(rec));
  connect(game.modules?.get(RECORDER_ID)?.api);
  Hooks.once("ready", () => connect(game.modules?.get(RECORDER_ID)?.api));
}

/**
 * Leave a breadcrumb (`area.action`, a small flat object of counts, booleans and ids of our own
 * options) while the recorder is recording. Does nothing otherwise.
 */
export function crumb(key, data) {
  const rec = api();
  if (!rec) return;
  try {
    if (rec.isRecording?.()) rec.breadcrumb(MODULE_ID, key, data);
  } catch (_) { /* the recorder must never break this module */ }
}
