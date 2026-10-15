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
}`,

  // Crackling bolts of lightning that jump around the token.
  storm: `
vec4 ring(vec2 p, float r, float a, float t) {
  vec2 cs = vec2(cos(a), sin(a));
  vec3 col = vec3(0.0);
  float I = 0.0;
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float seed = hash(vec2(floor(t * 7.0 + fk * 0.37), fk));
    vec2 q = cs * (2.5 + fk) + vec2(seed * 13.0, fk * 7.1);
    float line = 1.13 + (fbm(q * 1.6) - 0.5) * 0.22 + (noise(q * 7.0) - 0.5) * 0.05;
    float d = abs(r - line);
    float span = smoothstep(0.42, 0.6, noise(cs * 1.4 + vec2(seed * 31.0, fk * 3.0)));
    float core = smoothstep(0.012, 0.003, d);
    float b = (core + exp(-d * 28.0) * 0.55) * span * step(0.25, seed);
    I += b;
    col += mix(uB, uA, core) * b;
  }
  float rim = exp(-pow((r - 1.04) / 0.04, 2.0)) * (0.25 + 0.15 * sin(t * 13.0 + a * 4.0));
  I += rim;
  col += uB * rim;
  col /= max(I, 0.001);
  return vec4(col, clamp(I, 0.0, 1.0) * smoothstep(0.96, 1.0, r));
}`,

  // Shards of ice growing out of the token's edge, glinting, with a cold mist.
  frost: `
vec4 ring(vec2 p, float r, float a, float t) {
  float N = 22.0;
  float aa = a + t * 0.03;
  vec3 col = vec3(0.0);
  float al = 0.0;
  for (int k = 0; k < 3; k++) {
    float cell = floor((aa / TAU + 0.5) * N) + float(k) - 1.0;
    float h = hash(vec2(cell, 1.7));
    float ca = (cell + 0.5 + (h - 0.5) * 0.5) / N * TAU - PI;
    float dx = aa - ca;
    dx -= TAU * floor((dx + PI) / TAU);
    float x = dx * r;
    float y = (r - 0.99) / (0.12 + 0.22 * h);
    float hw = 0.045 * (0.7 + 0.6 * hash(vec2(cell, 4.2))) * (1.0 - y);
    float inside = step(0.0, y) * step(y, 1.0);
    float cov = smoothstep(0.004, -0.004, abs(x) - hw) * inside;
    float sparkle = pow(max(0.0, sin(t * 2.0 + h * 20.0 + y * 6.0)), 12.0);
    vec3 c = mix(uB, uA, y * 0.6 + 0.2) * (x > 0.0 ? 1.0 : 0.65) + uA * sparkle * 0.8;
    c = mix(c, uA, smoothstep(0.006, 0.0, abs(abs(x) - hw)) * inside * 0.7);
    col = mix(col, c, cov);
    al = max(al, cov * 0.9);
  }
  float mist = fbm(vec2(cos(a), sin(a)) * 3.0 + vec2(t * 0.15, r * 2.0));
  float m = exp(-pow((r - 1.06) / 0.08, 2.0)) * mist * 0.6 * smoothstep(0.96, 1.0, r);
  col = mix(uA, col, clamp(al * 4.0, 0.0, 1.0));
  return vec4(col, max(al, m));
}`,

  // A ring of water with a rolling surface, caustics, foam and ripples spreading out.
  tide: `
vec4 ring(vec2 p, float r, float a, float t) {
  vec2 cs = vec2(cos(a), sin(a));
  float surf = 1.10 + 0.025 * sin(a * 7.0 - t * 1.6) + 0.018 * sin(a * 11.0 + t * 2.1) + 0.03 * (fbm(cs * 2.0 + t * 0.2) - 0.5);
  float body = smoothstep(surf + 0.006, surf - 0.006, r) * smoothstep(0.985, 1.01, r);
  vec3 col = mix(uB, uC, clamp((surf - r) / 0.11, 0.0, 1.0));
  float caustic = pow(noise(p * 9.0 + vec2(t * 0.6, -t * 0.4)) * noise(p * 13.0 - vec2(t * 0.5, t * 0.3)) * 2.2, 2.0);
  col += uA * caustic * 0.5 * body;
  float foam = smoothstep(0.014, 0.0, abs(r - surf)) * (0.6 + 0.4 * noise(cs * 14.0 + t));
  col = mix(col, uA, foam);
  float rip = 0.0;
  for (int k = 0; k < 3; k++) {
    float ph = fract(t * 0.25 + float(k) / 3.0);
    rip += smoothstep(0.012, 0.0, abs(r - (surf + 0.04 + ph * 0.4))) * (1.0 - ph) * 0.5;
  }
  float al = max(body * 0.85, foam);
  col = mix(uA, col, clamp(al * 3.0, 0.0, 1.0));
  return vec4(col, max(al, rip));
}`,

  // A shell of hexagonal force-field cells, flickering, with a light sweeping round.
  ward: `
float hexd(vec2 p) { p = abs(p); return max(dot(p, vec2(0.5, 0.8660254)), p.x); }
vec4 ring(vec2 p, float r, float a, float t) {
  float N = 36.0, Rm = 1.14;
  float aa = a + t * 0.05;
  vec2 q = vec2((aa / TAU + 0.5) * N, (r - Rm) / (TAU * Rm / N));
  vec2 s = vec2(1.0, 1.7320508);
  vec2 ga = mod(q, s) - s * 0.5;
  vec2 gb = mod(q - s * 0.5, s) - s * 0.5;
  vec2 gv = dot(ga, ga) < dot(gb, gb) ? ga : gb;
  vec2 id = q - gv;
  id.x = mod(id.x, N);
  float edge = smoothstep(0.07, 0.0, 0.5 - hexd(gv));
  float h = hash(id + floor(t * 1.5) * 0.37);
  float flash = smoothstep(0.82, 1.0, h) * (0.5 + 0.5 * sin(t * 6.0 + h * 30.0));
  float sweep = pow(0.5 + 0.5 * sin(aa * 2.0 - t * 1.5), 8.0);
  float band = smoothstep(0.12, 0.09, abs(r - Rm));
  float rims = smoothstep(0.008, 0.0, abs(r - (Rm - 0.105))) + smoothstep(0.008, 0.0, abs(r - (Rm + 0.105)));
  float I = (edge * (0.7 + sweep) + 0.10 + flash * 0.5 + sweep * 0.25) * band + rims * 0.8;
  vec3 col = mix(uB, uA, clamp(edge * 0.6 + flash + rims, 0.0, 1.0));
  return vec4(col, I);
}`,

  // Five wavering staff lines; the notes themselves are sprites.
  staff: `
vec4 ring(vec2 p, float r, float a, float t) {
  float I = 0.0;
  for (int k = 0; k < 5; k++) {
    float fk = float(k);
    float rr = 1.06 + fk * 0.035 + 0.02 * sin(a * 3.0 + t * 1.2 + fk * 0.4);
    I += smoothstep(0.006, 0.0015, abs(r - rr));
  }
  float fade = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(a * 2.0 - t * 0.8), 2.0);
  float glow = exp(-pow((r - 1.13) / 0.1, 2.0)) * 0.15;
  return vec4(mix(uB, uA, fade), I * fade * 0.8 + glow);
}`,

  // A warm halo that beats like a heart; the hearts are sprites.
  heartbeat: `
vec4 ring(vec2 p, float r, float a, float t) {
  float beat = pow(abs(sin(t * 2.4)), 12.0) + 0.6 * pow(abs(sin(t * 2.4 + 0.5)), 12.0);
  float h = exp(-pow((r - 1.08 - beat * 0.03) / (0.07 + 0.03 * beat), 2.0)) * (0.25 + 0.45 * beat);
  float n = noise(vec2(cos(a), sin(a)) * 4.0 + t * 0.5);
  return vec4(mix(uB, uA, clamp(beat, 0.0, 1.0)), h * (0.8 + 0.4 * n) * smoothstep(0.95, 1.01, r));
}`,

  // Dark tendrils writhing out of the token's edge.
  tendrils: `
vec4 ring(vec2 p, float r, float a, float t) {
  vec2 cs = vec2(cos(a), sin(a));
  float w = a * 13.0 + 1.4 * sin(r * 8.0 - t * 1.3 + a * 2.0) + 2.0 * fbm(cs * 2.0 + t * 0.15);
  float strand = pow(0.5 + 0.5 * cos(w), 5.0);
  float y = (r - 0.99) / (0.16 + 0.32 * fbm(cs * 1.7 + vec2(t * 0.1, 3.0)));
  float m = strand * smoothstep(1.0, 0.2, y) * smoothstep(-0.02, 0.06, y);
  float base = exp(-pow((r - 1.02) / 0.05, 2.0)) * 0.8 * smoothstep(0.96, 1.0, r);
  vec3 col = mix(uC, uB, clamp(y, 0.0, 1.0));
  col += uA * pow(strand, 4.0) * smoothstep(0.4, 1.0, y) * 0.7;
  return vec4(col, max(m, base));
}`,

  // A thin band of dust; the stones are sprites.
  dust: `
vec4 ring(vec2 p, float r, float a, float t) {
  vec2 q = rot(t * 0.12) * p;
  float n = fbm(q * 4.0);
  float d = exp(-pow((r - 1.22) / 0.10, 2.0)) * smoothstep(0.35, 0.8, n) * 0.55;
  return vec4(mix(uC, uB, n), d);
}`,
  // Daggers circling the token tip-first: bevelled blades, crossguard, wrapped grip, pommel.
  knives: `
