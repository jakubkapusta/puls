// GLSL ES 3.00 sources. All lighting is in linear space; the composite pass tone-maps.

const H = `#version 300 es
precision highp float;
`;

// Mobile GPUs (Mali/Adreno) turn any NaN/Inf into black blocks once bloom spreads it:
// scrub values before they are stored in a render target.
const SAFE = `
vec3 safe(vec3 c){ return mix(vec3(0.), min(c, vec3(256.)), lessThan(abs(c), vec3(1e4))); }
`;

const NOISE = `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(float x){ float i = floor(x), f = fract(x); return mix(hash12(vec2(i, 3.1)), hash12(vec2(i + 1., 3.1)), f*f*(3.-2.*f)); }
`;

export const FULLSCREEN_VS = `${H}
out vec2 v_uv;
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = p;
  gl_Position = vec4(p * 2. - 1., 0., 1.);
}`;

// ---------------------------------------------------------------- background
// A synthwave night behind the playfield: sky, banded sun, mountains, a perspective grid
// rolling towards us. Everything pulses with the music (kick, hats, bass level).
export const BG_FS = `${H}
${SAFE}
${NOISE}
in vec2 v_uv;
uniform vec2 u_res;
uniform float u_time;
uniform float u_scroll;    // grid travel, in grid cells (follows the beat)
uniform float u_kick;      // 0..1 envelope
uniform float u_hat;
uniform float u_bass;      // 0..1 low-band level
uniform float u_energy;    // 0..1 how much of the song is unlocked
uniform float u_groove;    // 0..1 "w rytmie"
uniform vec4 u_field;      // playfield rect in pixels: x0, y0, x1, y1
uniform float u_hz;        // horizon height (0..1 of the screen)
out vec4 o;
void main(){
  vec2 fc = gl_FragCoord.xy;
  float asp = u_res.x / u_res.y;
  vec2 p = vec2((v_uv.x - .5) * asp, v_uv.y);
  float hz = u_hz;
  vec3 c;
  vec3 pink = vec3(1., .12, .45), violet = vec3(.25, .05, .55), deep = vec3(.012, .004, .03);
  if (p.y > hz) {
    // sky
    float h = (p.y - hz) / (1. - hz);
    c = mix(pink * .22, violet * .08, smoothstep(0., .35, h));
    c = mix(c, deep, smoothstep(.3, 1., h));
    // stars twinkle with the hats
    vec2 sp = floor(fc / 3.);
    float st = hash12(sp);
    float tw = .5 + .5 * sin(u_time * 3. + st * 40.);
    c += vec3(.8, .85, 1.) * step(.9965, st) * (.25 + .9 * u_hat * tw) * smoothstep(.15, .5, h);
    // sun with bands cut out of its lower half
    vec2 sc = vec2(0., hz + .13);
    float R = .2 * (1. + u_kick * .035);
    float d = length(p - sc);
    float k = clamp((p.y - (sc.y - R)) / (2. * R), 0., 1.);
    vec3 sun = mix(vec3(1., .08, .35), vec3(1., .72, .18), k) * (.55 + u_energy * .5 + u_kick * .35);
    float bands = step(.5, fract((p.y - hz) * 46. - u_time * .4)) + step(.55, k);
    float inside = smoothstep(.003, -.003, d - R) * clamp(bands, 0., 1.);
    c = mix(c, sun, inside);
    c += vec3(1., .2, .5) * exp(-max(d - R, 0.) * 9.) * (.1 + .15 * u_kick + .1 * u_energy);
    // mountains on the horizon
    float x = p.x * 3.;
    float m = hz + .05 * vnoise(x * 2.1 + 3.) + .025 * vnoise(x * 5.3) + .01 * vnoise(x * 13.);
    m *= 1. - .3 * smoothstep(.0, .3, .35 - abs(p.x));
    float mm = smoothstep(.002, -.002, p.y - max(m, hz + .004));
    c = mix(c, vec3(.03, .006, .05), mm);
    c += vec3(.6, .1, .9) * mm * exp(-(m - p.y) * 60.) * .25;
  } else {
    // floor: a grid in perspective, rolling towards us on the beat (lines 1–2 px wide on screen)
    float dy = hz - p.y;
    vec2 g = vec2(p.x / (dy + .01) * .55, .32 / (dy + .01) + u_scroll);
    vec2 fw = fwidth(g);
    vec2 gd = abs(fract(g + .5) - .5) / max(fw, vec2(1e-4));
    float lx = 1. - smoothstep(.5, 1.6, gd.x);
    float ly = 1. - smoothstep(.5, 1.6, gd.y);
    // fade lines where they get denser than a few px apart (near the horizon)
    float fade = smoothstep(.35, .08, fw.y) * smoothstep(.5, .1, fw.x);
    float line = max(lx * smoothstep(.6, .1, fw.x), ly * fade);
    vec3 lc = mix(vec3(.15, .85, 1.), vec3(1., .2, .8), clamp(u_groove * .7 + u_bass * .3, 0., 1.));
    c = mix(vec3(.01, .002, .03), violet * .05, smoothstep(0., .3, dy));
    c += lc * line * (.35 + .9 * u_kick + .6 * u_bass) * smoothstep(0., .04, dy);
    // the horizon glows
    c += pink * exp(-dy * 40.) * (.5 + .4 * u_kick);
  }
  // the playfield sits on a darker glass pane so the bricks read clearly
  vec4 f = u_field;
  vec2 q = max(vec2(f.x - fc.x, f.y - fc.y), vec2(fc.x - f.z, fc.y - f.w));
  float inField = step(max(q.x, q.y), 0.);
  c *= mix(1., .38, inField);
  o = vec4(safe(c), 1.);
}`;

