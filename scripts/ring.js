/**
 * Dxcufgb's lively tokens - the ring renderer.
 *
 * A LivelyRing is a PIXI.Container drawn around a token:
 *  - a "band": one quad with a procedural fragment shader (vines, smoke, chains, gears, ...)
 *  - "swarms": animated sprites (smoke puffs, flames, petals, motes, ...) using the
 *    Kenney Particle Pack sprites (CC0) or small textures drawn at runtime.
 *
 * Everything is measured in token radii: 1 = the edge of the token. The ring is scaled
 * to the token's size, so it grows with the creature.
 *
 * This file only needs the global PIXI (v7), so it runs both in Foundry and in the preview.
 */

const TAU = Math.PI * 2;
const EXTENT = 1.7;   // the band's quad reaches 1.7 token radii from the centre

/* ======================================================================== */
/*  Shaders                                                                 */
/* ======================================================================== */

const VERT = `
precision highp float;
attribute vec2 aVertexPosition;
attribute vec2 aTextureCoord;
uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
varying vec2 vP;
void main() {
  vP = aTextureCoord;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
}`;

const COMMON = `
precision highp float;
varying vec2 vP;
uniform vec4 uColor;
uniform float uTime;
uniform vec3 uA;      // bright
uniform vec3 uB;      // main
uniform vec3 uC;      // dark
uniform float uP1;    // style parameter (glow / variant)
const float PI = 3.14159265;
const float TAU = 6.28318531;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float seg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}
vec4 ring(vec2 p, float r, float a, float t);
void main() {
  float r = length(vP);
  float a = atan(vP.y, vP.x);
  vec4 c = ring(vP, r, a, uTime);
  c.a = clamp(c.a, 0.0, 1.0) * smoothstep(${EXTENT.toFixed(2)}, ${(EXTENT - 0.12).toFixed(2)}, r);
  gl_FragColor = vec4(c.rgb * c.a, c.a) * uColor.a;
}
`;