float sdBox(vec2 p, vec2 b) { vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
vec4 ring(vec2 p, float r, float a, float t) {
  float N = 8.0, R0 = 1.2;
  float aa = a - t * 0.55;
  vec2 lp = r * vec2(cos(aa), sin(aa));          // position in the turning frame
  vec3 col = vec3(0.0);
  float al = 0.0, trail = 0.0, glint = 0.0;
  for (int k = 0; k < 3; k++) {
    float cell = floor((aa / TAU + 0.5) * N) + float(k) - 1.0;
    float id = mod(cell, N);
    float ca = (cell + 0.5) / N * TAU - PI;
    vec2 n = vec2(cos(ca), sin(ca));
    vec2 q = (lp - n * (R0 + 0.012 * sin(t * 2.0 + id * 1.7))) / 1.5;   // knife drawn 1.5x
    vec2 dir = cos(0.28) * vec2(-n.y, n.x) + sin(0.28) * n;   // tip forward, tilted a little outward
    float x = dot(q, dir), y = dot(q, vec2(-dir.y, dir.x));
    // blade from the guard (x = -0.06) to the tip (x = 0.18)
    float bw = 0.034 * sqrt(clamp((0.18 - x) / 0.12, 0.0, 1.0));
    float blade = smoothstep(0.003, -0.003, abs(y) - bw) * step(-0.06, x) * step(x, 0.18);
    float across = abs(y) / max(bw, 0.001);
    vec3 bc = mix(uB, uA, smoothstep(0.35, 0.95, across));
    bc = mix(bc, uC * 1.2 + uB * 0.3, smoothstep(0.3, 0.0, abs(y) / 0.034) * step(x, 0.08) * 0.6);
    bc += uA * pow(max(0.0, sin(x * 18.0 - t * 3.0 + id * 2.3)), 16.0) * 0.8;
    bc *= y > 0.0 ? 1.08 : 0.82;
    float guard = smoothstep(0.003, -0.003, sdBox(vec2(x + 0.065, y), vec2(0.012, 0.062)));
    float grip = smoothstep(0.003, -0.003, sdBox(vec2(x + 0.12, y), vec2(0.045, 0.018)));
    float pommel = smoothstep(0.003, -0.003, length(vec2(x + 0.175, y)) - 0.024);
    vec3 hilt = mix(uB, vec3(0.78, 0.58, 0.26), uP1) * (0.75 + 0.45 * smoothstep(-0.05, 0.05, y));
    vec3 wrap = mix(uC, vec3(0.20, 0.11, 0.06), 0.6) * (0.6 + 0.4 * step(0.5, fract((x + 0.12) * 60.0)));
    float cov = max(max(blade, guard), max(grip, pommel));
    vec3 kc = mix(bc, wrap, grip);
    kc = mix(kc, hilt, max(guard, pommel));
    col = mix(col, kc, cov);
    al = max(al, cov);
    trail += exp(-y * y / 0.0003) * smoothstep(-0.42, -0.2, x) * step(x, -0.2) * 0.25;
    float g = pow(max(0.0, sin(t * 1.3 + id * 2.1)), 40.0);
    float dx = abs(x - 0.15), dy = abs(y);
    glint += (exp(-dx * 60.0) * exp(-dy * 400.0) + exp(-dy * 60.0) * exp(-dx * 400.0)) * g;
  }
  col = mix(uA, col, clamp(al * 3.0, 0.0, 1.0)) + uA * glint;
  return vec4(col, max(al, max(trail, glint)));
}`
};

/* ======================================================================== */
/*  Designs and styles                                                      */
/* ======================================================================== */
/*
 * band:   which shader draws the ring (optional: effects-only designs have none)
 * blend:  "normal" | "add"
 * colors: [bright, main, dark] for the band  p1:    style parameter (glow)
 * swarms: sprite groups, see class Swarm
 *   tex    texture name     count   sprites at size 1 (scales with creature size)
 *   mode   orbit | inward | rise | wander | flutter | puff | emit (see below)
 *   radius [min, max] in token radii      size [min, max] in token radii
 *   speed  angular speed (rad/s)          colors  list of hex colours
 *   blend  add | normal                   alpha   max opacity    spin  rad/s
 *
 * mode "emit" is a particle emitter: sprites are born, move and die, instead of a fixed count looping.
 * Everything is in token radii and seconds:
 *   rate    particles born per second (times density, detail and creature size)
 *   life    [min, max] seconds a particle lives
 *   radius  [min, max] distance from the centre where it is born (0.9 - 1.25 hugs the edge)
 *   size    [start, end] diameter as a factor of the texture (see EMIT_SCALE); end > start grows
 *   out     [min, max] outward speed (negative: drawn inward)
 *   swirl   sideways speed around the token     wobble  random sideways meander
 *   group   born at this many points that turn at `lead` rad/s; with a low swirl they leave tails
 *   spin    sprite rotation speed               flicker 0 - 1 twinkle
 *   colors  ramp over the particle's life: [[t, colour, alpha], ...]; colour is "bright", "main",
 *           "dark" (the style's palette, so a custom colour recolours it) or a hex colour
 */

/** Colour ramps for emitters, in terms of the style's palette. */
const RAMP = {
  hot: (a = 1) => [[0, "#ffffff", 0], [0.06, "bright", a], [0.45, "main", a * 0.85], [1, "dark", 0]],
  glow: (a = 1) => [[0, "bright", 0], [0.15, "bright", a], [0.6, "main", a * 0.7], [1, "main", 0]],
  main: (a = 1) => [[0, "main", 0], [0.2, "main", a], [1, "dark", 0]],
  bright: (a = 1) => [[0, "bright", 0], [0.2, "bright", a], [0.7, "main", a * 0.6], [1, "main", 0]],
  shade: (a, mid = a * 0.6) => [[0, "dark", 0], [0.3, "dark", a], [0.75, "dark", mid], [1, "dark", 0]],
  leaf: (a = 0.95) => [[0, "main", 0], [0.12, "main", a], [0.7, "dark", a * 0.85], [1, "dark", 0]],
  dust: (a) => [[0, "main", 0], [0.2, "main", a], [1, "main", 0]],
  mixed: (a = 1) => [[0, "dark", 0], [0.15, "dark", a], [0.6, "main", a * 0.7], [1, "main", 0]]
};

/** Styles of an effects-only design: every style shares the same emitters, only the palette differs. */
function emitStyles(swarms, styles) {
  return Object.fromEntries(Object.entries(styles).map(([id, [label, ...colors]]) => [id, { label, colors, swarms }]));
}

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
  },

  storm: {
    label: "Storm", icon: "fa-solid fa-bolt", band: "storm", blend: "add",
    styles: {
      storm: { label: "Thunder", colors: ["#ffffff", "#6ab8ff", "#0a1a4a"],
        swarms: [{ tex: "sparkle", count: 10, mode: "wander", radius: [1.05, 1.3], size: [0.06, 0.1], speed: 0.6, colors: ["#e0f4ff", "#9ad0ff"], blend: "add", alpha: 1, blink: true }] },
      arcane: { label: "Arcane", colors: ["#fff0ff", "#c05aff", "#2a0a4a"],
        swarms: [{ tex: "sparkle", count: 10, mode: "wander", radius: [1.05, 1.3], size: [0.06, 0.1], speed: 0.6, colors: ["#f0d0ff", "#c08aff"], blend: "add", alpha: 1, blink: true }] },
      golden: { label: "Golden", colors: ["#ffffff", "#ffd84a", "#4a3000"],
        swarms: [{ tex: "sparkle", count: 10, mode: "wander", radius: [1.05, 1.3], size: [0.06, 0.1], speed: 0.6, colors: ["#fff4c0", "#ffd86a"], blend: "add", alpha: 1, blink: true }] },
      crimson: { label: "Crimson", colors: ["#fff0f0", "#ff3a4a", "#3a0008"],
        swarms: [{ tex: "sparkle", count: 10, mode: "wander", radius: [1.05, 1.3], size: [0.06, 0.1], speed: 0.6, colors: ["#ffd0d0", "#ff6a6a"], blend: "add", alpha: 1, blink: true }] }
    }
  },

  frost: {
    label: "Frost", icon: "fa-solid fa-snowflake", band: "frost", blend: "normal",
    styles: {
      frost: { label: "Frost", colors: ["#ffffff", "#9ad8ff", "#1a4a7a"],
        swarms: [{ tex: "sparkle", count: 14, mode: "flutter", radius: [1.05, 1.45], size: [0.06, 0.1], speed: 0.25, colors: ["#ffffff", "#d8f0ff"], blend: "add", alpha: 0.9 }] },
      glacier: { label: "Glacier", colors: ["#e0ffff", "#3a9ad8", "#0a1a4a"],
        swarms: [{ tex: "sparkle", count: 12, mode: "flutter", radius: [1.05, 1.45], size: [0.06, 0.1], speed: 0.25, colors: ["#c8f8ff"], blend: "add", alpha: 0.9 }] },
      rime: { label: "Rime", colors: ["#ffffff", "#c8d4dc", "#4a5a68"],
        swarms: [{ tex: "stars", count: 16, mode: "flutter", radius: [1.05, 1.5], size: [0.1, 0.15], speed: 0.25, colors: ["#ffffff"], blend: "add", alpha: 0.9 }] },
      amethyst: { label: "Amethyst", colors: ["#fff0ff", "#b878ff", "#2a0a5a"],
        swarms: [{ tex: "sparkle", count: 12, mode: "flutter", radius: [1.05, 1.45], size: [0.06, 0.1], speed: 0.25, colors: ["#f0d8ff", "#d0a8ff"], blend: "add", alpha: 0.9 }] }
    }
  },

  tide: {
    label: "Tide", icon: "fa-solid fa-water", band: "tide", blend: "normal",
    styles: {
      ocean: { label: "Ocean", colors: ["#e0ffff", "#1a8ad8", "#06204a"],
        swarms: [{ tex: "bubble", count: 12, mode: "rise", radius: [1.0, 1.15], size: [0.04, 0.08], speed: 0.4, colors: ["#d8f8ff"], blend: "normal", alpha: 0.9 }] },
      tropical: { label: "Tropical", colors: ["#f0fff8", "#1ad8c0", "#04404a"],
        swarms: [{ tex: "bubble", count: 12, mode: "rise", radius: [1.0, 1.15], size: [0.04, 0.08], speed: 0.4, colors: ["#e0fff8"], blend: "normal", alpha: 0.9 }] },
      swamp: { label: "Swamp", colors: ["#d8f0a0", "#5a7a2a", "#1a2408"],
        swarms: [{ tex: "bubble", count: 14, mode: "rise", radius: [1.0, 1.15], size: [0.05, 0.1], speed: 0.3, colors: ["#b8d880", "#8aa85a"], blend: "normal", alpha: 0.9 }] },
      blood: { label: "Blood", colors: ["#ffb0a8", "#a80a14", "#2a0002"],
        swarms: [{ tex: "bubble", count: 10, mode: "rise", radius: [1.0, 1.15], size: [0.04, 0.08], speed: 0.3, colors: ["#ff8a80"], blend: "normal", alpha: 0.9 }] }
    }
  },

  ward: {
    label: "Arcane Ward", icon: "fa-solid fa-shield-halved", band: "ward", blend: "add",
    styles: {
      arcane: { label: "Arcane", colors: ["#e8f8ff", "#3a9aff", "#0a1a4a"] },
      holy: { label: "Holy", colors: ["#fffbe0", "#ffc83a", "#4a3000"] },
      nature: { label: "Nature", colors: ["#f0ffe0", "#4adf6a", "#0a3a12"] },
      infernal: { label: "Infernal", colors: ["#ffe8d0", "#ff4a1a", "#3a0400"] }
    }
  },

  melody: {
    label: "Bard's Song", icon: "fa-solid fa-music", band: "staff", blend: "add",
    styles: {
      golden: { label: "Golden", colors: ["#fff8d0", "#ffc84a", "#4a3000"],
        swarms: [{ tex: "note", count: 9, mode: "flutter", radius: [1.1, 1.5], size: [0.1, 0.15], speed: 0.4, colors: ["#ffe08a", "#fff0c0"], blend: "add", alpha: 1 }] },
      silver: { label: "Silver", colors: ["#ffffff", "#c8d8e8", "#3a4a5a"],
        swarms: [{ tex: "note", count: 9, mode: "flutter", radius: [1.1, 1.5], size: [0.1, 0.15], speed: 0.4, colors: ["#ffffff", "#d8e8f8"], blend: "add", alpha: 1 }] },
      rose: { label: "Rose", colors: ["#fff0f6", "#ff7ab8", "#4a0a2a"],
        swarms: [{ tex: "note", count: 9, mode: "flutter", radius: [1.1, 1.5], size: [0.1, 0.15], speed: 0.4, colors: ["#ffb0d8", "#ffd8ea"], blend: "add", alpha: 1 }] },
      azure: { label: "Azure", colors: ["#f0fbff", "#4ab8ff", "#0a2a4a"],
        swarms: [{ tex: "note", count: 9, mode: "flutter", radius: [1.1, 1.5], size: [0.1, 0.15], speed: 0.4, colors: ["#a8e0ff", "#e0f4ff"], blend: "add", alpha: 1 }] }
    }
  },

  hearts: {
    label: "Charm", icon: "fa-solid fa-heart", band: "heartbeat", blend: "add",
    styles: {
      rose: { label: "Rose", colors: ["#ffe0ec", "#ff4a8a", "#4a0020"],
        swarms: [{ tex: "heart", count: 10, mode: "rise", radius: [1.0, 1.2], size: [0.07, 0.11], speed: 0.4, colors: ["#ff6aa0", "#ff3a7a", "#ffa0c8"], blend: "normal", alpha: 1 }] },
      lovesick: { label: "Lovesick", colors: ["#f8e0ff", "#b04aff", "#2a0040"],
        swarms: [{ tex: "heart", count: 10, mode: "rise", radius: [1.0, 1.2], size: [0.07, 0.11], speed: 0.4, colors: ["#c87aff", "#e0a8ff"], blend: "normal", alpha: 1 }] },
      crimson: { label: "Crimson", colors: ["#ffd0d0", "#e0101a", "#3a0002"],
        swarms: [{ tex: "heart", count: 10, mode: "rise", radius: [1.0, 1.2], size: [0.07, 0.11], speed: 0.4, colors: ["#e81a2a", "#ff4a4a"], blend: "normal", alpha: 1 }] },
      fae: { label: "Fae", colors: ["#f0fff0", "#ff8ad8", "#0a3a2a"],
        swarms: [{ tex: "heart", count: 8, mode: "flutter", radius: [1.05, 1.45], size: [0.07, 0.1], speed: 0.35, colors: ["#ffa8e0", "#a8ffd0"], blend: "normal", alpha: 1 },
                 { tex: "glow", count: 8, mode: "wander", radius: [1.05, 1.35], size: [0.04, 0.07], speed: 0.25, colors: ["#d8ffe8", "#ffd8f4"], blend: "add", alpha: 0.9 }] }
    }
  },

  necrotic: {
    label: "Necrotic", icon: "fa-solid fa-skull", band: "tendrils", blend: "normal",
    styles: {
      necrotic: { label: "Necrotic", colors: ["#c8ff8a", "#2a5a1a", "#060a04"],
        swarms: [{ tex: "glow", count: 12, mode: "rise", radius: [1.0, 1.2], size: [0.04, 0.07], speed: 0.4, colors: ["#9aff5a", "#5adf3a"], blend: "add", alpha: 1 }] },
      shadow: { label: "Shadow", colors: ["#c8a8ff", "#2a1a3a", "#050308"],
        swarms: [{ tex: "smoke", count: 8, mode: "puff", radius: [1.05, 1.3], size: [0.3, 0.5], speed: 0.3, colors: ["#120c18", "#1a1222"], blend: "normal", alpha: 0.6, spin: 0.4 }] },
      blood: { label: "Blood", colors: ["#ff8a7a", "#6a0a0a", "#0a0202"],
        swarms: [{ tex: "glow", count: 10, mode: "rise", radius: [1.0, 1.2], size: [0.04, 0.07], speed: 0.35, colors: ["#ff3a2a"], blend: "add", alpha: 1 }] },
      bone: { label: "Bone", colors: ["#ffffff", "#c8bca0", "#2a241a"],
        swarms: [{ tex: "glow", count: 10, mode: "rise", radius: [1.0, 1.2], size: [0.04, 0.07], speed: 0.35, colors: ["#e8e0c8"], blend: "add", alpha: 0.9 }] }
    }
  },

  stones: {
    label: "Orbiting Stones", icon: "fa-solid fa-mountain", band: "dust", blend: "normal",
    styles: {
      granite: { label: "Granite", colors: ["#d8d8d0", "#8a8a84", "#2a2a28"],
        swarms: [{ tex: "rock", count: 6, mode: "orbit", radius: [1.2, 1.3], size: [0.12, 0.18], speed: 0.35, colors: ["#b8b8b0", "#9a9a94"], blend: "normal", alpha: 1, spin: 0.6 },
                 { tex: "rock", count: 8, mode: "orbit", radius: [1.14, 1.34], size: [0.05, 0.07], speed: 0.5, colors: ["#a8a8a0"], blend: "normal", alpha: 1, spin: 1.2 }] },
      sandstone: { label: "Sandstone", colors: ["#fff0c8", "#d8a868", "#4a3010"],
        swarms: [{ tex: "rock", count: 6, mode: "orbit", radius: [1.2, 1.3], size: [0.12, 0.18], speed: 0.35, colors: ["#e8b878", "#d89a5a"], blend: "normal", alpha: 1, spin: 0.6 },
                 { tex: "rock", count: 8, mode: "orbit", radius: [1.14, 1.34], size: [0.05, 0.07], speed: 0.5, colors: ["#e0b080"], blend: "normal", alpha: 1, spin: 1.2 }] },
      obsidian: { label: "Obsidian", colors: ["#c8a8ff", "#3a3048", "#08060c"],
        swarms: [{ tex: "rock", count: 6, mode: "orbit", radius: [1.2, 1.3], size: [0.12, 0.18], speed: 0.35, colors: ["#4a4058", "#3a3044"], blend: "normal", alpha: 1, spin: 0.6 },
                 { tex: "glow", count: 8, mode: "orbit", radius: [1.14, 1.34], size: [0.03, 0.05], speed: 0.5, colors: ["#b88aff"], blend: "add", alpha: 0.9 }] },
      jade: { label: "Jade", colors: ["#e0fff0", "#3ab87a", "#06301a"],
        swarms: [{ tex: "rock", count: 6, mode: "orbit", radius: [1.2, 1.3], size: [0.12, 0.18], speed: 0.35, colors: ["#5ad89a", "#3ab87a"], blend: "normal", alpha: 1, spin: 0.6 },
                 { tex: "glow", count: 8, mode: "orbit", radius: [1.14, 1.34], size: [0.03, 0.05], speed: 0.5, colors: ["#a8ffd0"], blend: "add", alpha: 0.9 }] }
    }
  },

  knives: {
    label: "Knives", icon: "fa-solid fa-dagger", band: "knives", blend: "normal",
    styles: {
      steel: { label: "Steel", colors: ["#ffffff", "#a8b0bc", "#2a2e36"], p1: 0.85,
        swarms: [{ tex: "sparkle", count: 4, mode: "orbit", radius: [1.2, 1.3], size: [0.05, 0.08], speed: 0.55, colors: ["#ffffff"], blend: "add", alpha: 0.9, blink: true }] },
      assassin: { label: "Assassin", colors: ["#ff5a5a", "#2a2a30", "#08080a"], p1: 0 },
      gilded: { label: "Gilded", colors: ["#fff4c8", "#d8a83a", "#3a2608"], p1: 1,
        swarms: [{ tex: "sparkle", count: 5, mode: "orbit", radius: [1.2, 1.3], size: [0.05, 0.08], speed: 0.55, colors: ["#fff0b0"], blend: "add", alpha: 0.9, blink: true }] },
      spectral: { label: "Spectral", blend: "add", colors: ["#e0f8ff", "#5ac8ff", "#0a2a4a"], p1: 0,
        swarms: [{ tex: "glow", count: 10, mode: "orbit", radius: [1.12, 1.24], size: [0.04, 0.07], speed: 0.55, colors: ["#bff0ff"], blend: "add", alpha: 0.8 }] }
    }
  },

  rage: {
    label: "Rage Embers", icon: "fa-solid fa-fire-flame-curved", blend: "add",
    styles: emitStyles([
      { tex: "smoke", mode: "emit", blend: "normal", rate: 6, life: [1.5, 2.5], radius: [0.95, 1.1], size: [0.15, 0.5], out: [0.08, 0.18], swirl: 0.1, colors: RAMP.shade(0.45) },
      { tex: "glow", mode: "emit", blend: "add", rate: 30, life: [0.8, 1.6], radius: [0.9, 1.15], size: [0.07, 0.015], out: [0.15, 0.45], swirl: 0.05, wobble: 0.15, flicker: 0.4, colors: RAMP.hot() },
      { tex: "sparkle", mode: "emit", blend: "add", rate: 6, life: [0.2, 0.4], radius: [0.95, 1.1], size: [0.1, 0.02], out: [0.4, 0.8], colors: RAMP.hot() }
    ], {
      berserker: ["Berserker", "#ffe0a0", "#ff3a14", "#4a0402"],
      wildheart: ["Wild Heart", "#fff0b8", "#e8902a", "#3a1a06"],
      worldtree: ["World Tree", "#e8ffd0", "#5ac83a", "#0a2a06"],
      zealot: ["Zealot", "#ffffff", "#ffd04a", "#5a2a00"]
    })
  },

  encore: {
    label: "Encore", icon: "fa-solid fa-guitar", blend: "add",
    styles: emitStyles([
      { tex: "glow", mode: "emit", blend: "add", rate: 70, group: 3, lead: 1.6, swirl: 0.1, wobble: 0.35, life: [0.5, 1.0], radius: [1.15, 1.25], size: [0.055, 0.01], out: [0, 0.02], colors: RAMP.glow() },
      { tex: "glow", mode: "emit", blend: "add", rate: 30, group: 2, lead: -1.1, swirl: -0.08, life: [0.4, 0.8], radius: [1.38, 1.42], size: [0.035, 0.01], out: [0, 0], colors: RAMP.bright(0.8) },
      { tex: "sparkle", mode: "emit", blend: "add", rate: 8, life: [1, 2], radius: [1.05, 1.4], size: [0.08, 0.01], out: [0.05, 0.15], flicker: 0.7, spin: 1.5, colors: RAMP.glow() }
    ], {
      lore: ["Lore", "#fff8d0", "#ffc84a", "#4a3000"],
      valor: ["Valor", "#ffe8d0", "#ff5a3a", "#4a0a0a"],
      glamour: ["Glamour", "#fff0f6", "#ff7ab8", "#4a0a2a"],
      eloquence: ["Eloquence", "#f0fbff", "#4ab8ff", "#0a2a4a"]
    })
  },

  radiance: {
    label: "Radiance", icon: "fa-solid fa-hands-praying", blend: "add",
    styles: emitStyles([
      { tex: "glow", mode: "emit", blend: "add", rate: 18, life: [1.5, 2.5], radius: [0.95, 1.1], size: [0.1, 0.25], out: [0.05, 0.12], colors: RAMP.main(0.22) },
      { tex: "glow", mode: "emit", blend: "add", rate: 36, group: 6, lead: 0.35, swirl: 0, life: [0.6, 1.0], radius: [1.28, 1.3], size: [0.05, 0], out: [0, 0], colors: RAMP.glow() },
      { tex: "sparkle", mode: "emit", blend: "add", rate: 12, life: [1, 2], radius: [0.9, 1.3], size: [0.09, 0.015], out: [0.05, 0.15], flicker: 0.6, spin: 1, colors: RAMP.glow() }
    ], {
      light: ["Light", "#ffffff", "#ffd85a", "#6a4400"],
      life: ["Life", "#ffffff", "#ffe0b8", "#a85a2a"],
      tempest: ["Tempest", "#ffffff", "#7ac8ff", "#0a2a6a"],
      grave: ["Grave", "#f0e8ff", "#a890d0", "#1a1428"]
    })
  },

  wildbloom: {
    label: "Wild Bloom", icon: "fa-solid fa-tree", blend: "add",
    styles: emitStyles([
      { tex: "leaf", mode: "emit", blend: "normal", rate: 9, life: [2.5, 4], radius: [0.95, 1.15], size: [0.12, 0.1], out: [0.06, 0.14], swirl: 0.18, wobble: 0.2, spin: 1.2, colors: RAMP.leaf() },
      { tex: "glow", mode: "emit", blend: "add", rate: 18, life: [2.5, 4.5], radius: [0.95, 1.3], size: [0.06, 0.025], out: [0.03, 0.1], wobble: 0.25, flicker: 0.5, colors: RAMP.bright() }
    ], {
      land: ["Land", "#e8ffb0", "#5ab83a", "#2a3a10"],
      moon: ["Moon", "#e8f4ff", "#8ab8d8", "#1a2a3a"],
      spores: ["Spores", "#f0ffa0", "#a8a050", "#2a1a10"],
      stars: ["Stars", "#ffffff", "#7ab0ff", "#141a40"]
    })
  },

  steelsparks: {
    label: "Steel Sparks", icon: "fa-solid fa-shield", blend: "add",
    styles: emitStyles([
      { tex: "glow", mode: "emit", blend: "add", rate: 160, group: 2, lead: 3.0, swirl: 0.2, life: [0.15, 0.32], radius: [1.17, 1.22], size: [0.08, 0.025], out: [0, 0], colors: RAMP.glow(0.9) },
      { tex: "sparkle", mode: "emit", blend: "add", rate: 40, group: 2, lead: 3.0, swirl: 0.6, life: [0.2, 0.45], radius: [1.15, 1.25], size: [0.08, 0.01], out: [0.4, 0.9], colors: RAMP.hot() },
      { tex: "sparkle", mode: "emit", blend: "add", rate: 3, life: [0.4, 0.8], radius: [1.0, 1.3], size: [0.1, 0.02], out: [0, 0.05], flicker: 0.8, colors: RAMP.glow() }
    ], {
      champion: ["Champion", "#ffffff", "#c8d4e0", "#3a4450"],
      battlemaster: ["Battle Master", "#fff4d0", "#e8b04a", "#4a2a08"],
      eldritch: ["Eldritch Knight", "#e8f0ff", "#5a8aff", "#10204a"],
      psi: ["Psi Warrior", "#ffe8ff", "#e05ad8", "#3a0a3a"]
    })
  },

  kiflow: {
    label: "Ki Flow", icon: "fa-solid fa-yin-yang", blend: "add",
    styles: emitStyles([
      { tex: "smoke", mode: "emit", blend: "add", rate: 5, life: [2, 3], radius: [1.0, 1.15], size: [0.2, 0.45], out: [0.02, 0.06], swirl: 0.3, colors: RAMP.main(0.12) },
      { tex: "glow", mode: "emit", blend: "add", rate: 14, life: [1.2, 1.8], radius: [1.5, 1.7], size: [0.03, 0.06], out: [-0.25, -0.15], swirl: 0.3, colors: RAMP.bright(0.9) },
      { tex: "glow", mode: "emit", blend: "add", rate: 80, group: 2, lead: 1.4, swirl: 0.12, life: [0.6, 1.0], radius: [1.12, 1.16], size: [0.07, 0.02], out: [0, 0], colors: RAMP.glow() }
    ], {
      openhand: ["Open Hand", "#ffffff", "#ffd89a", "#6a3a0a"],
      shadow: ["Shadow", "#d8d0ff", "#6a5aa8", "#08060f"],
      elements: ["Elements", "#fff0d0", "#ff7a3a", "#0a4a8a"],
      mercy: ["Mercy", "#e8fff4", "#4ad8b0", "#0a3a30"]
    })
  },

  holyaura: {
    label: "Holy Aura", icon: "fa-solid fa-hand-sparkles", blend: "add",
    styles: emitStyles([
      { tex: "glow", mode: "emit", blend: "add", rate: 22, life: [1.0, 1.6], radius: [1.0, 1.1], size: [0.12, 0.3], out: [0.15, 0.3], colors: RAMP.main(0.2) },
      { tex: "shard", mode: "emit", blend: "add", rate: 5, life: [1.0, 1.6], radius: [1.0, 1.1], size: [0.13, 0.05], out: [0.1, 0.2], colors: RAMP.glow() },
      { tex: "sparkle", mode: "emit", blend: "add", rate: 9, life: [0.8, 1.6], radius: [0.95, 1.3], size: [0.08, 0.015], out: [0.04, 0.12], flicker: 0.6, colors: RAMP.glow() }
    ], {
      devotion: ["Devotion", "#ffffff", "#ffe07a", "#6a4a00"],
      vengeance: ["Vengeance", "#ffe0d0", "#d82a1a", "#2a0202"],
      ancients: ["Ancients", "#f0ffd8", "#7ad84a", "#1a3a08"],
      glory: ["Glory", "#fff8ff", "#ffb04a", "#6a1a4a"]
    })
  },

  huntertrail: {
    label: "Hunter's Trail", icon: "fa-solid fa-paw", blend: "add",
    styles: emitStyles([
      { tex: "leaf", mode: "emit", blend: "normal", rate: 4, life: [2.5, 3.5], radius: [1.0, 1.2], size: [0.1, 0.08], out: [0.06, 0.12], swirl: 0.25, wobble: 0.2, spin: 1.5, colors: RAMP.leaf(0.8) },
      { tex: "glow", mode: "emit", blend: "add", rate: 12, life: [2.5, 4], radius: [1.05, 1.5], size: [0.055, 0.025], out: [0, 0.05], wobble: 0.3, flicker: 0.6, colors: RAMP.bright() },
      { tex: "glow", mode: "emit", blend: "add", rate: 90, group: 1, lead: 1.8, swirl: 0.1, life: [0.4, 0.8], radius: [1.27, 1.3], size: [0.09, 0], out: [0, 0], colors: RAMP.glow() }
    ], {
      hunter: ["Hunter", "#fff4c8", "#d8b04a", "#3a2a10"],
      gloomstalker: ["Gloom Stalker", "#e0d0ff", "#7a5ad8", "#0a0614"],
      beastmaster: ["Beast Master", "#ffe8c0", "#d8803a", "#3a1a08"],
      feywanderer: ["Fey Wanderer", "#fff0ff", "#ff8ae0", "#2a0a3a"]
    })
  },

  shadowstep: {
    label: "Shadow Step", icon: "fa-solid fa-mask", blend: "normal",
    styles: emitStyles([
      { tex: "smoke", mode: "emit", blend: "normal", rate: 16, life: [1.6, 2.6], radius: [0.9, 1.1], size: [0.14, 0.6], out: [0.06, 0.16], swirl: 0.28, colors: RAMP.shade(0.85, 0.5) },
      { tex: "glow", mode: "emit", blend: "add", rate: 6, life: [1.2, 2], radius: [1.0, 1.2], size: [0.1, 0.18], out: [0.05, 0.1], swirl: 0.28, colors: RAMP.main(0.18) },
      { tex: "sparkle", mode: "emit", blend: "add", rate: 2.5, life: [0.3, 0.6], radius: [1.0, 1.35], size: [0.13, 0.02], out: [0, 0.03], flicker: 0.3, colors: RAMP.glow() }
    ], {
      thief: ["Thief", "#e8eef4", "#5a6470", "#0a0c10"],
      assassin: ["Assassin", "#ffd0d0", "#c0101a", "#0a0204"],
      trickster: ["Arcane Trickster", "#f0d8ff", "#9a4aff", "#0a0414"],
      soulknife: ["Soulknife", "#e0ffff", "#3ad8ff", "#020a14"]
    })
  },

  wildsurge: {
    label: "Wild Surge", icon: "fa-solid fa-wand-sparkles", blend: "add",
    styles: emitStyles([
      { tex: "glow", mode: "emit", blend: "add", rate: 36, life: [0.6, 1.3], radius: [0.95, 1.1], size: [0.09, 0.025], out: [0.1, 0.45], swirl: 0.45, wobble: 0.6, flicker: 0.5, colors: RAMP.glow() },
      { tex: "glow", mode: "emit", blend: "add", rate: 30, life: [0.6, 1.3], radius: [0.95, 1.1], size: [0.08, 0.02], out: [0.1, 0.35], swirl: -0.45, wobble: 0.6, flicker: 0.5, colors: RAMP.mixed() },
      { tex: "sparkle", mode: "emit", blend: "add", rate: 10, life: [0.15, 0.35], radius: [1.0, 1.3], size: [0.1, 0.02], out: [0.3, 0.7], flicker: 0.6, spin: 4, colors: RAMP.hot() }
    ], {
      draconic: ["Draconic", "#fff0b0", "#ff5a1a", "#7a0a3a"],
      wild: ["Wild Magic", "#ffffff", "#ff4ad8", "#2ad8ff"],
      aberrant: ["Aberrant", "#e8ffd0", "#8adf3a", "#5a1a8a"],
      clockwork: ["Clockwork", "#ffffff", "#ffd86a", "#3a8aba"]
    })
  },

  eldritch: {
    label: "Eldritch Pact", icon: "fa-solid fa-eye", blend: "normal",
    styles: emitStyles([
      { tex: "smoke", mode: "emit", blend: "normal", rate: 12, life: [1.4, 2.0], radius: [1.55, 1.75], size: [0.55, 0.3], out: [-0.28, -0.18], swirl: 0.35, colors: RAMP.shade(0.55, 0.45) },
      { tex: "glow", mode: "emit", blend: "add", rate: 8, life: [1.2, 1.8], radius: [1.5, 1.7], size: [0.025, 0.05], out: [-0.3, -0.2], swirl: 0.35, colors: RAMP.bright() },
      { tex: "glow", mode: "emit", blend: "add", rate: 75, group: 3, lead: -0.9, swirl: -0.05, life: [0.5, 0.9], radius: [1.22, 1.26], size: [0.06, 0], out: [0, 0], colors: RAMP.glow() }
    ], {
      fiend: ["Fiend", "#ffd0a0", "#ff3a0a", "#1a0202"],
      archfey: ["Archfey", "#f0ffe8", "#ff7ad8", "#0a1a2a"],
      greatoldone: ["Great Old One", "#e0ffd0", "#5aff7a", "#0a0418"],
      celestial: ["Celestial", "#ffffff", "#ffe8a0", "#2a2a5a"]
    })
  },

  spellweave: {
    label: "Spellweave", icon: "fa-solid fa-book-open", blend: "add",
    styles: emitStyles([
      { tex: "glow", mode: "emit", blend: "add", rate: 90, group: 4, lead: 2.4, swirl: 0.15, life: [0.45, 0.8], radius: [1.18, 1.22], size: [0.06, 0.01], out: [0, 0], colors: RAMP.glow() },
      { tex: "glow", mode: "emit", blend: "add", rate: 40, group: 3, lead: -1.2, swirl: -0.05, life: [0.4, 0.7], radius: [1.45, 1.48], size: [0.035, 0], out: [0, 0], colors: RAMP.bright(0.75) },
      { tex: "sparkle", mode: "emit", blend: "add", rate: 8, life: [1, 1.8], radius: [1.0, 1.4], size: [0.07, 0.01], out: [0.03, 0.1], flicker: 0.65, colors: RAMP.glow() }
    ], {
      evocation: ["Evocation", "#fff0c8", "#ff8a2a", "#4a0a00"],
      abjuration: ["Abjuration", "#e8f8ff", "#3a9aff", "#0a1a4a"],
      divination: ["Divination", "#ffffff", "#e8d07a", "#2a2050"],
      necromancy: ["Necromancy", "#e0ffe8", "#5adf9a", "#0a1a14"]
    })
  },

  arcforge: {
    label: "Arc Forge", icon: "fa-solid fa-screwdriver-wrench", blend: "add",
    styles: emitStyles([
      { tex: "smoke", mode: "emit", blend: "normal", rate: 4, life: [1.5, 2.5], radius: [1.0, 1.15], size: [0.12, 0.45], out: [0.08, 0.16], swirl: 0.15, colors: [[0, "#d8dce0", 0], [0.2, "#d8dce0", 0.22], [1, "#d8dce0", 0]] },
      { tex: "sparkle", mode: "emit", blend: "add", rate: 30, life: [0.1, 0.28], radius: [1.0, 1.12], size: [0.1, 0.015], out: [0.6, 1.2], flicker: 0.8, spin: 6, colors: RAMP.hot() },
      { tex: "glow", mode: "emit", blend: "add", rate: 60, group: 3, lead: 1.0, swirl: 0, life: [0.5, 0.8], radius: [1.3, 1.32], size: [0.08, 0.01], out: [0, 0], colors: RAMP.glow() }
    ], {
      alchemist: ["Alchemist", "#e8ffd0", "#7adf3a", "#2a3a10"],
      artillerist: ["Artillerist", "#ffe8c0", "#ff8a2a", "#3a1a08"],
      battlesmith: ["Battle Smith", "#ffffff", "#9ad8ff", "#1a3a5a"],
      armorer: ["Armorer", "#fff4d0", "#e8b84a", "#3a2a10"]
    })
  },

  celestialplumes: {
    label: "Celestial Plumes", icon: "fa-solid fa-feather", blend: "add",
    styles: emitStyles([
      { tex: "glow", mode: "emit", blend: "add", rate: 14, life: [1.5, 2.5], radius: [0.95, 1.1], size: [0.1, 0.22], out: [0.04, 0.1], colors: RAMP.main(0.18) },
      { tex: "petal", mode: "emit", blend: "normal", rate: 6, life: [2, 3.2], radius: [0.95, 1.15], size: [0.11, 0.08], out: [0.08, 0.16], swirl: 0.15, wobble: 0.15, spin: 1.0, colors: [[0, "bright", 0], [0.12, "bright", 0.95], [0.6, "main", 0.85], [1, "main", 0]] },
      { tex: "sparkle", mode: "emit", blend: "add", rate: 6, life: [1, 2], radius: [1.0, 1.35], size: [0.08, 0.015], out: [0.03, 0.08], flicker: 0.6, colors: RAMP.glow() }
    ], {
      radiantsoul: ["Radiant Soul", "#ffffff", "#ffe9a8", "#b08a3a"],
      radiantconsumption: ["Radiant Consumption", "#fff4e0", "#ffb05a", "#a0400a"],
      necroticshroud: ["Necrotic Shroud", "#e8e0f0", "#6a5a7a", "#1a1020"],
      protector: ["Protector", "#ffffff", "#bfe0ff", "#3a6aa8"]
    })
  },

  dragonbreath: {
    label: "Dragon's Breath", icon: "fa-solid fa-dragon", blend: "add",
    styles: emitStyles([
      { tex: "smoke", mode: "emit", blend: "add", rate: 14, group: 1, lead: 0.8, life: [0.6, 1.0], radius: [1.0, 1.05], size: [0.1, 0.45], out: [0.5, 0.9], colors: RAMP.hot(0.5) },
      { tex: "shard", mode: "emit", blend: "normal", rate: 5, life: [1.5, 2.5], radius: [1.0, 1.2], size: [0.12, 0.09], out: [0.03, 0.08], swirl: 0.2, colors: [[0, "main", 0], [0.15, "main", 0.9], [1, "dark", 0]] },
      { tex: "glow", mode: "emit", blend: "add", rate: 12, life: [0.8, 1.5], radius: [0.95, 1.15], size: [0.06, 0.015], out: [0.1, 0.3], wobble: 0.2, flicker: 0.4, colors: RAMP.hot() }
    ], {
      red: ["Red", "#ffe8a0", "#ff4a1a", "#5a0800"],
      blue: ["Blue", "#ffffff", "#6ac8ff", "#0a2a6a"],
      green: ["Green", "#e8ffb0", "#5ad84a", "#0a3a10"],
      gold: ["Gold", "#fff8d0", "#ffc83a", "#6a3a00"]
    })
  },

  stoneheart: {
    label: "Stoneheart", icon: "fa-solid fa-hammer", blend: "normal",
    styles: emitStyles([
      { tex: "smoke", mode: "emit", blend: "normal", rate: 5, life: [1.5, 2.5], radius: [0.95, 1.1], size: [0.15, 0.45], out: [0.05, 0.12], swirl: 0.1, colors: RAMP.dust(0.3) },
      { tex: "rock", mode: "emit", blend: "normal", rate: 5, life: [2.5, 3.5], radius: [1.15, 1.3], size: [0.1, 0.09], out: [0, 0.03], swirl: 0.25, spin: 0.8, colors: [[0, "main", 0], [0.1, "main", 1], [0.85, "main", 1], [1, "main", 0]] },
      { tex: "sparkle", mode: "emit", blend: "add", rate: 5, life: [0.6, 1.2], radius: [1.05, 1.35], size: [0.09, 0.015], out: [0, 0.04], flicker: 0.6, colors: RAMP.glow() }
    ], {
      mountain: ["Mountain", "#ffe8a0", "#8a8478", "#2a2620"],
      hill: ["Hill", "#fff0c0", "#a8784a", "#3a2410"],
      duergar: ["Duergar", "#e0c8ff", "#5a5460", "#0a080c"],
      gemcutter: ["Gemcutter", "#ffc0d8", "#7a6a70", "#2a1018"]
    })
  },

  feygrace: {
    label: "Fey Grace", icon: "fa-solid fa-moon", blend: "add",
    styles: emitStyles([
      { tex: "petal", mode: "emit", blend: "normal", rate: 3, life: [3, 4], radius: [1.0, 1.2], size: [0.08, 0.07], out: [0.04, 0.08], swirl: 0.2, wobble: 0.2, spin: 1, colors: RAMP.leaf(0.9) },
      { tex: "glow", mode: "emit", blend: "add", rate: 12, life: [3, 4.5], radius: [1.0, 1.4], size: [0.05, 0.02], out: [0, 0.04], swirl: 0.12, wobble: 0.3, flicker: 0.5, colors: RAMP.bright() },
      { tex: "sparkle", mode: "emit", blend: "add", rate: 6, life: [1.5, 2.5], radius: [1.0, 1.4], size: [0.08, 0.01], out: [0.02, 0.06], flicker: 0.7, spin: 1, colors: RAMP.glow() }
    ], {
      highelf: ["High Elf", "#ffffff", "#a8c8ff", "#2a3a6a"],
      woodelf: ["Wood Elf", "#f0ffd0", "#6ab84a", "#1a3a10"],
      drow: ["Drow", "#f0d0ff", "#b04aff", "#1a0a2a"],
      eladrin: ["Eladrin", "#fff0f6", "#ff8ac0", "#3a1a4a"]
    })
  },

  gnomishfizz: {
    label: "Gnomish Fizz", icon: "fa-solid fa-flask", blend: "add",
    styles: emitStyles([
      { tex: "bubble", mode: "emit", blend: "add", rate: 8, life: [1.8, 2.8], radius: [0.95, 1.2], size: [0.06, 0.12], out: [0.08, 0.16], wobble: 0.35, colors: RAMP.bright(0.9) },
      { tex: "sparkle", mode: "emit", blend: "add", rate: 10, life: [0.6, 1.2], radius: [1.0, 1.3], size: [0.07, 0.01], out: [0.1, 0.3], flicker: 0.5, spin: 3, colors: RAMP.mixed() },
      { tex: "glow", mode: "emit", blend: "add", rate: 8, life: [1, 2], radius: [1.0, 1.3], size: [0.04, 0.015], out: [0.03, 0.1], wobble: 0.3, flicker: 0.4, colors: RAMP.glow() }
    ], {
      rock: ["Rock", "#fff0c0", "#e8a04a", "#3a8ad8"],
      forest: ["Forest", "#f0ffd0", "#7adf5a", "#ff8a3a"],
      deep: ["Deep", "#e0f0ff", "#8aa0c0", "#4a4a7a"],
      illusion: ["Illusion", "#ffffff", "#ff7ad8", "#5ad8ff"]
    })
  },

  giantstride: {
    label: "Giant's Stride", icon: "fa-solid fa-mountain-sun", blend: "normal",
    styles: emitStyles([
      { tex: "smoke", mode: "emit", blend: "normal", rate: 10, life: [1, 1.6], radius: [1.0, 1.1], size: [0.15, 0.5], out: [0.2, 0.35], colors: RAMP.dust(0.55) },
      { tex: "rock", mode: "emit", blend: "normal", rate: 4, life: [0.8, 1.4], radius: [1.0, 1.1], size: [0.09, 0.06], out: [0.3, 0.5], spin: 2, colors: [[0, "main", 0], [0.1, "main", 1], [0.8, "main", 1], [1, "main", 0]] },
      { tex: "glow", mode: "emit", blend: "add", rate: 10, life: [1.5, 2.5], radius: [1.0, 1.3], size: [0.05, 0.02], out: [0.03, 0.08], wobble: 0.2, flicker: 0.3, colors: RAMP.bright() }
    ], {
      stone: ["Stone", "#fff0d0", "#9a9488", "#3a3630"],
      frost: ["Frost", "#ffffff", "#b8dcf0", "#3a6a8a"],
      fire: ["Fire", "#ffe0a0", "#a86a4a", "#3a1408"],
      storm: ["Storm", "#e8f8ff", "#8a9ab0", "#1a2a4a"]
    })
  },

  luckystars: {
    label: "Lucky Stars", icon: "fa-solid fa-clover", blend: "add",
    styles: emitStyles([
      { tex: "leaf", mode: "emit", blend: "normal", rate: 2.5, life: [2.5, 3.5], radius: [1.0, 1.2], size: [0.09, 0.08], out: [0.05, 0.1], swirl: 0.2, wobble: 0.2, spin: 1.2, colors: RAMP.leaf(0.85) },
      { tex: "sparkle", mode: "emit", blend: "add", rate: 11, life: [1, 2], radius: [1.0, 1.35], size: [0.09, 0.02], out: [0.03, 0.08], flicker: 0.6, spin: 1.5, colors: RAMP.bright() },
      { tex: "glow", mode: "emit", blend: "add", rate: 40, group: 1, lead: 1.2, life: [0.4, 0.7], radius: [1.25, 1.28], size: [0.06, 0], out: [0, 0], colors: RAMP.bright() }
    ], {
      lightfoot: ["Lightfoot", "#fffbe0", "#8ad85a", "#2a4a10"],
      stout: ["Stout", "#ffe8c0", "#c8904a", "#3a2010"],
      ghostwise: ["Ghostwise", "#f0f0ff", "#9ab0c8", "#2a3040"],
      lotusden: ["Lotusden", "#fff0ff", "#d88ad8", "#2a1a3a"]
    })
  },

  heroicinspiration: {
    label: "Heroic Inspiration", icon: "fa-solid fa-flag", blend: "add",
    styles: emitStyles([
      { tex: "glow", mode: "emit", blend: "add", rate: 14, life: [1, 1.8], radius: [0.95, 1.1], size: [0.06, 0.015], out: [0.15, 0.3], swirl: 0.25, colors: RAMP.hot() },
      { tex: "glow", mode: "emit", blend: "add", rate: 55, group: 2, lead: 1.0, life: [0.5, 0.9], radius: [1.2, 1.25], size: [0.065, 0], out: [0, 0], colors: RAMP.glow() },
      { tex: "sparkle", mode: "emit", blend: "add", rate: 4, life: [0.8, 1.5], radius: [1.0, 1.35], size: [0.09, 0.015], out: [0.02, 0.06], flicker: 0.6, colors: RAMP.glow() }
    ], {
      valiant: ["Valiant", "#fff8d0", "#ffc84a", "#6a3a00"],
      noble: ["Noble", "#f8e8ff", "#b07aff", "#2a0a4a"],
      wanderer: ["Wanderer", "#e8fff8", "#4ad8c0", "#0a3a3a"],
      steadfast: ["Steadfast", "#ffffff", "#7aa8ff", "#0a1a4a"]
    })
  },

  adrenaline: {
    label: "Adrenaline Rush", icon: "fa-solid fa-hand-fist", blend: "add",
    styles: emitStyles([
      { tex: "smoke", mode: "emit", blend: "add", rate: 8, life: [0.8, 1.4], radius: [0.95, 1.1], size: [0.2, 0.5], out: [0.15, 0.3], colors: RAMP.main(0.25) },
      { tex: "glow", mode: "emit", blend: "add", rate: 40, life: [0.3, 0.5], radius: [1.5, 1.7], size: [0.04, 0.08], out: [-0.6, -0.4], swirl: 0.1, colors: RAMP.bright() },
      { tex: "glow", mode: "emit", blend: "add", rate: 16, life: [0.5, 1.0], radius: [0.95, 1.1], size: [0.06, 0.015], out: [0.3, 0.6], flicker: 0.4, colors: RAMP.hot() }
    ], {
      bloodrage: ["Bloodrage", "#ffd0c0", "#e0201a", "#3a0202"],
      greytusk: ["Grey Tusk", "#e8eef0", "#8a9098", "#202428"],
      ashlands: ["Ashlands", "#ffe0a0", "#ff7a1a", "#2a1a10"],
      jade: ["Jade", "#e0ffd0", "#5ad86a", "#0a2a10"]
    })
  },

  hellishlegacy: {
    label: "Hellish Legacy", icon: "fa-solid fa-burst", blend: "add",
    styles: emitStyles([
      { tex: "smoke", mode: "emit", blend: "normal", rate: 8, life: [1.5, 2.3], radius: [0.95, 1.1], size: [0.15, 0.5], out: [0.06, 0.14], swirl: 0.2, colors: RAMP.shade(0.6) },
      { tex: "glow", mode: "emit", blend: "add", rate: 26, life: [0.5, 1.0], radius: [0.95, 1.1], size: [0.08, 0.02], out: [0.1, 0.25], swirl: -0.25, wobble: 0.3, colors: RAMP.hot() },
      { tex: "shard", mode: "emit", blend: "add", rate: 3, life: [0.8, 1.3], radius: [1.0, 1.1], size: [0.1, 0.04], out: [0.05, 0.1], colors: RAMP.glow() }
    ], {
      infernal: ["Infernal", "#ffd8a0", "#ff3a1a", "#1a0202"],
      abyssal: ["Abyssal", "#e8ffb0", "#7adf2a", "#1a0a1a"],
      chthonic: ["Chthonic", "#e0f0e8", "#5ab8a0", "#050a0a"],
      zariel: ["Zariel", "#fff0c0", "#ffa02a", "#2a0a0a"]
    })
  },

  twinheritage: {
    label: "Twin Heritage", icon: "fa-solid fa-circle-half-stroke", blend: "add",
    styles: emitStyles([
      { tex: "glow", mode: "emit", blend: "add", rate: 70, group: 1, lead: 1.3, life: [0.5, 0.9], radius: [1.2, 1.24], size: [0.07, 0], out: [0, 0], colors: RAMP.bright() },
      { tex: "glow", mode: "emit", blend: "add", rate: 70, group: 1, lead: -1.3, life: [0.5, 0.9], radius: [1.32, 1.36], size: [0.075, 0], out: [0, 0], colors: [[0, "main", 0], [0.1, "main", 1], [0.6, "main", 0.75], [1, "dark", 0]] },
      { tex: "sparkle", mode: "emit", blend: "add", rate: 5, life: [1, 2], radius: [1.0, 1.4], size: [0.08, 0.01], out: [0.02, 0.06], flicker: 0.6, colors: RAMP.mixed() }
    ], {
      dawn: ["Dawn", "#ffffff", "#ffb04a", "#6a2a00"],
      dusk: ["Dusk", "#e0e8ff", "#9a5aff", "#1a0a3a"],
      sylvan: ["Sylvan", "#f0fff0", "#5ad87a", "#0a3a1a"],
      mariner: ["Mariner", "#f0ffff", "#3ab8e8", "#0a2a4a"]
    })
  },

  relentless: {
    label: "Relentless", icon: "fa-solid fa-shield-heart", blend: "add",
    styles: emitStyles([
      { tex: "smoke", mode: "emit", blend: "normal", rate: 7, life: [1.2, 2], radius: [0.95, 1.1], size: [0.15, 0.45], out: [0.1, 0.2], colors: RAMP.shade(0.5) },
      { tex: "shard", mode: "emit", blend: "add", rate: 7, life: [0.6, 1.0], radius: [1.0, 1.05], size: [0.16, 0.07], out: [0.2, 0.35], colors: RAMP.glow() },
      { tex: "glow", mode: "emit", blend: "add", rate: 22, life: [0.6, 1.2], radius: [0.95, 1.1], size: [0.07, 0.015], out: [0.1, 0.3], flicker: 0.4, colors: RAMP.hot() }
    ], {
      iron: ["Iron", "#ffffff", "#a8b0b8", "#2a2e34"],
      blood: ["Blood", "#ffc0b0", "#c0181a", "#2a0202"],
      ash: ["Ash", "#ffe8c0", "#e07a2a", "#2a1a10"],
      moss: ["Moss", "#e8ffc0", "#6aa84a", "#1a2a10"]
    })
  },

  votiveglow: {
    label: "Votive Glow", icon: "fa-solid fa-place-of-worship", blend: "add",
    styles: emitStyles([
      { tex: "smoke", mode: "emit", blend: "normal", rate: 4, life: [2.5, 3.5], radius: [1.1, 1.25], size: [0.1, 0.4], out: [0.06, 0.12], swirl: 0.12, colors: [[0, "#d8d4cc", 0], [0.2, "#d8d4cc", 0.22], [1, "#d8d4cc", 0]] },
      { tex: "glow", mode: "emit", blend: "add", rate: 70, group: 5, lead: 0.2, swirl: 0, life: [0.25, 0.5], radius: [1.22, 1.25], size: [0.08, 0.02], out: [0, 0.03], flicker: 0.35, colors: RAMP.hot() },
      { tex: "sparkle", mode: "emit", blend: "add", rate: 3, life: [1, 2], radius: [1.0, 1.35], size: [0.07, 0.01], out: [0.02, 0.05], flicker: 0.6, colors: RAMP.glow() }
    ], {
      temple: ["Temple", "#fff4c0", "#ffb84a", "#6a3000"],
      moonshrine: ["Moon Shrine", "#ffffff", "#b8d0ff", "#2a3a6a"],
      groveshrine: ["Grove Shrine", "#f0ffd0", "#8ad85a", "#1a3a10"],
      shadowshrine: ["Shadow Shrine", "#f0d8ff", "#a05aff", "#1a0a2a"]
    })
  },

  makersmark: {
    label: "Maker's Mark", icon: "fa-solid fa-palette", blend: "add",
    styles: emitStyles([
      { tex: "rock", mode: "emit", blend: "normal", rate: 9, life: [0.6, 1.1], radius: [1.0, 1.1], size: [0.07, 0.05], out: [0.3, 0.6], spin: 3, colors: [[0, "main", 0], [0.1, "main", 1], [0.8, "main", 1], [1, "main", 0]] },
      { tex: "sparkle", mode: "emit", blend: "add", rate: 16, life: [0.15, 0.4], radius: [1.0, 1.1], size: [0.1, 0.01], out: [0.4, 0.9], spin: 4, colors: RAMP.hot() },
      { tex: "sparkle", mode: "emit", blend: "add", rate: 3, life: [0.6, 1.2], radius: [1.05, 1.35], size: [0.1, 0.02], out: [0, 0.03], flicker: 0.7, colors: RAMP.glow() }
    ], {
      smith: ["Smith", "#ffe8b0", "#ff8a2a", "#3a1a08"],
      carpenter: ["Carpenter", "#fff0c8", "#c8904a", "#3a2410"],
      jeweler: ["Jeweler", "#fff0f8", "#ff6ab8", "#3a0a2a"],
      glassblower: ["Glassblower", "#f0ffff", "#5ad8e8", "#0a3a4a"]
    })
  },

  sleightofhand: {
    label: "Sleight of Hand", icon: "fa-solid fa-masks-theater", blend: "add",
    styles: emitStyles([
      { tex: "card", mode: "emit", blend: "normal", rate: 18, group: 3, lead: 1.1, swirl: 0, life: [0.4, 0.7], radius: [1.28, 1.3], size: [0.13, 0.12], out: [0, 0], spin: 0.5, colors: [[0, "bright", 0], [0.15, "bright", 0.95], [0.7, "main", 0.7], [1, "main", 0]] },
      { tex: "glow", mode: "emit", blend: "add", rate: 60, group: 3, lead: 1.1, swirl: 0.05, life: [0.3, 0.6], radius: [1.26, 1.32], size: [0.04, 0], out: [0, 0], colors: RAMP.glow(0.8) },
      { tex: "sparkle", mode: "emit", blend: "add", rate: 6, life: [0.6, 1.2], radius: [1.0, 1.4], size: [0.07, 0.01], out: [0.02, 0.06], flicker: 0.7, spin: 2, colors: RAMP.glow() }
    ], {
      hearts: ["Hearts", "#ffffff", "#e0283a", "#3a0208"],
      spades: ["Spades", "#ffffff", "#5a6070", "#0a0c10"],
      gilded: ["Gilded", "#fff8d0", "#e8b84a", "#3a2608"],
      illusory: ["Illusory", "#f8e8ff", "#b46aff", "#1a0a3a"]
    })
  },

  alleysmoke: {
    label: "Alley Smoke", icon: "fa-solid fa-user-secret", blend: "normal",
    styles: emitStyles([
      { tex: "smoke", mode: "emit", blend: "normal", rate: 12, life: [1.8, 2.8], radius: [0.95, 1.15], size: [0.18, 0.55], out: [0.04, 0.1], swirl: 0.18, colors: RAMP.shade(0.7) },
      { tex: "glow", mode: "emit", blend: "add", rate: 30, group: 2, lead: 0.25, swirl: 0, life: [0.3, 0.5], radius: [1.3, 1.3], size: [0.045, 0.02], out: [0, 0], flicker: 0.5, colors: RAMP.bright() },
      { tex: "sparkle", mode: "emit", blend: "add", rate: 1.5, life: [0.3, 0.5], radius: [1.0, 1.3], size: [0.12, 0.02], out: [0, 0.02], colors: RAMP.glow() }
    ], {
      burglar: ["Burglar", "#e8eef4", "#4a5058", "#08090c"],
      smuggler: ["Smuggler", "#ffe0b0", "#8a6a4a", "#0c0806"],
      fence: ["Fence", "#e0ffe0", "#4a8a5a", "#040a06"],
      enforcer: ["Enforcer", "#ffd0c8", "#a02a2a", "#0a0204"]
    })
  },

  showstopper: {
    label: "Showstopper", icon: "fa-solid fa-drum", blend: "add",
    styles: emitStyles([
      { tex: "note", mode: "emit", blend: "normal", rate: 6, life: [2, 3], radius: [1.0, 1.2], size: [0.13, 0.11], out: [0.08, 0.15], swirl: 0.3, wobble: 0.2, colors: [[0, "main", 0], [0.12, "main", 1], [0.7, "main", 0.9], [1, "dark", 0]] },
      { tex: "sparkle", mode: "emit", blend: "add", rate: 12, life: [0.6, 1.2], radius: [1.0, 1.3], size: [0.07, 0.01], out: [0.1, 0.3], swirl: 0.3, flicker: 0.5, spin: 3, colors: RAMP.mixed() },
      { tex: "glow", mode: "emit", blend: "add", rate: 6, life: [1, 2], radius: [1.0, 1.3], size: [0.05, 0.02], out: [0.03, 0.08], wobble: 0.3, colors: RAMP.glow() }
    ], {
      minstrel: ["Minstrel", "#fff8d0", "#ffc84a", "#5a3000"],
      dancer: ["Dancer", "#fff0f6", "#ff6aa8", "#4a0a2a"],
      jester: ["Jester", "#ffffff", "#ff5a3a", "#3a8aff"],
      torchlight: ["Torchlight", "#ffe8c0", "#ff8a2a", "#4a1000"]
    })
  },

  harvestbreeze: {
    label: "Harvest Breeze", icon: "fa-solid fa-wheat-awn", blend: "add",
    styles: emitStyles([
      { tex: "smoke", mode: "emit", blend: "normal", rate: 3, life: [1.5, 2.5], radius: [1.0, 1.1], size: [0.15, 0.4], out: [0.05, 0.1], swirl: 0.4, colors: [[0, "#c8b890", 0], [0.2, "#c8b890", 0.2], [1, "#c8b890", 0]] },
      { tex: "petal", mode: "emit", blend: "normal", rate: 9, life: [2, 3], radius: [1.0, 1.2], size: [0.09, 0.08], out: [0.05, 0.1], swirl: 0.55, wobble: 0.2, spin: 2, colors: RAMP.leaf(0.9) },
      { tex: "glow", mode: "emit", blend: "add", rate: 8, life: [2, 3], radius: [1.0, 1.35], size: [0.035, 0.02], out: [0.02, 0.06], swirl: 0.45, wobble: 0.3, colors: RAMP.bright(0.8) }
    ], {
      wheat: ["Wheat", "#fff4c0", "#e0b850", "#4a3010"],
      orchard: ["Orchard", "#fff0f0", "#ff8a9a", "#3a1a10"],
      vineyard: ["Vineyard", "#f8e8ff", "#8a4ab8", "#2a1030"],
      pumpkinpatch: ["Pumpkin Patch", "#fff0c0", "#ff8a1a", "#2a3a10"]
    })
  },

  lanternwatch: {
    label: "Lantern Watch", icon: "fa-solid fa-tower-observation", blend: "add",
    styles: emitStyles([
      { tex: "glow", mode: "emit", blend: "add", rate: 60, group: 1, lead: 0.6, swirl: 0, life: [0.6, 1.0], radius: [1.05, 1.15], size: [0.12, 0.3], out: [0.25, 0.4], colors: RAMP.main(0.28) },
      { tex: "glow", mode: "emit", blend: "add", rate: 50, group: 1, lead: 0.6, swirl: 0, life: [0.4, 0.7], radius: [1.2, 1.24], size: [0.07, 0.02], out: [0, 0], colors: RAMP.glow() },
      { tex: "sparkle", mode: "emit", blend: "add", rate: 4, life: [1.5, 2.5], radius: [1.05, 1.4], size: [0.07, 0.015], out: [0, 0.02], flicker: 0.3, colors: RAMP.glow() }
    ], {
      citywatch: ["City Watch", "#fff4d0", "#ffb84a", "#4a2a00"],
      gateward: ["Gate Ward", "#ffffff", "#9ab8d8", "#1a2a3a"],
      templeguard: ["Temple Guard", "#fffbe0", "#ffd84a", "#5a4000"],
      nightwatch: ["Night Watch", "#e8ffff", "#4ad8d8", "#0a2a3a"]
    })
  },

  waypoint: {
    label: "Waypoint", icon: "fa-solid fa-compass", blend: "add",
    styles: emitStyles([
      { tex: "sparkle", mode: "emit", blend: "add", rate: 16, group: 4, lead: 0.15, swirl: 0, life: [0.6, 1.0], radius: [1.15, 1.2], size: [0.1, 0.02], out: [0.2, 0.35], colors: RAMP.glow() },
      { tex: "glow", mode: "emit", blend: "add", rate: 40, group: 4, lead: 0.15, swirl: 0, life: [0.4, 0.7], radius: [1.15, 1.18], size: [0.06, 0.02], out: [0, 0], colors: RAMP.bright() },
      { tex: "glow", mode: "emit", blend: "add", rate: 6, life: [2, 3.5], radius: [1.0, 1.45], size: [0.04, 0.015], out: [0, 0.04], wobble: 0.3, flicker: 0.4, colors: RAMP.bright(0.8) }
    ], {
      northstar: ["North Star", "#ffffff", "#9ac8ff", "#1a2a5a"],
      forestpath: ["Forest Path", "#f0ffd0", "#7ac85a", "#1a3a10"],
      desertroad: ["Desert Road", "#fff4d0", "#e8a84a", "#4a2a08"],
      mountainpass: ["Mountain Pass", "#ffffff", "#b8c0c8", "#3a4048"]
    })
  },

  stillmind: {
    label: "Still Mind", icon: "fa-solid fa-person-praying", blend: "add",
    styles: emitStyles([
      { tex: "smoke", mode: "emit", blend: "add", rate: 4, life: [3, 4], radius: [1.05, 1.25], size: [0.25, 0.5], out: [-0.04, 0.02], swirl: 0.08, colors: RAMP.main(0.18) },
      { tex: "glow", mode: "emit", blend: "add", rate: 9, life: [3, 4.5], radius: [1.5, 1.7], size: [0.04, 0.08], out: [-0.12, -0.08], swirl: 0.06, wobble: 0.15, flicker: 0.3, colors: RAMP.bright() }
    ], {
      cave: ["Cave", "#fff0c8", "#d8a050", "#2a1a08"],
      grove: ["Grove", "#f0ffe0", "#7ac87a", "#0a2a14"],
      mountain: ["Mountain", "#ffffff", "#c8d8e8", "#3a4a5a"],
      bog: ["Bog", "#e8f0c0", "#8a9a4a", "#1a2008"]
    })
  },

  coinshower: {
    label: "Coin Shower", icon: "fa-solid fa-coins", blend: "normal",
    styles: emitStyles([
      { tex: "coin", mode: "emit", blend: "normal", rate: 8, life: [1.2, 2], radius: [1.0, 1.15], size: [0.1, 0.09], out: [0.12, 0.25], swirl: 0.2, spin: 3, colors: [[0, "main", 0], [0.1, "main", 1], [0.75, "main", 1], [1, "main", 0]] },
      { tex: "sparkle", mode: "emit", blend: "add", rate: 12, life: [0.5, 1], radius: [1.0, 1.35], size: [0.09, 0.015], out: [0.05, 0.15], flicker: 0.6, spin: 2, colors: RAMP.glow() }
    ], {
      gold: ["Gold", "#fff8c8", "#e8b83a", "#5a3a00"],
      silver: ["Silver", "#ffffff", "#c0c8d0", "#3a4048"],
      copper: ["Copper", "#ffe0c0", "#c8743a", "#3a1a08"],
      platinum: ["Platinum", "#ffffff", "#d8e8f0", "#5a6a7a"]
    })
  },

  regalbearing: {
    label: "Regal Bearing", icon: "fa-solid fa-crown", blend: "add",
    styles: emitStyles([
      { tex: "petal", mode: "emit", blend: "normal", rate: 4, life: [2.5, 3.5], radius: [1.0, 1.2], size: [0.09, 0.07], out: [0.05, 0.1], swirl: 0.15, wobble: 0.2, spin: 1.2, colors: RAMP.leaf(0.9) },
      { tex: "glow", mode: "emit", blend: "add", rate: 50, group: 2, lead: 0.7, life: [0.5, 0.8], radius: [1.24, 1.27], size: [0.06, 0], out: [0, 0], colors: RAMP.bright() },
      { tex: "sparkle", mode: "emit", blend: "add", rate: 7, life: [1, 2], radius: [1.0, 1.35], size: [0.08, 0.015], out: [0.02, 0.06], flicker: 0.6, colors: RAMP.bright() }
    ], {
      royal: ["Royal", "#fff4d0", "#8a3ad8", "#1a0a3a"],
      crimsoncourt: ["Crimson Court", "#fff0d0", "#c0182a", "#3a0208"],
      sapphire: ["Sapphire", "#f0f8ff", "#2a6ad8", "#0a1a4a"],
      emerald: ["Emerald", "#fff8d0", "#1aa85a", "#062a14"]
    })
  },

  inklore: {
    label: "Ink & Lore", icon: "fa-solid fa-scroll", blend: "normal",
    styles: emitStyles([
      { tex: "smoke", mode: "emit", blend: "normal", rate: 9, life: [1.5, 2.5], radius: [1.0, 1.15], size: [0.08, 0.3], out: [0.05, 0.12], swirl: 0.35, wobble: 0.2, colors: RAMP.shade(0.65) },
      { tex: "glow", mode: "emit", blend: "add", rate: 10, life: [2, 3], radius: [1.0, 1.4], size: [0.045, 0.015], out: [0.01, 0.05], swirl: 0.15, wobble: 0.25, flicker: 0.4, colors: RAMP.bright() },
      { tex: "sparkle", mode: "emit", blend: "add", rate: 3, life: [1, 2], radius: [1.05, 1.4], size: [0.08, 0.01], out: [0.02, 0.05], flicker: 0.7, colors: RAMP.glow() }
    ], {
      ink: ["Ink", "#d8e8ff", "#3a5aa8", "#06081a"],
      gildedpage: ["Gilded Page", "#fff8d0", "#d8b04a", "#1a1408"],
      verdigris: ["Verdigris", "#e0fff4", "#3ab890", "#04140e"],
      crimsonink: ["Crimson Ink", "#ffe0d8", "#c03a3a", "#140404"]
    })
  },

  seaspray: {
    label: "Sea Spray", icon: "fa-solid fa-anchor", blend: "add",
    styles: emitStyles([
      { tex: "smoke", mode: "emit", blend: "add", rate: 8, life: [1, 1.8], radius: [1.0, 1.1], size: [0.15, 0.45], out: [0.15, 0.3], swirl: 0.25, colors: RAMP.bright(0.26) },
      { tex: "glow", mode: "emit", blend: "add", rate: 22, life: [0.4, 0.8], radius: [1.0, 1.1], size: [0.035, 0.01], out: [0.4, 0.8], swirl: 0.25, colors: RAMP.bright() },
      { tex: "bubble", mode: "emit", blend: "add", rate: 5, life: [1.5, 2.5], radius: [1.0, 1.25], size: [0.04, 0.08], out: [0.05, 0.12], wobble: 0.3, colors: RAMP.bright(0.85) }
    ], {
      opensea: ["Open Sea", "#f0ffff", "#5ab8e8", "#0a2a4a"],
      tropical: ["Tropical", "#f0fff8", "#3ae0c8", "#04404a"],
      stormswell: ["Storm Swell", "#e8eef4", "#7a8a9a", "#1a2028"],
      ghostship: ["Ghost Ship", "#e8fff0", "#7ae8b0", "#0a2a1a"]
    })
  },

  quillwork: {
    label: "Quillwork", icon: "fa-solid fa-feather-pointed", blend: "normal",
    styles: emitStyles([
      { tex: "card", mode: "emit", blend: "normal", rate: 3, life: [2, 3], radius: [1.0, 1.2], size: [0.1, 0.09], out: [0.05, 0.1], swirl: 0.25, wobble: 0.15, spin: 1.2, colors: [[0, "main", 0], [0.12, "main", 1], [0.75, "main", 0.9], [1, "main", 0]] },
      { tex: "petal", mode: "emit", blend: "normal", rate: 2, life: [2.5, 3.5], radius: [1.0, 1.2], size: [0.1, 0.09], out: [0.04, 0.08], swirl: 0.2, wobble: 0.25, spin: 1, colors: [[0, "bright", 0], [0.12, "bright", 0.95], [1, "main", 0]] },
      { tex: "glow", mode: "emit", blend: "normal", rate: 6, life: [0.8, 1.4], radius: [1.0, 1.3], size: [0.035, 0.02], out: [0.02, 0.06], colors: [[0, "dark", 0], [0.1, "dark", 0.9], [1, "dark", 0]] }
    ], {
      parchment: ["Parchment", "#fff8e8", "#e8d8b0", "#3a3020"],
      vellum: ["Vellum", "#ffffff", "#f0ece0", "#5a5040"],
      illuminated: ["Illuminated", "#fff8d0", "#e8c050", "#3a2a08"],
      midnightoil: ["Midnight Oil", "#f0e8ff", "#8a7ab8", "#100a20"]
    })
  },

  veteransmarch: {
    label: "Veteran's March", icon: "fa-solid fa-chess-knight", blend: "add",
    styles: emitStyles([
      { tex: "smoke", mode: "emit", blend: "normal", rate: 7, life: [1.2, 2], radius: [1.0, 1.1], size: [0.15, 0.5], out: [0.12, 0.25], colors: [[0, "#a89880", 0], [0.2, "#a89880", 0.35], [1, "#a89880", 0]] },
      { tex: "glow", mode: "emit", blend: "add", rate: 45, group: 2, lead: 0.9, life: [0.4, 0.7], radius: [1.22, 1.26], size: [0.06, 0], out: [0, 0], colors: RAMP.glow() },
      { tex: "glow", mode: "emit", blend: "add", rate: 12, life: [0.8, 1.6], radius: [0.95, 1.15], size: [0.05, 0.015], out: [0.1, 0.25], flicker: 0.4, colors: RAMP.hot() }
    ], {
      legion: ["Legion", "#ffe0c0", "#c0302a", "#2a0804"],
      mercenary: ["Mercenary", "#ffffff", "#a8b0b8", "#2a2e34"],
      cavalry: ["Cavalry", "#fff0d0", "#a87a4a", "#2a1a0a"],
      siege: ["Siege", "#ffe8b0", "#ff7a1a", "#2a1408"]
    })
  },

  wanderlust: {
    label: "Wanderlust", icon: "fa-solid fa-route", blend: "normal",
    styles: emitStyles([
      { tex: "smoke", mode: "emit", blend: "normal", rate: 4, life: [1, 1.6], radius: [1.0, 1.1], size: [0.12, 0.4], out: [0.05, 0.12], swirl: 0.7, colors: [[0, "#b8b0a0", 0], [0.2, "#b8b0a0", 0.32], [1, "#b8b0a0", 0]] },
      { tex: "leaf", mode: "emit", blend: "normal", rate: 10, life: [1.2, 2], radius: [1.05, 1.25], size: [0.1, 0.09], out: [0.03, 0.08], swirl: 0.85, wobble: 0.2, spin: 3, colors: RAMP.leaf(0.9) },
      { tex: "glow", mode: "emit", blend: "add", rate: 30, life: [0.4, 0.8], radius: [1.15, 1.35], size: [0.045, 0.01], out: [0, 0.03], swirl: 0.9, colors: RAMP.bright(0.7) }
    ], {
      spring: ["Spring", "#f0ffd0", "#7ad85a", "#1a3a10"],
      autumn: ["Autumn", "#ffe0a0", "#e07a2a", "#3a1a08"],
      duskroad: ["Dusk Road", "#ffe0f0", "#b06aa8", "#2a1028"],
      winterroad: ["Winter Road", "#ffffff", "#c8dcec", "#3a4a5a"]
    })
  },

  hearthfire: {
    label: "Hearthfire", icon: "fa-solid fa-fire-burner", blend: "add",
    styles: emitStyles([
      { tex: "glow", mode: "emit", blend: "add", rate: 22, life: [1, 1.8], radius: [0.95, 1.1], size: [0.06, 0.015], out: [0.12, 0.28], wobble: 0.25, flicker: 0.4, colors: RAMP.hot() },
      { tex: "smoke", mode: "emit", blend: "normal", rate: 3, life: [1.8, 2.6], radius: [1.0, 1.1], size: [0.12, 0.45], out: [0.08, 0.15], swirl: 0.1, colors: RAMP.shade(0.35) },
      { tex: "glow", mode: "emit", blend: "add", rate: 60, group: 1, lead: 1.0, life: [0.5, 0.9], radius: [1.28, 1.3], size: [0.07, 0], out: [0, 0], colors: RAMP.glow() }
    ], {
      hearth: ["Hearth", "#ffe8b0", "#ff8a2a", "#5a1000"],
      harvestmoon: ["Harvest Moon", "#fff4d0", "#ffc04a", "#5a2a00"],
      blueflame: ["Blue Flame", "#e8f8ff", "#4aa8ff", "#0a1a5a"],
      bonfire: ["Bonfire", "#fff0c0", "#ff5a1a", "#3a0400"]
    })
  },

  starlitcamp: {
    label: "Starlit Camp", icon: "fa-solid fa-campground", blend: "add",
    styles: emitStyles([
      { tex: "sparkle", mode: "emit", blend: "add", rate: 9, life: [2, 3.5], radius: [1.15, 1.5], size: [0.07, 0.02], out: [0, 0.02], swirl: 0.06, flicker: 0.7, colors: [[0, "#ffffff", 0], [0.2, "bright", 0.95], [0.8, "bright", 0.7], [1, "bright", 0]] },
      { tex: "glow", mode: "emit", blend: "add", rate: 14, life: [0.8, 1.5], radius: [0.95, 1.1], size: [0.05, 0.015], out: [0.1, 0.3], wobble: 0.3, flicker: 0.4, colors: RAMP.hot() }
    ], {
      tundra: ["Tundra", "#ffffff", "#9ad8ff", "#1a3a5a"],
      steppe: ["Steppe", "#fff4d0", "#e8a84a", "#3a2008"],
      jungle: ["Jungle", "#f0ffd0", "#5ad86a", "#0a2a10"],
      badlands: ["Badlands", "#ffe0c0", "#e0603a", "#2a0a04"]
    })
  },

  streetscraps: {
    label: "Street Scraps", icon: "fa-solid fa-newspaper", blend: "normal",
    styles: emitStyles([
      { tex: "card", mode: "emit", blend: "normal", rate: 7, life: [1.5, 2.5], radius: [1.05, 1.25], size: [0.1, 0.09], out: [0.02, 0.06], swirl: 0.6, wobble: 0.3, spin: 3, colors: [[0, "main", 0], [0.12, "main", 0.95], [0.8, "main", 0.85], [1, "main", 0]] },
      { tex: "smoke", mode: "emit", blend: "normal", rate: 5, life: [1, 1.8], radius: [1.0, 1.15], size: [0.12, 0.4], out: [0.03, 0.08], swirl: 0.6, colors: RAMP.shade(0.45) },
      { tex: "rock", mode: "emit", blend: "normal", rate: 6, life: [0.8, 1.4], radius: [1.05, 1.25], size: [0.035, 0.03], out: [0.02, 0.06], swirl: 0.7, spin: 4, colors: [[0, "dark", 0], [0.1, "dark", 1], [1, "dark", 0]] }
    ], {
      alley: ["Alley", "#f0ece0", "#a8a090", "#2a2820"],
      market: ["Market", "#fff0d0", "#d8a85a", "#3a2410"],
      dockside: ["Dockside", "#e8f4f8", "#7a9aa8", "#1a2a30"],
      sewer: ["Sewer", "#e8f0c8", "#7a8a4a", "#141a08"]
    })
  }
};

/**
 * How the window groups designs in its dropdown: id -> [lang key, design ids]. Designs not listed in
 * a category land in "general"; the user's own image is its own group at the end.
 */
export const DESIGN_CATEGORIES = {
  classes: ["DXLT.Category.Classes", ["rage", "encore", "radiance", "wildbloom", "steelsparks", "kiflow", "holyaura",
    "huntertrail", "shadowstep", "wildsurge", "eldritch", "spellweave", "arcforge"]],
  species: ["DXLT.Category.Species", ["celestialplumes", "dragonbreath", "stoneheart", "feygrace", "gnomishfizz",
    "giantstride", "luckystars", "heroicinspiration", "adrenaline", "hellishlegacy", "twinheritage", "relentless"]],
  backgrounds: ["DXLT.Category.Backgrounds", ["votiveglow", "makersmark", "sleightofhand", "alleysmoke", "showstopper",
    "harvestbreeze", "lanternwatch", "waypoint", "stillmind", "coinshower", "regalbearing", "inklore", "seaspray",
    "quillwork", "veteransmarch", "wanderlust", "hearthfire", "starlitcamp", "streetscraps"]]
};

/** The design id of a layer that shows the user's own image. */
export const CUSTOM = "custom";
export const MAX_LAYERS = 20;

/**
 * How a custom image moves. mode/radius/speed/spin feed the Swarm, size and count are the defaults
 * the window switches to when the motion is chosen; `single` motions show one copy of the image.
 */
export const MOTIONS = {
  center:  { label: "DXLT.Motion.Center",  mode: "spinner", radius: [0, 0], speed: 0, size: 1.3, count: 1, single: true },
  spin:    { label: "DXLT.Motion.Spin",    mode: "spinner", radius: [0, 0], speed: 0.6, size: 1.3, count: 1, single: true },
  orbit:   { label: "DXLT.Motion.Orbit",   mode: "orbit",   radius: [1.15, 1.25], speed: 0.6, size: 0.22, count: 6 },
  wander:  { label: "DXLT.Motion.Wander",  mode: "wander",  radius: [1.05, 1.45], speed: 0.3, size: 0.16, count: 8 },
  rise:    { label: "DXLT.Motion.Rise",    mode: "rise",    radius: [1.0, 1.15],  speed: 0.4, size: 0.12, count: 10 },
  flutter: { label: "DXLT.Motion.Flutter", mode: "flutter", radius: [1.05, 1.5],  speed: 0.4, size: 0.16, count: 10 },
  puff:    { label: "DXLT.Motion.Puff",    mode: "puff",    radius: [1.05, 1.3],  speed: 0.3, size: 0.4, count: 8, spin: 0.3 },
  inward:  { label: "DXLT.Motion.Inward",  mode: "inward",  radius: [1.02, 1.5],  speed: 1.2, size: 0.3, count: 6 }
};
export const COLOR_MODES = ["original", "tint", "colorize", "hue"];

/** Fields every layer has (fine-tuning and effects). */
export const LAYER_DEFAULTS = {
  design: "glyphs", style: "arcane", scale: 1, speed: 1, alpha: 1, density: 1, color: null,
  glow: 0, pulse: 0, rainbow: 0, spin: 0
};
/** Extra fields of a custom image layer. */
export const CUSTOM_DEFAULTS = { src: "", motion: "center", count: 1, size: 1.3, blend: "normal", colorMode: "original", hue: 0 };
export const DEFAULTS = LAYER_DEFAULTS;

const RANGES = [
  ["scale", 0.5, 2.5], ["speed", 0, 4], ["alpha", 0, 1], ["density", 0, 3],
  ["glow", 0, 1], ["pulse", 0, 1], ["rainbow", 0, 1], ["spin", -2, 2]
];
const CUSTOM_RANGES = [["count", 1, 40], ["size", 0.05, 3], ["hue", 0, 360]];

function clampFields(c, ranges, defaults) {
  for (const [k, lo, hi] of ranges) {
    const v = Number(c[k]);
    c[k] = Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : defaults[k];
  }
}

/** Fill in one layer's missing fields and fall back to valid values. */
export function normalizeLayer(layer = {}) {
  const src = layer ?? {};
  const c = {};
  for (const k of Object.keys(LAYER_DEFAULTS)) c[k] = src[k] ?? LAYER_DEFAULTS[k];
  clampFields(c, RANGES, LAYER_DEFAULTS);
  if (c.color && !/^#[0-9a-f]{6}$/i.test(c.color)) c.color = null;
  if (c.design === CUSTOM) {
    c.style = CUSTOM;
    for (const k of Object.keys(CUSTOM_DEFAULTS)) c[k] = src[k] ?? CUSTOM_DEFAULTS[k];
    clampFields(c, CUSTOM_RANGES, CUSTOM_DEFAULTS);
    c.count = Math.round(c.count);
    c.src = typeof c.src === "string" ? c.src.trim() : "";
    if (/^\s*(javascript|data:text)/i.test(c.src)) c.src = "";
    if (!MOTIONS[c.motion]) c.motion = CUSTOM_DEFAULTS.motion;
    if (!COLOR_MODES.includes(c.colorMode)) c.colorMode = "original";
    if (c.blend !== "add") c.blend = "normal";
    return c;
  }
  if (!DESIGNS[c.design]) c.design = LAYER_DEFAULTS.design;
  const styles = DESIGNS[c.design].styles;
  if (!styles[c.style]) c.style = Object.keys(styles)[0];
  return c;
}

/**
 * A ring is a stack of layers, drawn bottom (first) to top: {layers: [layer, ...]}.
 * A single layer (the format of version 1.0) is accepted and wrapped.
 */
export function normalizeConfig(cfg = {}) {
  let layers = cfg?.layers;
  if (layers && !Array.isArray(layers) && typeof layers === "object") layers = Object.values(layers);
  if (!Array.isArray(layers)) layers = cfg && (cfg.design || cfg.style) ? [cfg] : [];
  layers = layers.slice(0, MAX_LAYERS).map(normalizeLayer);
  if (!layers.length) layers = [normalizeLayer({})];
  return { layers };
}

/** Image paths used by a ring's custom layers. */
export function customSources(cfg) {
  return [...new Set(normalizeConfig(cfg).layers.filter(l => l.design === CUSTOM && l.src).map(l => l.src))];
}

/** A short name for a layer, for lists. */
export function layerLabel(layer) {
  if (layer.design === CUSTOM) {
    const file = decodeURIComponent((layer.src || "").split(/[\\/]/).pop() || "").replace(/\.[a-z0-9]+$/i, "");
    return file || null;
  }
  const d = DESIGNS[layer.design];
  return `${d.label}: ${d.styles[layer.style]?.label ?? ""}`;
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
  // A four-pointed glint with a soft core.
  out.sparkle = [canvasTexture(64, (g, s) => {
    g.translate(s / 2, s / 2);
    const r = g.createRadialGradient(0, 0, 0, 0, 0, s * 0.22);
    r.addColorStop(0, "rgba(255,255,255,0.9)"); r.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = r; g.fillRect(-s / 2, -s / 2, s, s);
    g.fillStyle = "#ffffff";
    g.beginPath();
    const L = s * 0.48, W = s * 0.07;
    g.moveTo(0, -L);
    g.quadraticCurveTo(W, -W, L, 0); g.quadraticCurveTo(W, W, 0, L);
    g.quadraticCurveTo(-W, W, -L, 0); g.quadraticCurveTo(-W, -W, 0, -L);
    g.fill();
  })];
  // A bubble: thin rim, faint body, a highlight.
  out.bubble = [canvasTexture(64, (g, s) => {
    g.translate(s / 2, s / 2);
    g.fillStyle = "rgba(255,255,255,0.15)";
    g.beginPath(); g.arc(0, 0, s * 0.42, 0, TAU); g.fill();
    g.strokeStyle = "rgba(255,255,255,0.9)"; g.lineWidth = s * 0.05;
    g.beginPath(); g.arc(0, 0, s * 0.42, 0, TAU); g.stroke();
    g.fillStyle = "#ffffff";
    g.beginPath(); g.ellipse(-s * 0.15, -s * 0.17, s * 0.09, s * 0.06, -0.7, 0, TAU); g.fill();
  })];
  // Music notes: a quaver and two beamed quavers.
  const head = (g, x, y, s) => { g.beginPath(); g.ellipse(x, y, s * 0.13, s * 0.095, -0.45, 0, TAU); g.fill(); };
  out.note = [
    canvasTexture(64, (g, s) => {
      g.fillStyle = "#ffffff";
      head(g, s * 0.36, s * 0.76, s);
      g.fillRect(s * 0.45, s * 0.12, s * 0.06, s * 0.64);
      g.beginPath();
      g.moveTo(s * 0.51, s * 0.12);
      g.bezierCurveTo(s * 0.58, s * 0.3, s * 0.82, s * 0.32, s * 0.72, s * 0.58);
      g.bezierCurveTo(s * 0.74, s * 0.38, s * 0.6, s * 0.34, s * 0.51, s * 0.3);
      g.fill();
    }),
    canvasTexture(64, (g, s) => {
      g.fillStyle = "#ffffff";
      head(g, s * 0.24, s * 0.78, s);
      head(g, s * 0.7, s * 0.68, s);
      g.fillRect(s * 0.33, s * 0.2, s * 0.055, s * 0.58);
      g.fillRect(s * 0.79, s * 0.1, s * 0.055, s * 0.58);
      g.beginPath();
      g.moveTo(s * 0.33, s * 0.2); g.lineTo(s * 0.845, s * 0.1); g.lineTo(s * 0.845, s * 0.22); g.lineTo(s * 0.33, s * 0.32);
      g.fill();
    })
  ];
  out.heart = [canvasTexture(64, (g, s) => {
    g.translate(s / 2, s / 2 + s * 0.04);
    g.fillStyle = "#ffffff";
    g.beginPath();
    g.moveTo(0, s * 0.36);
    g.bezierCurveTo(-s * 0.56, -s * 0.02, -s * 0.26, -s * 0.5, 0, -s * 0.18);
    g.bezierCurveTo(s * 0.26, -s * 0.5, s * 0.56, -s * 0.02, 0, s * 0.36);
    g.fill();
  })];
  // A crystal shard / ray of light pointing along +x (emitters turn it to face outward).
  out.shard = [canvasTexture(64, (g, s) => {
    const l = g.createLinearGradient(s * 0.06, 0, s * 0.97, 0);
    l.addColorStop(0, "rgba(255,255,255,0.3)"); l.addColorStop(1, "rgba(255,255,255,1)");
    g.fillStyle = l;
    g.beginPath();
    g.moveTo(s * 0.97, s / 2); g.lineTo(s * 0.4, s * 0.39); g.lineTo(s * 0.06, s / 2); g.lineTo(s * 0.4, s * 0.61);
    g.closePath(); g.fill();
  })];
  // A playing card or scrap of paper: light, with a darker inner frame (so it takes a tint).
  out.card = [canvasTexture(64, (g, s) => {
    g.fillStyle = "#ffffff";
    g.beginPath(); g.roundRect(s * 0.28, s * 0.12, s * 0.44, s * 0.76, s * 0.06); g.fill();
    g.strokeStyle = "rgba(0,0,0,0.35)"; g.lineWidth = s * 0.03;
    g.beginPath(); g.roundRect(s * 0.34, s * 0.19, s * 0.32, s * 0.62, s * 0.03); g.stroke();
  })];
  // A coin, lit from the top left, with a raised rim.
  out.coin = [canvasTexture(64, (g, s) => {
    const r = g.createRadialGradient(s * 0.4, s * 0.38, s * 0.03, s / 2, s / 2, s * 0.41);
    r.addColorStop(0, "#ffffff"); r.addColorStop(0.7, "#c8c8c8"); r.addColorStop(1, "#8a8a8a");
    g.fillStyle = r;
    g.beginPath(); g.arc(s / 2, s / 2, s * 0.41, 0, TAU); g.fill();
    g.strokeStyle = "rgba(60,60,60,0.6)"; g.lineWidth = s * 0.05;
    g.beginPath(); g.arc(s / 2, s / 2, s * 0.3, 0, TAU); g.stroke();
  })];
  // Stones: irregular, lit from the top left (light grey, so they take a tint).
  out.rock = [0, 1, 2].map(v => canvasTexture(64, (g, s) => {
    let seed = 17 + v * 31;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    g.translate(s / 2, s / 2);
    const n = 8 + v;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU, rr = s * (0.3 + 0.14 * rnd());
      i ? g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    g.closePath();
    const r = g.createRadialGradient(-s * 0.14, -s * 0.16, s * 0.02, 0, 0, s * 0.46);
    r.addColorStop(0, "#ffffff"); r.addColorStop(0.55, "#b4b4b4"); r.addColorStop(1, "#5a5a5a");
    g.fillStyle = r; g.fill();
    g.strokeStyle = "rgba(40,40,40,0.6)"; g.lineWidth = s * 0.025; g.stroke();
  }));
  return out;
}

/* ======================================================================== */
/*  Sprites                                                                 */
/* ======================================================================== */

const rand = (a, b) => a + Math.random() * (b - a);

/** Emitter sprites are drawn at size * EMIT_SCALE token radii across (soft textures need room to fade). */
const EMIT_SCALE = { glow: 4, sparkle: 4, smoke: 2.4, shard: 2.6, leaf: 2.6, petal: 2.6, rock: 2.6, bubble: 2.6, card: 2.6, coin: 2.6, note: 2.6 };
const EMIT_MAX = 600;          // most live particles in one emitter
const EMIT_WARMUP = 150;       // 1/60 s steps simulated up front, so a new ring starts alive
const ROLES = { bright: 0, main: 1, dark: 2 };
const rgbToInt = c => (Math.round(c[0] * 255) << 16) | (Math.round(c[1] * 255) << 8) | Math.round(c[2] * 255);

class Swarm extends PIXI.Container {
  /**
   * @param {object} emit  for mode "emit": {rate, palette} (particles per second after density/detail,
   *                       the [bright, main, dark] rgb palette the colour ramp refers to, and the
   *                       layer's current time t, so group points line up with later frames)
   */
  constructor(def, textures, colors, count, emit = null) {
    super();
    this.def = def;
    let variants = def.textures ?? textures[def.tex] ?? textures.glow ?? [PIXI.Texture.WHITE];
    if (def.frames) variants = variants.slice(0, def.frames);
    this.items = [];
    if (def.mode === "emit") {
      this.#initEmitter(variants, count, emit);
      return;
    }
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
    p.sprite.rotation = d.custom ? 0 : Math.random() * TAU;   // own images start upright
    p.dir = Math.random() < 0.5 ? -1 : 1;
  }

  /* ---------- mode "emit" ---------- */

  #initEmitter(variants, count, emit) {
    const d = this.def;
    this.rate = emit?.rate ?? 0;
    this.carry = 0;
    const t0 = emit?.t ?? 0;
    this.time = t0 - EMIT_WARMUP / 60;
    const pal = emit?.palette ?? [[1, 1, 1], [1, 1, 1], [1, 1, 1]];
    this.ramp = d.colors.map(([t, c, a]) => [t, c in ROLES ? pal[ROLES[c]] : hexToRgb(c), a]);
    this.free = [];
    for (let i = 0; i < count; i++) {
      const s = new PIXI.Sprite(variants[i % variants.length]);
      s.anchor.set(0.5);
      s.blendMode = d.blend === "normal" ? PIXI.BLEND_MODES.NORMAL : PIXI.BLEND_MODES.ADD;
      s.visible = false;
      const p = { sprite: s, alive: false };
      this.items.push(p);
      this.free.push(p);
      this.addChild(s);
    }
    for (let i = 1; i <= EMIT_WARMUP; i++) this.#step(t0 - (EMIT_WARMUP - i) / 60, 1 / 60);
  }

  /** Colour and alpha of the ramp at t (0 - 1). */
  #rampAt(t) {
    const r = this.ramp;
    let i = 1;
    while (i < r.length - 1 && r[i][0] < t) i++;
    const [t0, c0, a0] = r[i - 1], [t1, c1, a1] = r[i];
    const k = Math.min(1, Math.max(0, (t - t0) / ((t1 - t0) || 1)));
    return [mixRgb(c0, c1, k), a0 + (a1 - a0) * k];
  }

  /** Move a particle on by dt seconds (positions in token radii, polar). */
  #move(p, dt) {
    const d = this.def;
    p.age += dt;
    p.r = Math.max(0.05, p.r + p.v * dt);
    p.angle += ((d.swirl ?? 0) + (d.wobble ?? 0) * Math.sin(p.age * 1.7 + p.phase)) * dt / p.r;
    p.rot += (d.spin ?? 0) * p.dir * dt;
  }

  /** Move and retire particles, then spawn this frame's new ones. */
  #step(t, dt) {
    const d = this.def;
    this.time = t;
    for (const p of this.items) {
      if (!p.alive) continue;
      if (p.age + dt >= p.lifespan) {
        p.alive = false;
        p.sprite.visible = false;
        this.free.push(p);
        continue;
      }
      this.#move(p, dt);
    }
    this.carry += this.rate * dt;
    while (this.carry >= 1) {
      this.carry -= 1;
      const p = this.free.pop();
      if (!p) { this.carry = 0; break; }
      // Births are spread over the frame, so tails stay smooth when the frame rate drops.
      const ago = this.rate > 0 ? Math.min(dt, this.carry / this.rate) : 0;
      p.alive = true;
      p.angle = d.group
        ? (t - ago) * (d.lead ?? 0) + Math.floor(Math.random() * d.group) * TAU / d.group + rand(-0.03, 0.03)
        : Math.random() * TAU;
      p.r = rand(d.radius[0], d.radius[1]);
      p.v = rand(d.out?.[0] ?? 0, d.out?.[1] ?? 0);
      p.age = 0;
      p.lifespan = rand(d.life[0], d.life[1]);
      p.phase = Math.random() * TAU;
      p.rot = Math.random() * TAU;
      p.dir = Math.random() < 0.5 ? -1 : 1;
      this.#move(p, ago);
    }
  }

  #updateEmitter(t, dt, R) {
    const d = this.def, A = d.alpha ?? 1;
    this.#step(t, dt);
    const k = EMIT_SCALE[d.tex] ?? 3;
    for (const p of this.items) {
      if (!p.alive) continue;
      const s = p.sprite;
      const life = p.age / p.lifespan;
      let [rgb, alpha] = this.#rampAt(life);
      if (d.flicker) alpha *= 1 - d.flicker * (0.5 + 0.5 * Math.sin(p.age * 17 + p.phase * 9));
      const px = (d.size[0] + (d.size[1] - d.size[0]) * life) * R * k;
      if (alpha <= 0.01 || px < 0.6) { s.visible = false; continue; }
      s.visible = true;
      s.position.set(Math.cos(p.angle) * p.r * R, Math.sin(p.angle) * p.r * R);
      s.rotation = d.tex === "shard" ? p.angle : p.rot;
      s.scale.set(px / (s.texture.orig?.width || s.texture.width || 64));
      s.tint = rgbToInt(rgb);
      s.alpha = Math.min(1, alpha * A);
    }
  }

  /** t: seconds (already scaled by speed), dt: frame seconds (scaled), R: ring radius in px */
  update(t, dt, R) {
    const d = this.def, A = d.alpha ?? 1;
    if (d.mode === "emit") return this.#updateEmitter(t, dt, R);
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
          s.rotation += (d.custom ? p.spin : p.spin || 0.5) * dt;
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
          if (!d.custom) s.rotation += 0.3 * dt;
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
/*  Effects                                                                 */
/* ======================================================================== */

/** Outer glow: a soft, coloured halo taken from the layer's own pixels. */
const GLOW_FRAG = `
precision highp float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform vec4 inputSize;
uniform vec4 inputClamp;
uniform float uDist;
uniform float uStrength;
void main() {
  vec4 c = texture2D(uSampler, vTextureCoord);
  vec4 acc = vec4(0.0);
  float tot = 0.0;
  for (int i = 0; i < 12; i++) {
    float an = float(i) * 0.5235988;
    vec2 dir = vec2(cos(an), sin(an)) * inputSize.zw * uDist;
    for (int j = 1; j <= 3; j++) {
      float f = float(j) / 3.0;
      float w = 1.0 - f * 0.6;
      acc += texture2D(uSampler, clamp(vTextureCoord + dir * f, inputClamp.xy, inputClamp.zw)) * w;
      tot += w;
    }
  }
  vec4 g = acc / tot * uStrength;
  if (g.a > 1.0) g /= g.a;
  gl_FragColor = c + g * (1.0 - c.a);
}`;

function glowFilter(amount) {
  const dist = 3 + 14 * amount;
  const f = new PIXI.Filter(undefined, GLOW_FRAG, { uDist: dist, uStrength: 0.8 + 1.8 * amount });
  f.padding = Math.ceil(dist) + 2;
  return f;
}

const ColorMatrix = () => PIXI.ColorMatrixFilter ?? PIXI.filters?.ColorMatrixFilter;

/** Greyscale the image, then paint it in one colour (keeps light and shade). */
function colorizeFilter(hex) {
  const [r, g, b] = hexToRgb(hex);
  const f = new (ColorMatrix())();
  const k = 1.25;
  const row = c => [0.299 * c * k, 0.587 * c * k, 0.114 * c * k, 0, 0];
  f.matrix = [...row(r), ...row(g), ...row(b), 0, 0, 0, 1, 0];
  return f;
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

const sizeFactorOf = R => Math.min(2.5, Math.max(0.6, Math.sqrt(R / 50)));

/** One layer of a ring: a design (band + sprites) or the user's own image, plus its effects. */
class LivelyLayer extends PIXI.Container {
  constructor(cfg, textures, quality) {
    super();
    this.cfg = cfg;
    this.textures = textures;
    this.quality = quality;
    this.time = Math.random() * 100;
    this.R = 0;
    this.band = null;
    this.swarms = [];
    this.isCustom = cfg.design === CUSTOM;
    if (!this.isCustom) {
      const design = DESIGNS[cfg.design];
      const style = design.styles[cfg.style];
      this.palette = palette(style, cfg.color);
      const [A, B, C] = this.palette;
      this.additive = (style.blend ?? design.blend) === "add";
      if (design.band) {
        const material = new PIXI.MeshMaterial(PIXI.Texture.WHITE, {
          program: program(design.band),
          uniforms: { uTime: 0, uA: new Float32Array(A), uB: new Float32Array(B), uC: new Float32Array(C), uP1: style.p1 ?? 0 }
        });
        this.band = new PIXI.Mesh(quadGeometry(), material);
        this.band.blendMode = this.additive ? PIXI.BLEND_MODES.ADD : PIXI.BLEND_MODES.NORMAL;
        this.addChild(this.band);
      }
    } else {
      this.additive = cfg.blend === "add";
    }
    // Sprites are built on the first setRadius(), once the creature's size is known.
    this.#buildFilters();
    this.baseAlpha = cfg.alpha;
    this.alpha = cfg.alpha;
  }

  /** Sprite groups: the style's own, or the custom image as one group. */
  #defs() {
    const cfg = this.cfg;
    if (!this.isCustom) return DESIGNS[cfg.design].styles[cfg.style].swarms ?? [];
    const tex = this.textures.custom?.[cfg.src];
    if (!tex) return [];
    const m = MOTIONS[cfg.motion];
    const tint = cfg.colorMode === "tint" && cfg.color ? cfg.color : "#ffffff";
    return [{
      textures: [tex], custom: true, count: m.single ? 1 : cfg.count, mode: m.mode, radius: m.radius, speed: m.speed, spin: m.spin,
      size: m.single ? [cfg.size, cfg.size] : [cfg.size * 0.85, cfg.size * 1.15],
      colors: [tint], blend: cfg.blend, alpha: 1
    }];
  }

  #buildSwarms() {
    for (const s of this.swarms) { this.removeChild(s); s.destroy({ children: true }); }
    this.swarms = [];
    const sizeFactor = sizeFactorOf(this.R);
    const colorOverride = this.isCustom ? null : this.cfg.color;
    for (const def of this.#defs()) {
      if (def.mode === "emit") {
        const rate = this.cfg.density <= 0 ? 0 : def.rate * this.cfg.density * this.quality * sizeFactor;
        const n = rate > 0 ? Math.min(EMIT_MAX, Math.ceil(rate * def.life[1]) + 8) : 0;
        const sw = new Swarm(def, this.textures, null, n, { rate, palette: this.palette, t: this.time });
        this.swarms.push(sw);
        this.addChild(sw);
        continue;
      }
      let n;
      if (def.mode === "spinner") n = 1;
      else if (def.custom) n = Math.max(1, Math.round(def.count * this.quality * sizeFactor));
      else n = this.cfg.density <= 0 ? 0 : Math.max(1, Math.round(def.count * this.cfg.density * this.quality * sizeFactor));
      const sw = new Swarm(def, this.textures, swarmColors(def, colorOverride), n);
      this.swarms.push(sw);
      this.addChild(sw);
    }
    this._sizeFactor = sizeFactor;
  }

  #buildFilters() {
    const cfg = this.cfg;
    const filters = [];
    if (this.isCustom && cfg.colorMode === "colorize" && cfg.color) filters.push(colorizeFilter(cfg.color));
    const hueBase = this.isCustom && cfg.colorMode === "hue" ? cfg.hue : 0;
    if (hueBase || cfg.rainbow > 0) {
      this.hueFilter = new (ColorMatrix())();
      this.hueFilter.hue(hueBase, false);
      filters.push(this.hueFilter);
    }
    if (cfg.glow > 0) filters.push(glowFilter(cfg.glow));
    // A filter draws the layer into a texture first; keep additive layers additive on the map.
    for (const f of filters) f.blendMode = this.additive ? PIXI.BLEND_MODES.ADD : PIXI.BLEND_MODES.NORMAL;
    this.filters = filters.length ? filters : null;
  }

  setRadius(px) {
    const R = Math.max(8, px * this.cfg.scale);
    if (this.R && Math.abs(R - this.R) < 0.5) return;
    this.R = R;
    this.band?.scale.set(R);
    if (Math.abs(sizeFactorOf(R) - (this._sizeFactor ?? 0)) > 0.15) this.#buildSwarms();
  }

  update(dt) {
    const cfg = this.cfg;
    const sdt = dt * cfg.speed;
    this.time += sdt;
    const t = this.time;
    if (this.band) this.band.shader.uniforms.uTime = t;
    for (const s of this.swarms) s.update(t, sdt, this.R);
    if (cfg.spin) this.rotation += cfg.spin * dt;
    if (cfg.pulse > 0) {
      const w = 0.5 + 0.5 * Math.sin(t * 2.6);
      this.scale.set(1 + 0.12 * cfg.pulse * (w - 0.5));
      this.alpha = this.baseAlpha * (1 - 0.45 * cfg.pulse * (1 - w));
    }
    if (this.hueFilter && cfg.rainbow > 0) {
      const base = this.isCustom && cfg.colorMode === "hue" ? cfg.hue : 0;
      this.hueFilter.hue((base + t * 140 * cfg.rainbow) % 360, false);
    }
  }

  destroy(options) {
    this.band?.shader?.destroy?.();
    super.destroy({ children: true, ...(options ?? {}) });
  }
}

/** Make `child` the next child of `parent` right after `anchor` (moves it only when it is not there yet). */
export function insertAbove(parent, child, anchor) {
  const at = parent.getChildIndex(anchor);
  if (child.parent === parent && parent.getChildIndex(child) === at + 1) return;
  if (child.parent) child.parent.removeChild(child);
  parent.addChildAt(child, parent.getChildIndex(anchor) + 1);
}

export class LivelyRing extends PIXI.Container {
  /**
   * @param {object} cfg        {layers: [...]} (see normalizeConfig)
   * @param {object} textures   from loadTextures(), plus {custom: {src: PIXI.Texture}} for custom layers
   * @param {number} quality    particle multiplier (performance setting)
   */
  constructor(cfg, textures, quality = 1) {
    super();
    this.cfg = normalizeConfig(cfg);
    this.eventMode = "none";
    this.interactiveChildren = false;
    this.layers = this.cfg.layers.map(l => this.addChild(new LivelyLayer(l, textures, quality)));
  }

  get key() { return JSON.stringify(this.cfg); }

  /** Set the token radius in pixels (before each layer's own scale). */
  setRadius(px) {
    for (const l of this.layers) l.setRadius(px);
  }

  /** Advance the animation by dt seconds. */
  update(dt) {
    for (const l of this.layers) l.update(dt);
  }

  destroy(options) {
    super.destroy({ children: true, ...(options ?? {}) });
  }
}