// ---------------------------------------------------------------- neon shapes
// Instanced quads with a rounded-box SDF. Premultiplied output: alpha covers, rgb adds light.
// kind 0: emissive blob/box, 1: glass brick, 2: ring (extra = thickness), 3: hard brick (extra = hp left 0..1)
export const SHAPE_VS = `${H}
layout(location=0) in vec2 a_corner;
layout(location=1) in vec4 a_box;   // cx, cy, half w, half h (world)
layout(location=2) in vec4 a_par;   // corner radius, kind, glow radius, extra
layout(location=3) in vec4 a_col;   // linear rgb (HDR), alpha
uniform vec4 u_view;                // field origin in px (x0, y0), px per unit, 0
uniform vec2 u_res;
out vec2 v_p;
out vec4 v_box;
out vec4 v_par;
out vec4 v_col;
void main(){
  float m = a_par.z * 4.5 + 2. / u_view.z;
  vec2 hs = a_box.zw + m;
  v_p = a_corner * hs;
  v_box = a_box;
  v_par = a_par;
  v_col = a_col;
  vec2 w = a_box.xy + v_p;
  vec2 px = u_view.xy + w * u_view.z;
  gl_Position = vec4(px / u_res * 2. - 1., 0., 1.);
}`;

export const SHAPE_FS = `${H}
in vec2 v_p;
in vec4 v_box;
in vec4 v_par;
in vec4 v_col;
uniform float u_px;   // world units per pixel
out vec4 o;
float sdBox(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r; }
void main(){
  float r = min(v_par.x, min(v_box.z, v_box.w));
  float d = sdBox(v_p, v_box.zw, r);
  int kind = int(v_par.y + .5);
  float aa = u_px;
  float glowR = max(v_par.z, 1e-3);
  vec3 col = v_col.rgb;
  float a = v_col.a;
  if (kind == 2) {
    d = abs(d) - v_par.w;
  }
  float fill = smoothstep(aa, -aa, d);
  float glow = v_par.z > 0. ? exp(-max(d, 0.) / glowR) * (1. - fill) : 0.;
  vec3 c;
  float cover;
  if (kind == 1 || kind == 3) {
    // glass: dark tinted body, bright rim, a sheen across the top
    float rim = smoothstep(-3.5 * aa - 2.5, -aa, d);
    float sheen = smoothstep(.2, 1., v_p.y / v_box.w) * .35;
    vec3 body = col * (.16 + sheen) + col * .05;
    c = mix(body, col * 1.6, rim);
    if (kind == 3) {
      // hard: an inner frame and bars for the hits left
      float inner = abs(sdBox(v_p, v_box.zw - 7., r * .5)) - .9;
      c += col * smoothstep(aa, -aa, inner) * .9;
      float bars = step(abs(v_p.y), v_box.w * .32) * step(fract((v_p.x / v_box.z * .5 + .5) * 3.) , .82 * v_par.w + .0);
      c += col * bars * .25;
    }
    c *= fill;
    cover = fill * a;
  } else {
    c = col * fill;
    cover = fill * a;
  }
  c += col * glow * .6;
  o = vec4(c * v_col.a, cover);
}`;