const BANDS = {

  // Two vines twisting around the token, sprouting leaves that sway and breathe.
  druid: `
vec4 ring(vec2 p, float r, float a, float t) {
  vec3 col = vec3(0.0);
  float al = 0.0;
  float glow = exp(-pow((r - 1.10) / 0.11, 2.0)) * 0.30 * (0.75 + 0.25 * sin(t * 1.3 + a * 3.0));
  float w = 0.022;
  for (int k = 0; k < 2; k++) {
    float ph = float(k) * PI;
    float vr = 1.10 + 0.05 * sin(a * 5.0 + t * 0.5 + ph);
    float d = abs(r - vr);
    float v = smoothstep(w, w * 0.35, d);
    float shade = 0.55 + 0.45 * (1.0 - d / w);
    col = mix(col, uC * shade * 1.4, v);
    al = max(al, v);
  }
  float N = 18.0;
  for (int k = 0; k < 3; k++) {
    float cell = floor((a / TAU + 0.5) * N) + float(k) - 1.0;
    float ca = (cell + 0.5) / N * TAU - PI;
    float side = mod(cell, 2.0) < 1.0 ? 1.0 : -1.0;
    float ph = side > 0.0 ? 0.0 : PI;
    float vr = 1.10 + 0.05 * sin(ca * 5.0 + t * 0.5 + ph);
    float h = hash(vec2(cell, 3.1));
    float grow = 0.8 + 0.2 * sin(t * 0.9 + h * 6.0);
    float len = 0.105 * grow * (0.8 + 0.4 * h), wid = 0.042 * grow * (0.8 + 0.4 * h);
    vec2 radial = vec2(cos(ca), sin(ca));
    vec2 dir = rot(side * 0.95 + 0.22 * sin(t * 1.6 + h * 9.0)) * radial;
    vec2 base = radial * vr;
    vec2 q = p - (base + dir * len);
    vec2 lq = vec2(dot(q, dir), dot(q, vec2(-dir.y, dir.x)));
    float x = lq.x / len;
    float prof = wid * sqrt(max(0.0, 1.0 - x * x)) * (1.0 - 0.35 * x);
    float leaf = smoothstep(0.004, -0.004, abs(lq.y) - prof) * step(abs(x), 1.0);
    float vein = smoothstep(0.0045, 0.0, abs(lq.y)) * step(abs(x), 0.85);
    vec3 lc = mix(uB, uA, 0.35 + 0.45 * x + 0.3 * h);
    lc *= (lq.y > 0.0 ? 1.0 : 0.78) * (1.0 - 0.4 * vein);
    col = mix(col, lc, leaf);
    al = max(al, leaf);
  }
  col = mix(uA * 0.9, col, al);
  return vec4(col, max(al, glow));
}`,

  // Arcane smoke curling around the token.
  smoke: `
vec4 ring(vec2 p, float r, float a, float t) {
  vec2 q = rot(t * 0.22) * p;
  vec2 warp = vec2(fbm(q * 1.7 + t * 0.35), fbm(q * 1.9 - t * 0.30));
  float n = fbm(q * 2.6 + warp * 1.7);
  float band = exp(-pow((r - 1.14) / (0.11 + 0.07 * n), 2.0));
  float inner = smoothstep(0.93, 1.03, r);
  float s = smoothstep(0.28, 0.80, n * band * 1.35) * inner;
  vec3 col = mix(uC, mix(uB, uA, smoothstep(0.55, 0.9, n)), clamp(s * 1.3, 0.0, 1.0));
  float wisp = smoothstep(0.60, 0.90, fbm(q * 5.0 - t * 0.6)) * band * inner;
  col += uA * wisp * 0.6;
  return vec4(col, s * 0.95 + wisp * 0.5);
}`,

  // Heavy chain links, alternating flat and edge-on, creeping round with a moving sheen.
  chains: `
vec4 ring(vec2 p, float r, float a, float t) {
  float R0 = 1.13;
  float N = 26.0;
  float aa = a + t * 0.10;
  float pitch = TAU * R0 / N;
  vec3 col = vec3(0.0);
  float al = 0.0;
  float glow = 0.0;
  for (int pass = 0; pass < 2; pass++) {
    for (int k = 0; k < 3; k++) {
      float cell = floor((aa / TAU + 0.5) * N) + float(k) - 1.0;
      float isFlat = mod(cell, 2.0) < 1.0 ? 1.0 : 0.0;
      if ((pass == 0 && isFlat < 0.5) || (pass == 1 && isFlat > 0.5)) continue;
      float ca = (cell + 0.5) / N * TAU - PI;
      float dx = aa - ca;
      dx -= TAU * floor((dx + PI) / TAU);
      float x = dx * R0;
      float y = r - R0 - 0.010 * sin(ca * 3.0 + t * 0.7);
      float L = pitch * 0.74, W = pitch * 0.40, th = pitch * 0.12;
      float cov;
      vec3 c;
      float d;
      if (isFlat > 0.5) {
        float e = length(vec2(x / L, y / W));
        d = abs(e - 1.0) * W;
        cov = smoothstep(th, th * 0.55, d);
        float sh = clamp(0.5 - (e - 1.0) * W / th * 0.5, 0.0, 1.0);
        c = mix(uC, uB, sh);
      } else {
        vec2 q = vec2(max(abs(x) - (L - W * 0.25), 0.0), y);
        d = length(q);
        cov = smoothstep(th * 1.3, th * 0.8, d);
        float sh = 1.0 - d / (th * 1.3);
        c = mix(uC, uB * 1.1, sh);
        c += uA * pow(max(sh, 0.0), 6.0) * 0.6;
      }
      float spec = pow(max(0.0, sin(aa * 2.0 - t * 1.3 + x * 20.0)), 18.0);
      c += uA * spec * 0.55;
      col = mix(col, c, cov);
      al = max(al, cov);
      glow = max(glow, exp(-d / th * 1.5));
    }
  }
  float shadow = smoothstep(0.09, 0.0, abs(r - R0 - 0.012)) * 0.35;
  vec3 halo = uA * uP1;
  col = mix(halo, col, al);
  float outA = max(al, max(shadow * (1.0 - uP1), glow * uP1 * 0.6));
  return vec4(col, outA);
}`,

  // A toothed ring of brass that ticks round, with little gears meshing on its rim.
  clockwork: `
float gearCov(vec2 q, float R, float teeth, float toothH, float ang, float hub) {
  float r = length(q);
  float a = atan(q.y, q.x) + ang;
  float tooth = smoothstep(0.34, 0.20, abs(fract(a * teeth / TAU) - 0.5));
  float edge = R + toothH * tooth;
  float spokes = smoothstep(0.30, 0.22, abs(fract(a * 5.0 / TAU) - 0.5));
  float body = smoothstep(edge + 0.004, edge - 0.004, r);
  float window = smoothstep(R * 0.72 - 0.004, R * 0.72 + 0.004, r) + spokes + smoothstep(hub + 0.004, hub - 0.004, r);
  return body * clamp(window, 0.0, 1.0) * smoothstep(hub * 0.45 - 0.004, hub * 0.45 + 0.004, r);
}
vec4 ring(vec2 p, float r, float a, float t) {
  float tick = floor(t * 1.2) + smoothstep(0.0, 0.25, fract(t * 1.2));
  float ang1 = tick * TAU / 48.0;
  vec2 light = normalize(vec2(-0.55, 0.85));
  vec3 col = vec3(0.0);
  float al = 0.0;
  // satellite gears (behind the big ring)
  for (int i = 0; i < 4; i++) {
    float th = float(i) * PI * 0.5 + PI * 0.25;
    vec2 c = vec2(cos(th), sin(th)) * 1.36;
    vec2 q = p - c;
    float cov = gearCov(q, 0.125, 12.0, 0.03, -ang1 * 48.0 / 12.0 + th, 0.04);
    float sh = 0.55 + 0.45 * dot(normalize(q + 0.0001), light);
    vec3 gc = mix(uC, uB, sh);
    col = mix(col, gc, cov);
    al = max(al, cov);
  }
  // the big ring
  float a1 = a + ang1;
  float tooth = smoothstep(0.34, 0.20, abs(fract(a1 * 48.0 / TAU) - 0.5));
  float outer = 1.175 + 0.045 * tooth;
  float cov = smoothstep(outer + 0.005, outer - 0.005, r) * smoothstep(1.012, 1.028, r);
  float hcell = floor((a1 / TAU + 0.5) * 12.0);
  float ha = (hcell + 0.5) / 12.0 * TAU - PI - ang1;
  vec2 hp = vec2(cos(ha), sin(ha)) * 1.097;
  float hole = smoothstep(0.036, 0.029, length(p - hp));
  cov *= 1.0 - hole;
  float groove = smoothstep(0.005, 0.0, abs(r - 1.050)) + smoothstep(0.005, 0.0, abs(r - 1.148));
  float sh = 0.5 + 0.5 * dot(normalize(p), light);
  vec3 rc = mix(uC, uB, 0.35 + 0.65 * sh);
  rc = mix(rc, uC * 0.6, groove * 0.7);
  rc += uA * pow(max(0.0, sin(a * 1.0 + 0.9)), 30.0) * 0.5;
  // arcane styles: glowing grooves
  rc = mix(rc, uA * 1.3, groove * uP1);
  col = mix(col, rc, cov);
  al = max(al, cov);
  float gl = (exp(-abs(r - 1.05) * 90.0) + exp(-abs(r - 1.148) * 90.0)) * uP1 * 0.6;
  col = mix(uA, col, al);
  return vec4(col, max(al, gl));
}`,

  // Flames licking up from the token's edge, spiralling round it.
  flame: `
vec4 ring(vec2 p, float r, float a, float t) {
  float sw = a + (r - 1.0) * 2.6 - t * 0.9;
  vec2 cs = vec2(cos(sw), sin(sw));
  float n = fbm(cs * 2.0 + vec2(0.0, -t * 1.6) + r * 1.5);
  float n2 = noise(cs * 6.0 + vec2(t * 2.0, r * 4.0));
  float h = 0.10 + 0.34 * n * n + 0.06 * n2;
  float d = (r - 0.985) / h;
  float f = smoothstep(1.0, 0.15, d) * smoothstep(-0.05, 0.03, r - 0.985);
  f *= 0.65 + 0.55 * n2;
  vec3 col = mix(uA, uB, smoothstep(0.0, 0.3, d));
  col = mix(col, uC, smoothstep(0.45, 1.0, d));
  return vec4(col * 1.15, f);
}`,

  // Two engraved circles holding a band of runes that turn and pulse.
  glyphs: `
float rune(vec2 q, float id) {
  float d = 1e3;
  for (int i = 0; i < 4; i++) {
    float h1 = hash(vec2(id, float(i) * 7.13));
    float h2 = hash(vec2(id + 0.37, float(i) * 3.71 + 1.3));
    vec2 A = (vec2(floor(h1 * 3.0), floor(fract(h1 * 7.3) * 3.0)) - 1.0) * 0.30;
    vec2 B = (vec2(floor(h2 * 3.0), floor(fract(h2 * 5.9) * 3.0)) - 1.0) * 0.30;
    if (length(A - B) > 0.01) d = min(d, seg(q, A, B));
  }
  return d;
}
vec4 ring(vec2 p, float r, float a, float t) {
  float R1 = 1.05, R2 = 1.28;
  float lines = smoothstep(0.006, 0.0015, abs(r - R1)) + smoothstep(0.006, 0.0015, abs(r - R2))
              + 0.6 * smoothstep(0.004, 0.001, abs(r - 1.315));
  float N = 18.0;
  float aa = a + t * 0.14;
  float cell = floor((aa / TAU + 0.5) * N);
  float ca = (cell + 0.5) / N * TAU - PI;
  float dx = aa - ca;
  vec2 q = vec2(dx * r / (TAU * 1.165 / N), (r - 1.165) / 0.17);
  float d = rune(vec2(q.x, -q.y) * 1.05, cell);
  float inside = step(abs(q.y), 0.5);
  float g = smoothstep(0.075, 0.03, d) * inside;
  float glowG = exp(-d * 10.0) * 0.45 * inside;
  float pulse = 0.45 + 0.55 * pow(0.5 + 0.5 * sin(cell * 1.7 - t * 2.2), 2.0);
  float ab = a - t * 0.35;
  float dash = step(0.55, fract(ab * 40.0 / TAU)) * smoothstep(0.006, 0.002, abs(r - 1.018));
  float ticks = step(0.8, fract(ab * 72.0 / TAU)) * smoothstep(0.02, 0.0, abs(r - 1.30)) * step(r, 1.30);
  float I = lines * 0.9 + (g + glowG) * pulse + dash * 0.8 + ticks * 0.6;
  vec3 col = mix(uB, uA, clamp(g * pulse + lines * 0.4, 0.0, 1.0));
  float soft = exp(-pow((r - 1.165) / 0.14, 2.0)) * 0.10;
  return vec4(col, (I + soft) * smoothstep(0.98, 1.01, r));
}`,

  // Shafts of light fanning out from the token.
  rays: `
vec4 ring(vec2 p, float r, float a, float t) {
  float aa = a + t * 0.05;
  vec2 cs = vec2(cos(aa), sin(aa));
  float n = fbm(cs * 3.2 + vec2(t * 0.15, -t * 0.10));
  float n2 = noise(cs * 11.0 + vec2(t * 0.35, 0.0));
  float rays = pow(smoothstep(0.25, 0.80, n), 1.3) * 0.85 + pow(n2, 3.0) * 0.7;
  float len = 0.45 + 0.55 * n;
  float fall = smoothstep(0.94, 1.02, r) * exp(-max(r - 1.0, 0.0) / len * 1.7);
  float halo = exp(-pow((r - 1.02) / 0.05, 2.0)) * 0.75;
  float I = rays * fall + halo;
  vec3 col = mix(uB, uA, clamp(I * 1.2, 0.0, 1.0));
  col = mix(uC, col, smoothstep(0.0, 0.5, fall + halo));
  return vec4(col, I);
}`,

  // A faint breeze ring; the petals themselves are sprites.
  breeze: `
vec4 ring(vec2 p, float r, float a, float t) {
  float n = fbm(vec2(cos(a - t * 0.4), sin(a - t * 0.4)) * 2.0 + t * 0.2);
  float w = exp(-pow((r - 1.16) / 0.09, 2.0)) * (0.35 + 0.65 * n) * 0.22 * smoothstep(0.95, 1.02, r);
  return vec4(mix(uB, uA, n), w);
}`,

  // A soft halo; the motes are sprites.
  halo: `
vec4 ring(vec2 p, float r, float a, float t) {
  float h = exp(-pow((r - 1.07) / 0.09, 2.0)) * (0.16 + 0.06 * sin(t * 1.5 + a * 2.0));
  return vec4(mix(uB, uA, 0.5), h * smoothstep(0.95, 1.01, r));
}`,

  // A swirling vortex with spiral arms and a glowing event horizon.
  vortex: `
vec4 ring(vec2 p, float r, float a, float t) {
  float lr = log(max(r, 0.001));
  float sp = a * 3.0 + lr * 14.0 - t * 1.8;
  float arms = 0.5 + 0.5 * sin(sp);
  float n = fbm(vec2(cos(a + lr * 3.0 - t * 0.5), sin(a + lr * 3.0 - t * 0.5)) * 2.2 + vec2(lr * 5.0 - t * 0.7, 0.0));
  float band = exp(-pow((r - 1.15) / 0.14, 2.0));
  float horizon = exp(-pow((r - 1.025) / 0.022, 2.0));
  float I = band * (0.30 + 0.9 * arms * n);
  vec3 col = mix(uC, uB, smoothstep(0.15, 0.6, I));
  col = mix(col, uA, clamp(smoothstep(0.55, 1.0, I) + horizon, 0.0, 1.0));
  float al = clamp(band * 0.9 + horizon, 0.0, 1.0) * smoothstep(0.97, 1.005, r);
  return vec4(col, al);
}`
};