// ---------------------------------------------------------------- bloom
export const DOWN_FS = `${H}
${SAFE}
in vec2 v_uv;
uniform sampler2D u_src;
uniform vec2 u_texel;
uniform float u_pre;       // 1 on the first (threshold) pass
uniform float u_thresh;
out vec4 o;
void main(){
  vec2 t = u_texel;
  vec3 a = texture(u_src, v_uv + t * vec2(-1., -1.)).rgb;
  vec3 b = texture(u_src, v_uv + t * vec2( 1., -1.)).rgb;
  vec3 c = texture(u_src, v_uv + t * vec2(-1.,  1.)).rgb;
  vec3 d = texture(u_src, v_uv + t * vec2( 1.,  1.)).rgb;
  vec3 e = texture(u_src, v_uv).rgb;
  vec3 s = safe((a + b + c + d) * .125 + e * .5);
  if (u_pre > .5) {
    float br = max(s.r, max(s.g, s.b));
    float knee = u_thresh * .5;
    float rq = clamp(br - u_thresh + knee, 0., 2. * knee);
    rq = rq * rq / (4. * knee + 1e-4);
    s *= max(rq, br - u_thresh) / max(br, 1e-4);
  }
  o = vec4(s, 1.);
}`;

export const UP_FS = `${H}
in vec2 v_uv;
uniform sampler2D u_src;
uniform vec2 u_texel;
uniform float u_amt;
out vec4 o;
void main(){
  vec2 t = u_texel;
  vec3 s = texture(u_src, v_uv).rgb * 4.;
  s += texture(u_src, v_uv + t * vec2(-1., 0.)).rgb * 2.;
  s += texture(u_src, v_uv + t * vec2( 1., 0.)).rgb * 2.;
  s += texture(u_src, v_uv + t * vec2(0., -1.)).rgb * 2.;
  s += texture(u_src, v_uv + t * vec2(0.,  1.)).rgb * 2.;
  s += texture(u_src, v_uv + t * vec2(-1., -1.)).rgb;
  s += texture(u_src, v_uv + t * vec2( 1., -1.)).rgb;
  s += texture(u_src, v_uv + t * vec2(-1.,  1.)).rgb;
  s += texture(u_src, v_uv + t * vec2( 1.,  1.)).rgb;
  o = vec4(s / 16. * u_amt, 1.);
}`;

// ---------------------------------------------------------------- composite
export const COMPOSITE_FS = `${H}
${SAFE}
${NOISE}
in vec2 v_uv;
uniform sampler2D u_scene;
uniform sampler2D u_bloom;
uniform vec2 u_res;
uniform float u_time;
uniform float u_bloomAmt;
uniform float u_ca;
uniform vec4 u_shock[4];   // center (px), radius (px), amplitude
uniform float u_flash;     // white flash 0..1
uniform vec3 u_tint;       // added colour (red on a lost ball)
out vec4 o;
vec3 aces(vec3 x){ return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14), 0., 1.); }
void main(){
  vec2 uv = v_uv;
  vec2 fc = uv * u_res;
  // shockwaves bend space: a ring pushing pixels outwards
  float kk = 0.;
  for (int i = 0; i < 4; i++) {
    vec4 s = u_shock[i];
    if (s.w <= 0.) continue;
    vec2 dd = fc - s.xy;
    float r = length(dd);
    float w = 26. + s.z * .08;
    float x = (r - s.z) / w;
    float k = exp(-x * x) * s.w;
    fc -= dd / (r + 1e-3) * k * 14.;
    kk += k;
  }
  uv = fc / u_res;
  vec2 cd = (uv - .5) * (u_ca + kk * .006);
  vec3 c = vec3(texture(u_scene, uv + cd).r, texture(u_scene, uv).g, texture(u_scene, uv - cd).b);
  c = safe(c) + safe(texture(u_bloom, uv).rgb) * u_bloomAmt;
  c += u_tint + vec3(u_flash);
  c = aces(c);
  vec2 q = v_uv - .5;
  c *= 1. - dot(q, q) * .9;
  // faint scanlines
  c *= .96 + .04 * sin(gl_FragCoord.y * 1.7);
  c = pow(max(c, 0.), vec3(1. / 2.2));
  c += (hash12(gl_FragCoord.xy + fract(u_time * 7.3) * 311.) - .5) * .03;
  o = vec4(c, 1.);
}`;