/* ======================================================================== */
/*  Designs and styles                                                      */
/* ======================================================================== */
/*
 * band:   which shader draws the ring       blend: "normal" | "add"
 * colors: [bright, main, dark] for the band  p1:    style parameter (glow)
 * swarms: sprite groups, see class Swarm
 *   tex    texture name     count   sprites at size 1 (scales with creature size)
 *   mode   orbit | inward | rise | wander | flutter | puff
 *   radius [min, max] in token radii      size [min, max] in token radii
 *   speed  angular speed (rad/s)          colors  list of hex colours
 *   blend  add | normal                   alpha   max opacity    spin  rad/s
 */
export const DESIGNS = {
  druid: {
    label: "Druid", icon: "fa-solid fa-leaf", band: "druid", blend: "normal",
    styles: {
      verdant: { label: "Verdant", colors: ["#b8f07a", "#3f9a3a", "#3a2a14"],
        swarms: [{ tex: "glow", count: 10, mode: "wander", radius: [1.05, 1.35], size: [0.05, 0.09], speed: 0.25, colors: ["#d8ff9a", "#9aff7a"], blend: "add", alpha: 0.9 }] },
      autumn: { label: "Autumn", colors: ["#ffcf5a", "#d8641c", "#3a2412"],
        swarms: [{ tex: "leaf", count: 8, mode: "flutter", radius: [1.1, 1.45], size: [0.1, 0.14], speed: 0.35, colors: ["#e8801c", "#c8401a", "#f0b030"], blend: "normal", alpha: 1 }] },
      moonlit: { label: "Moonlit", colors: ["#d8fff4", "#5ab8a0", "#1a2a30"],
        swarms: [{ tex: "glow", count: 12, mode: "wander", radius: [1.05, 1.4], size: [0.05, 0.09], speed: 0.2, colors: ["#e8fff8", "#a8f0ff"], blend: "add", alpha: 0.9 }] },
      thorn: { label: "Thornwild", colors: ["#e86a5a", "#5a3a2a", "#1a120c"],
        swarms: [{ tex: "glow", count: 8, mode: "wander", radius: [1.05, 1.35], size: [0.05, 0.08], speed: 0.2, colors: ["#ff6a4a"], blend: "add", alpha: 0.8 }] }
    }
  },

  smoke: {
    label: "Magic Smoke", icon: "fa-solid fa-smog", band: "smoke", blend: "add",
    styles: {
      arcane: { label: "Arcane", colors: ["#e8c8ff", "#9a4dff", "#2a0a5a"],
        swarms: [{ tex: "smoke", count: 9, mode: "puff", radius: [1.05, 1.3], size: [0.35, 0.6], speed: 0.35, colors: ["#b36bff", "#7a3adf"], blend: "add", alpha: 0.45, spin: 0.4 }] },
      shadow: { label: "Shadow", blend: "normal", colors: ["#5a4a6a", "#1a1422", "#050308"],
        swarms: [{ tex: "smoke", count: 10, mode: "puff", radius: [1.05, 1.3], size: [0.35, 0.65], speed: 0.3, colors: ["#120c18", "#221a2a"], blend: "normal", alpha: 0.7, spin: 0.4 }] },
      emerald: { label: "Emerald", colors: ["#c8ffd8", "#2adf7a", "#063a1a"],
        swarms: [{ tex: "smoke", count: 9, mode: "puff", radius: [1.05, 1.3], size: [0.35, 0.6], speed: 0.35, colors: ["#3aff8a", "#1aa85a"], blend: "add", alpha: 0.4, spin: 0.4 }] },
      crimson: { label: "Crimson", colors: ["#ffc8c0", "#e0202a", "#3a0206"],
        swarms: [{ tex: "smoke", count: 9, mode: "puff", radius: [1.05, 1.3], size: [0.35, 0.6], speed: 0.35, colors: ["#ff3a3a", "#a80a14"], blend: "add", alpha: 0.4, spin: 0.4 }] }
    }
  },

  chains: {
    label: "Chains", icon: "fa-solid fa-link", band: "chains", blend: "normal",
    styles: {
      iron: { label: "Iron", colors: ["#e8eef4", "#7a8088", "#1c1e22"], p1: 0 },
      gold: { label: "Gold", colors: ["#fff4c0", "#c89a2a", "#3a2608"], p1: 0 },
      spectral: { label: "Spectral", blend: "add", colors: ["#e0f8ff", "#5ac8ff", "#0a2a4a"], p1: 1,
        swarms: [{ tex: "glow", count: 8, mode: "orbit", radius: [1.1, 1.18], size: [0.05, 0.08], speed: 0.1, colors: ["#bff0ff"], blend: "add", alpha: 0.8 }] },
      hellforged: { label: "Hellforged", colors: ["#ffd88a", "#b8320a", "#2a0602"], p1: 0.6,
        swarms: [{ tex: "glow", count: 10, mode: "rise", radius: [1.1, 1.18], size: [0.03, 0.05], speed: 0.4, colors: ["#ffb84a", "#ff6a1a"], blend: "add", alpha: 1 }] }
    }
  },

  clockwork: {
    label: "Clockwork", icon: "fa-solid fa-gears", band: "clockwork", blend: "normal",
    styles: {
      brass: { label: "Brass", colors: ["#fff0b0", "#c8962a", "#3a2608"], p1: 0 },
      steel: { label: "Steel", colors: ["#ffffff", "#9aa4b0", "#20242a"], p1: 0 },
      copper: { label: "Copper", colors: ["#ffd0a8", "#c0602a", "#3a1408"], p1: 0 },
      arcane: { label: "Arcane Engine", colors: ["#9af0ff", "#4a5a78", "#10141c"], p1: 1,
        swarms: [{ tex: "glow", count: 8, mode: "orbit", radius: [1.1, 1.1], size: [0.04, 0.06], speed: 0.6, colors: ["#9af0ff"], blend: "add", alpha: 0.9 }] }
    }
  },

  flame: {
    label: "Swirling Flame", icon: "fa-solid fa-fire", band: "flame", blend: "add",
    styles: {
      fire: { label: "Fire", colors: ["#fff0a0", "#ff6a10", "#8a0a00"],
        swarms: [{ tex: "flames", count: 8, mode: "orbit", radius: [1.08, 1.16], size: [0.22, 0.32], speed: 0.9, colors: ["#ffb84a", "#ff7a1a"], blend: "add", alpha: 0.75 },
                 { tex: "glow", count: 12, mode: "rise", radius: [1.05, 1.2], size: [0.025, 0.045], speed: 0.4, colors: ["#ffd07a", "#ff8a2a"], blend: "add", alpha: 1 }] },
      blue: { label: "Blue Flame", colors: ["#e8fbff", "#2a8aff", "#0a1a8a"],
        swarms: [{ tex: "flames", count: 8, mode: "orbit", radius: [1.08, 1.16], size: [0.22, 0.32], speed: 0.9, colors: ["#6ab8ff", "#2a6aff"], blend: "add", alpha: 0.75 },
                 { tex: "glow", count: 12, mode: "rise", radius: [1.05, 1.2], size: [0.025, 0.045], speed: 0.4, colors: ["#bfe8ff"], blend: "add", alpha: 1 }] },
      fel: { label: "Fel Fire", colors: ["#eaffb0", "#5adf1a", "#0a3a02"],
        swarms: [{ tex: "flames", count: 8, mode: "orbit", radius: [1.08, 1.16], size: [0.22, 0.32], speed: 0.9, colors: ["#9aff4a", "#3ac80a"], blend: "add", alpha: 0.75 },
                 { tex: "glow", count: 12, mode: "rise", radius: [1.05, 1.2], size: [0.025, 0.045], speed: 0.4, colors: ["#c8ff8a"], blend: "add", alpha: 1 }] },
      shadowflame: { label: "Shadowflame", colors: ["#f0c8ff", "#9a2adf", "#1a0030"],
        swarms: [{ tex: "flames", count: 8, mode: "orbit", radius: [1.08, 1.16], size: [0.22, 0.32], speed: 0.9, colors: ["#c05aff", "#6a1aa8"], blend: "add", alpha: 0.75 },
                 { tex: "glow", count: 12, mode: "rise", radius: [1.05, 1.2], size: [0.025, 0.045], speed: 0.4, colors: ["#e0a8ff"], blend: "add", alpha: 1 }] }
    }
  },

  glyphs: {
    label: "Glyphs", icon: "fa-solid fa-hat-wizard", band: "glyphs", blend: "add",
    styles: {
      arcane: { label: "Arcane", colors: ["#e0f4ff", "#3a9aff", "#0a1a4a"],
        swarms: [{ tex: "rune", count: 1, mode: "spinner", radius: [0, 0], size: [1.95, 1.95], speed: -0.12, colors: ["#6ab8ff"], blend: "add", alpha: 0.35 }] },
      infernal: { label: "Infernal", colors: ["#ffe0c0", "#ff3a1a", "#3a0400"],
        swarms: [{ tex: "rune", count: 1, mode: "spinner", radius: [0, 0], size: [1.95, 1.95], speed: -0.12, colors: ["#ff5a2a"], blend: "add", alpha: 0.45 }] },
      holy: { label: "Holy", colors: ["#fffbe0", "#ffc83a", "#4a3000"],
        swarms: [{ tex: "rune", count: 1, mode: "spinner", radius: [0, 0], size: [1.95, 1.95], speed: -0.12, colors: ["#ffd86a"], blend: "add", alpha: 0.45 }] },
      fey: { label: "Fey", colors: ["#f0ffe8", "#5aff9a", "#0a3a2a"],
        swarms: [{ tex: "rune", count: 1, mode: "spinner", radius: [0, 0], size: [1.95, 1.95], speed: -0.12, colors: ["#7affb8"], blend: "add", alpha: 0.45 },
                 { tex: "glow", count: 8, mode: "wander", radius: [1.05, 1.35], size: [0.04, 0.07], speed: 0.25, colors: ["#d8ffe8", "#ffb8f0"], blend: "add", alpha: 0.9 }] }
    }
  },

  rays: {
    label: "God Rays", icon: "fa-solid fa-sun", band: "rays", blend: "add",
    styles: {
      holy: { label: "Holy", colors: ["#ffffff", "#ffe89a", "#c89a2a"],
        swarms: [{ tex: "stars", count: 8, mode: "wander", radius: [1.05, 1.45], size: [0.12, 0.2], speed: 0.1, colors: ["#fff8d8"], blend: "add", alpha: 0.9 }] },
      sun: { label: "Sunfire", colors: ["#fff4c0", "#ffa02a", "#c8400a"],
        swarms: [{ tex: "stars", count: 6, mode: "wander", radius: [1.05, 1.45], size: [0.12, 0.2], speed: 0.1, colors: ["#ffd8a0"], blend: "add", alpha: 0.9 }] },
      moon: { label: "Moonlight", colors: ["#ffffff", "#b8d8ff", "#4a6aa8"],
        swarms: [{ tex: "stars", count: 8, mode: "wander", radius: [1.05, 1.45], size: [0.11, 0.18], speed: 0.1, colors: ["#e8f4ff"], blend: "add", alpha: 0.9 }] },
      eclipse: { label: "Eclipse", colors: ["#ffd0f0", "#b03aff", "#2a0a4a"],
        swarms: [{ tex: "stars", count: 6, mode: "wander", radius: [1.05, 1.45], size: [0.11, 0.18], speed: 0.1, colors: ["#f0c8ff"], blend: "add", alpha: 0.9 }] }
    }
  },

  petals: {
    label: "Leaves & Petals", icon: "fa-solid fa-seedling", band: "breeze", blend: "add",
    styles: {
      blossom: { label: "Cherry Blossom", colors: ["#ffe8f4", "#ff9ac8", "#8a2a5a"],
        swarms: [{ tex: "petal", count: 20, mode: "flutter", radius: [1.05, 1.5], size: [0.11, 0.16], speed: 0.45, colors: ["#ffc8e0", "#ffa8d0", "#fff0f6"], blend: "normal", alpha: 1 }] },
      autumn: { label: "Autumn Leaves", colors: ["#ffe0a0", "#e8801c", "#5a2a0a"],
        swarms: [{ tex: "leaf", count: 16, mode: "flutter", radius: [1.05, 1.5], size: [0.13, 0.18], speed: 0.4, colors: ["#e8801c", "#c8401a", "#f0b030", "#a8561a"], blend: "normal", alpha: 1 }] },
      spring: { label: "Spring Leaves", colors: ["#eaffc8", "#6adf3a", "#1a5a0a"],
        swarms: [{ tex: "leaf", count: 16, mode: "flutter", radius: [1.05, 1.5], size: [0.12, 0.17], speed: 0.45, colors: ["#7ae04a", "#4ab82a", "#b8f06a"], blend: "normal", alpha: 1 }] },
      winter: { label: "Snowfall", colors: ["#ffffff", "#bfe8ff", "#4a7aa8"],
        swarms: [{ tex: "stars", count: 24, mode: "flutter", radius: [1.05, 1.5], size: [0.12, 0.18], speed: 0.3, colors: ["#ffffff", "#e0f4ff"], blend: "add", alpha: 0.95 }] }
    }
  },

  particles: {
    label: "Particles", icon: "fa-solid fa-star", band: "halo", blend: "add",
    styles: {
      fireflies: { label: "Fireflies", colors: ["#f0ffa0", "#b8e84a", "#3a5a0a"],
        swarms: [{ tex: "glow", count: 22, mode: "wander", radius: [1.0, 1.5], size: [0.08, 0.13], speed: 0.3, colors: ["#f0ff8a", "#d8ff5a"], blend: "add", alpha: 1, blink: true }] },
      embers: { label: "Embers", colors: ["#ffe0a0", "#ff7a1a", "#8a1a00"],
        swarms: [{ tex: "glow", count: 30, mode: "rise", radius: [1.0, 1.15], size: [0.05, 0.09], speed: 0.5, colors: ["#ffd07a", "#ff8a2a", "#ff5a1a"], blend: "add", alpha: 1 }] },
      stardust: { label: "Stardust", colors: ["#ffffff", "#9ad0ff", "#2a3a8a"],
        swarms: [{ tex: "stars", count: 22, mode: "orbit", radius: [1.05, 1.35], size: [0.12, 0.2], speed: 0.35, colors: ["#ffffff", "#bfe0ff", "#e8d0ff"], blend: "add", alpha: 1, blink: true }] },
      arcane: { label: "Arcane Motes", colors: ["#f0d8ff", "#b36bff", "#3a0a7a"],
        swarms: [{ tex: "glow", count: 14, mode: "orbit", radius: [1.12, 1.18], size: [0.07, 0.11], speed: 1.1, colors: ["#e0b8ff"], blend: "add", alpha: 1 },
                 { tex: "glow", count: 14, mode: "orbit", radius: [1.25, 1.3], size: [0.06, 0.09], speed: -0.8, colors: ["#b8c8ff"], blend: "add", alpha: 1 }] }
    }
  },

  vortex: {
    label: "Wormholes", icon: "fa-solid fa-hurricane", band: "vortex", blend: "normal",
    styles: {
      void: { label: "Void", colors: ["#e8c8ff", "#6a1ad8", "#07020f"],
        swarms: [{ tex: "twirls", frames: 3, count: 7, mode: "inward", radius: [1.02, 1.45], size: [0.32, 0.46], speed: 1.2, colors: ["#b36bff", "#7a3aff"], blend: "add", alpha: 0.8 }] },
      nebula: { label: "Nebula", colors: ["#ffe0f4", "#ff4fb8", "#1a0a3a"],
        swarms: [{ tex: "twirls", frames: 3, count: 7, mode: "inward", radius: [1.02, 1.45], size: [0.32, 0.46], speed: 1.2, colors: ["#ff8ad6", "#6ab8ff"], blend: "add", alpha: 0.8 }] },
      abyss: { label: "Abyss", colors: ["#c8fff4", "#1ab8a8", "#020f0f"],
        swarms: [{ tex: "twirls", frames: 3, count: 7, mode: "inward", radius: [1.02, 1.45], size: [0.32, 0.46], speed: 1.2, colors: ["#3affe0", "#1a8aa8"], blend: "add", alpha: 0.8 }] },
      solar: { label: "Solar Rift", colors: ["#fff4c0", "#ff8a1a", "#1a0602"],
        swarms: [{ tex: "twirls", frames: 3, count: 7, mode: "inward", radius: [1.02, 1.45], size: [0.32, 0.46], speed: 1.2, colors: ["#ffb84a", "#ff5a1a"], blend: "add", alpha: 0.8 }] }
    }
  }
};

export const DEFAULTS = { design: "glyphs", style: "arcane", scale: 1, speed: 1, alpha: 1, density: 1, color: null };

/** Fill in missing fields and fall back to valid design/style names. */
export function normalizeConfig(cfg = {}) {
  const c = { ...DEFAULTS, ...(cfg ?? {}) };
  if (!DESIGNS[c.design]) c.design = DEFAULTS.design;
  const styles = DESIGNS[c.design].styles;
  if (!styles[c.style]) c.style = Object.keys(styles)[0];
  for (const [k, lo, hi] of [["scale", 0.5, 2.5], ["speed", 0, 4], ["alpha", 0, 1], ["density", 0, 3]]) {
    const v = Number(c[k]);
    c[k] = Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : DEFAULTS[k];
  }
  if (c.color && !/^#[0-9a-f]{6}$/i.test(c.color)) c.color = null;
  return c;
}

/* ======================================================================== */
/*  Colours                                                                 */
/* ======================================================================== */

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
const mixRgb = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
function rgbToHex(c) {
  return "#" + c.map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("");
}

/** Palette of [bright, main, dark]; a custom colour recolours the style around it. */
function palette(style, custom) {
  if (!custom) return style.colors.map(hexToRgb);
  const c = hexToRgb(custom);
  return [mixRgb(c, [1, 1, 1], 0.6), c, mixRgb(c, [0, 0, 0], 0.8)];
}

/** Sprite colours: the style's own, or shades of the custom colour. */
function swarmColors(def, custom) {
  if (!custom) return def.colors.map(h => PIXI.utils.string2hex ? PIXI.utils.string2hex(h) : parseInt(h.slice(1), 16));
  const c = hexToRgb(custom);
  return [c, mixRgb(c, [1, 1, 1], 0.4), mixRgb(c, [0, 0, 0], 0.25)].map(v => parseInt(rgbToHex(v).slice(1), 16));
}

/* ======================================================================== */
/*  Textures                                                                */
/* ======================================================================== */

/** Kenney Particle Pack sheets (CC0): name -> variants in a 2x2 sheet, 1 = single image. */
const SHEETS = { smoke: 4, flames: 4, stars: 4, twirls: 4, rune: 1, ring: 1 };

function canvasTexture(size, draw) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d"), size);
  return PIXI.Texture.from(c);
}

/**
 * Load all textures once. `base` is the module's folder (ending in "/"), `loader` loads one image.
 * Returns {name: [PIXI.Texture, ...]} (a list of variants per name).
 */
export async function loadTextures(base, loader = src => PIXI.Assets.load(src)) {
  const out = {};
  await Promise.all(Object.entries(SHEETS).map(async ([name, frames]) => {
    try {
      const tex = await loader(`${base}textures/${name}.png`);
      if (frames === 1) out[name] = [tex];
      else {
        const s = tex.baseTexture.width / 2;
        out[name] = [0, 1, 2, 3].map(i => new PIXI.Texture(tex.baseTexture, new PIXI.Rectangle((i % 2) * s, Math.floor(i / 2) * s, s, s)));
      }
    } catch (err) {
      console.warn(`dxcufgbs-lively-tokens | texture ${name} could not be loaded`, err);
    }
  }));

  // Drawn here (our own simple shapes, no image files needed)
  out.glow = [canvasTexture(64, (g, s) => {
    const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.25, "rgba(255,255,255,0.85)");
    r.addColorStop(0.6, "rgba(255,255,255,0.2)"); r.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = r; g.fillRect(0, 0, s, s);
  })];
  out.petal = [canvasTexture(64, (g, s) => {
    g.translate(s / 2, s / 2);
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.moveTo(0, s * 0.42);
    g.bezierCurveTo(s * 0.34, s * 0.2, s * 0.3, -s * 0.3, s * 0.07, -s * 0.4);
    g.lineTo(0, -s * 0.32);
    g.lineTo(-s * 0.07, -s * 0.4);
    g.bezierCurveTo(-s * 0.3, -s * 0.3, -s * 0.34, s * 0.2, 0, s * 0.42);
    g.fill();
    g.fillStyle = "rgba(255,255,255,0.55)";
    g.globalCompositeOperation = "destination-out";
    g.beginPath(); g.ellipse(0, s * 0.18, s * 0.05, s * 0.16, 0, 0, TAU); g.fill();
  })];
  out.leaf = [canvasTexture(64, (g, s) => {
    g.translate(s / 2, s / 2);
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.moveTo(0, s * 0.46);
    g.quadraticCurveTo(s * 0.34, s * 0.05, 0, -s * 0.44);
    g.quadraticCurveTo(-s * 0.34, s * 0.05, 0, s * 0.46);
    g.fill();
    g.globalCompositeOperation = "destination-out";
    g.strokeStyle = "rgba(0,0,0,0.45)"; g.lineWidth = s * 0.03;
    g.beginPath(); g.moveTo(0, s * 0.42); g.lineTo(0, -s * 0.36); g.stroke();
    for (let i = -2; i <= 2; i++) {
      g.beginPath(); g.moveTo(0, i * s * 0.12); g.lineTo(s * 0.16, i * s * 0.12 - s * 0.1); g.stroke();
      g.beginPath(); g.moveTo(0, i * s * 0.12); g.lineTo(-s * 0.16, i * s * 0.12 - s * 0.1); g.stroke();
    }
  })];
  return out;
}

/* ======================================================================== */
/*  Sprites                                                                 */
/* ======================================================================== */

const rand = (a, b) => a + Math.random() * (b - a);

class Swarm extends PIXI.Container {
  constructor(def, textures, colors, count) {
    super();
    this.def = def;
    let variants = textures[def.tex] ?? textures.glow ?? [PIXI.Texture.WHITE];
    if (def.frames) variants = variants.slice(0, def.frames);
    this.items = [];
    for (let i = 0; i < count; i++) {
      const s = new PIXI.Sprite(variants[i % variants.length]);
      s.anchor.set(0.5);
      s.blendMode = def.blend === "normal" ? PIXI.BLEND_MODES.NORMAL : PIXI.BLEND_MODES.ADD;
      s.tint = colors[i % colors.length];
      const p = { sprite: s, phase: Math.random() * TAU, seed: Math.random(), life: Math.random(), size: rand(def.size[0], def.size[1]) };
      this.reset(p, true);
      this.items.push(p);
      this.addChild(s);
    }
  }

  reset(p, initial = false) {
    const d = this.def;
    p.angle = Math.random() * TAU;
    p.r = rand(d.radius[0], d.radius[1]);
    p.life = initial ? Math.random() : 0;
    p.lifespan = rand(1.6, 3.2);
    p.spin = (d.spin ?? 0) * (Math.random() < 0.5 ? -1 : 1) + (d.mode === "flutter" ? rand(-1.5, 1.5) : 0);
    p.sprite.rotation = Math.random() * TAU;
    p.dir = Math.random() < 0.5 ? -1 : 1;
  }

  /** t: seconds (already scaled by speed), dt: frame seconds (scaled), R: ring radius in px */
  update(t, dt, R) {
    const d = this.def, A = d.alpha ?? 1;
    const minPx = 3;
    for (const p of this.items) {
      const s = p.sprite;
      let x = 0, y = 0, alpha = A, scale = p.size;
      switch (d.mode) {
        case "spinner": {
          s.rotation += d.speed * dt;
          alpha = A * (0.8 + 0.2 * Math.sin(t * 1.3));
          break;
        }
        case "orbit": {
          p.angle += d.speed * dt;
          const rr = p.r + 0.02 * Math.sin(t * 1.7 + p.phase);
          x = Math.cos(p.angle) * rr; y = Math.sin(p.angle) * rr;
          s.rotation += (p.spin || 0.5) * dt;
          if (d.blink) alpha = A * (0.3 + 0.7 * Math.pow(0.5 + 0.5 * Math.sin(t * 3 + p.phase * 5), 2));
          else alpha = A * (0.75 + 0.25 * Math.sin(t * 2 + p.phase));
          break;
        }
        case "wander": {
          p.angle += d.speed * dt * (0.5 + p.seed) * p.dir;
          const rr = p.r + 0.08 * Math.sin(t * 0.7 + p.phase * 3);
          x = Math.cos(p.angle + 0.2 * Math.sin(t * 1.1 + p.phase)) * rr;
          y = Math.sin(p.angle + 0.2 * Math.sin(t * 1.1 + p.phase)) * rr;
          const blink = d.blink ? Math.pow(Math.max(0, Math.sin(t * 1.4 + p.phase * 7)), 3) : 0.6 + 0.4 * Math.sin(t * 2 + p.phase);
          alpha = A * blink;
          s.rotation += 0.3 * dt;
          break;
        }
        case "rise": {
          p.life += dt / p.lifespan;
          if (p.life >= 1) this.reset(p);
          const rr = p.r + p.life * 0.35;
          const aa = p.angle + p.life * 0.4 * p.dir;
          x = Math.cos(aa) * rr; y = Math.sin(aa) * rr - p.life * 0.25;
          alpha = A * Math.sin(Math.PI * Math.min(1, p.life)) * (0.7 + 0.3 * Math.sin(t * 9 + p.phase * 11));
          break;
        }
        case "inward": {
          p.life += dt / p.lifespan;
          if (p.life >= 1) this.reset(p);
          const k = p.life;
          const rr = d.radius[1] - (d.radius[1] - d.radius[0]) * k * k;
          p.angle += d.speed * dt * (1 + 2.5 * k);
          x = Math.cos(p.angle) * rr; y = Math.sin(p.angle) * rr;
          s.rotation += d.speed * 2 * dt * (1 + 2 * k);
          scale = p.size * (1 - 0.6 * k);
          alpha = A * Math.sin(Math.PI * Math.min(1, k));
          break;
        }
        case "flutter": {
          p.angle += d.speed * dt * (0.6 + 0.6 * p.seed);
          const rr = p.r + 0.12 * Math.sin(t * 0.6 + p.phase * 3);
          x = Math.cos(p.angle) * rr; y = Math.sin(p.angle) * rr;
          s.rotation += p.spin * dt;
          const flip = Math.cos(t * (1.5 + p.seed * 2) + p.phase);
          s.scale.x = Math.max(0.15, Math.abs(flip));
          alpha = A * (0.8 + 0.2 * Math.sin(t + p.phase));
          break;
        }
        case "puff": {
          p.life += dt / p.lifespan;
          if (p.life >= 1) this.reset(p);
          p.angle += d.speed * dt;
          x = Math.cos(p.angle) * p.r; y = Math.sin(p.angle) * p.r;
          s.rotation += (p.spin || 0.3) * dt;
          scale = p.size * (0.6 + 0.6 * p.life);
          alpha = A * Math.sin(Math.PI * Math.min(1, p.life));
          break;
        }
      }
      s.position.set(x * R, y * R);
      const texW = s.texture.orig?.width || s.texture.width || 64;
      const px = Math.max(minPx, scale * R * 2);
      const sc = px / texW;
      if (d.mode === "flutter") s.scale.set(sc * s.scale.x, sc); else s.scale.set(sc);
      s.alpha = Math.max(0, Math.min(1, alpha));
    }
  }
}

/* ======================================================================== */
/*  The ring                                                                */
/* ======================================================================== */

const programs = new Map();
function program(band) {
  let p = programs.get(band);
  if (!p) {
    p = PIXI.Program.from(VERT, COMMON + BANDS[band], `lively-${band}`);
    programs.set(band, p);
  }
  return p;
}

function quadGeometry() {
  const E = EXTENT;
  return new PIXI.MeshGeometry(
    new Float32Array([-E, -E, E, -E, E, E, -E, E]),
    new Float32Array([-E, -E, E, -E, E, E, -E, E]),
    new Uint16Array([0, 1, 2, 0, 2, 3])
  );
}

export class LivelyRing extends PIXI.Container {
  /**
   * @param {object} cfg        {design, style, scale, speed, alpha, density, color}
   * @param {object} textures   from loadTextures()
   * @param {number} quality    particle multiplier (performance setting)
   */
  constructor(cfg, textures, quality = 1) {
    super();
    this.cfg = normalizeConfig(cfg);
    this.textures = textures;
    this.quality = quality;
    this.time = Math.random() * 100;
    this.R = 0;                   // set by setRadius()
    this.eventMode = "none";
    this.interactiveChildren = false;
    this.#build();
  }

  get key() { return JSON.stringify(this.cfg); }

  #build() {
    const design = DESIGNS[this.cfg.design];
    const style = design.styles[this.cfg.style];
    const [A, B, C] = palette(style, this.cfg.color);
    const material = new PIXI.MeshMaterial(PIXI.Texture.WHITE, {
      program: program(design.band),
      uniforms: { uTime: 0, uA: new Float32Array(A), uB: new Float32Array(B), uC: new Float32Array(C), uP1: style.p1 ?? 0 }
    });
    this.band = new PIXI.Mesh(quadGeometry(), material);
    this.band.blendMode = (style.blend ?? design.blend) === "add" ? PIXI.BLEND_MODES.ADD : PIXI.BLEND_MODES.NORMAL;
    this.addChild(this.band);
    this.swarms = [];
    this.#buildSwarms();
    this.alpha = this.cfg.alpha;
  }

  #buildSwarms() {
    for (const s of this.swarms) { this.removeChild(s); s.destroy({ children: true }); }
    this.swarms = [];
    const style = DESIGNS[this.cfg.design].styles[this.cfg.style];
    const sizeFactor = Math.min(2.5, Math.max(0.6, Math.sqrt(this.R / 50)));
    for (const def of style.swarms ?? []) {
      const n = def.mode === "spinner" ? 1 : this.cfg.density <= 0 ? 0 : Math.max(1, Math.round(def.count * this.cfg.density * this.quality * sizeFactor));
      const sw = new Swarm(def, this.textures, swarmColors(def, this.cfg.color), n);
      this.swarms.push(sw);
      this.addChild(sw);
    }
    this._sizeFactor = sizeFactor;
  }

  /** Set the token radius in pixels (before the ring's own scale). */
  setRadius(px) {
    const R = Math.max(8, px * this.cfg.scale);
    if (this.R && Math.abs(R - this.R) < 0.5) return;
    this.R = R;
    this.band.scale.set(R);
    const sf = Math.min(2.5, Math.max(0.6, Math.sqrt(R / 50)));
    if (Math.abs(sf - (this._sizeFactor ?? 0)) > 0.15) this.#buildSwarms();
  }

  /** Advance the animation by dt seconds. */
  update(dt) {
    const sdt = dt * this.cfg.speed;
    this.time += sdt;
    this.band.shader.uniforms.uTime = this.time;
    for (const s of this.swarms) s.update(this.time, sdt, this.R);
  }

  destroy(options) {
    this.band?.shader?.destroy?.();
    super.destroy({ children: true, ...(options ?? {}) });
  }
}
