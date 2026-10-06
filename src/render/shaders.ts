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
// A synthwave night behind the playfield: sky, banded sun, two mountain ridges with neon rims,
// a perspective grid rolling towards us. It reacts to the music (kick, snare, hats, spectrum)
// and grows with the layers the player unlocks:
//   hat → stars twinkle, snare → the sky flashes, pad → aurora ribbons, arp → laser fan from the
//   horizon (one beam per 16th), bass2 → the floor lines glow with the bass (they never move:
//   the owner found a waving floor nauseating), perc → a spectrum skyline on the horizon.
export const BG_FS = `${H}
${SAFE}
${NOISE}
in vec2 v_uv;
uniform vec2 u_res;
uniform float u_time;
uniform float u_songT;     // song time (s), for patterns locked to the music
uniform float u_s16;       // seconds per 16th
uniform float u_scroll;    // grid travel, in grid cells (one per beat)
uniform float u_kick;      // 0..1 envelopes
uniform float u_snare;
uniform float u_hat;
uniform float u_bass;      // 0..1 band levels
uniform float u_mid;
uniform float u_high;
uniform float u_energy;    // 0..1 how much of the song is unlocked
uniform float u_groove;    // 0..1 "w rytmie"
uniform vec4 u_layA;       // hat, snare, pad, arp (0..1, eased)
uniform vec2 u_layB;       // bass2, perc
uniform sampler2D u_spec;  // 32 spectrum bins (R8)
uniform vec4 u_field;      // playfield rect in pixels: x0, y0, x1, y1
uniform float u_hz;        // horizon height (0..1 of the screen)
uniform float u_detail;    // quality 0.5..1
uniform float u_theme;     // 0 synthwave, 1 lo-fi (rainy city at dusk)
out vec4 o;

float ridge(float x, float s, float a){
  return a * (.55 * vnoise(x * 2.1 * s + 3.) + .3 * vnoise(x * 5.3 * s + 11.) + .15 * vnoise(x * 13. * s + 7.));
}

void main(){
  vec2 fc = gl_FragCoord.xy;
  float asp = u_res.x / u_res.y;
  vec2 p = vec2((v_uv.x - .5) * asp, v_uv.y);
  float hz = u_hz;
  vec3 c;
  vec3 pink = vec3(1., .12, .45), violet = vec3(.25, .05, .55), cyan = vec3(.1, .8, 1.), deep = vec3(.012, .004, .03);
  float step16 = floor(u_songT / u_s16);
  float sunY = hz + .13;
  vec3 sunHot = mix(vec3(1., .72, .18), vec3(1., .9, .6), u_groove * .5);

  bool lofi = u_theme > .5;
  if (lofi) {
    // lo-fi: a warmer, softer palette
    pink = vec3(1., .42, .3);
    violet = vec3(.22, .12, .3);
    cyan = vec3(.35, .75, .8);
    deep = vec3(.01, .014, .025);
    sunY = hz + .1;
    sunHot = vec3(1., .78, .5);
  }

  if (p.y > hz) {
    float h = (p.y - hz) / (1. - hz);
    c = mix(pink * .2, violet * .08, smoothstep(0., .35, h));
    c = mix(c, deep, smoothstep(.3, 1., h));
    // snare: the sky flashes up from the horizon
    c += mix(pink, violet, h) * exp(-h * 4.) * u_snare * u_layA.y * .35;

    // stars, twinkling with the hats once the hi-hat layer is in
    vec2 sp = floor(fc / 3.);
    float st = hash12(sp);
    float tw = .5 + .5 * sin(u_time * 3. + st * 40.);
    float dens = lofi ? 1.1 : mix(.9975, .993, u_layA.x);
    c += vec3(.8, .85, 1.) * step(dens, st) * (.25 + 1.1 * u_hat * tw * u_layA.x) * smoothstep(.12, .45, h);

    // pad: aurora ribbons drifting across the sky
    if (u_layA.z > .01 && u_detail > .6) {
      for (int i = 0; i < 2; i++) {
        float fi = float(i);
        float yy = .42 + fi * .16 + .05 * sin(p.x * (2.3 + fi) + u_time * (.25 + fi * .1)) + .03 * sin(p.x * 6.1 - u_time * .4 + fi * 2.);
        float dd = h - yy;
        float band = exp(-dd * dd / (.0016 + .0012 * fi)) * (.6 + .4 * vnoise(p.x * 8. + u_time * .6 + fi * 9.));
        vec3 ac = mix(cyan, violet * 2., .5 + .5 * sin(p.x * 2. + fi * 2. + u_time * .2));
        c += ac * band * u_layA.z * (.3 + .4 * u_mid);
      }
    }

    // arp: a fan of lasers from behind the mountains, the beam of this 16th lit
    vec2 lo = vec2(0., hz + .02);
    if (u_layA.w > .01) {
      vec2 d0 = p - lo;
      float ang = atan(d0.x, d0.y);
      float far = smoothstep(0., .08, d0.y) * exp(-length(d0) * 1.6);
      for (int i = 0; i < 6; i++) {
        float fi = float(i);
        float a = (fi - 2.5) * .26;
        float on = 1. - step(.5, abs(mod(step16, 6.) - fi));
        float w = abs(ang - a) * length(d0);
        float beam = exp(-w * w / .00002) * .9 + exp(-w * w / .0006) * .25;
        vec3 bc = mod(fi, 2.) < .5 ? pink : cyan;
        c += bc * beam * far * u_layA.w * (.12 + .9 * on * (1. - fract(u_songT / u_s16)));
      }
    }

    // sun with bands sliding down its lower half
    vec2 sc = vec2(0., sunY);
    float R = .2 * (1. + u_kick * .035);
    float d = length(p - sc);
    float k = clamp((p.y - (sc.y - R)) / (2. * R), 0., 1.);
    vec3 sun = mix(vec3(1., .08, .35), sunHot, k) * (.5 + u_energy * .3 + u_kick * .3 + u_groove * .2);
    float bands = lofi ? 1. : step(.5, fract((p.y - hz) * 46. - u_time * .4)) + step(.55, k);
    float inside = smoothstep(lofi ? .02 : .003, lofi ? -.02 : -.003, d - R) * clamp(bands, 0., 1.) * (lofi ? .55 : 1.);
    c = mix(c, sun, inside);
    c += vec3(1., .2, .5) * exp(-max(d - R, 0.) * 9.) * (.1 + .15 * u_kick + .12 * u_energy);

    // perc: a spectrum skyline on the horizon, mirrored around the centre
    if (u_layB.y > .01) {
      float bx = abs(p.x) / (asp * .5);
      float bin = floor(bx * 24.);
      float v = texture(u_spec, vec2((bin + .5) / 32., .5)).r;
      float bh = hz + .015 + v * .16 * u_layB.y;
      float inBar = step(.18, fract(bx * 24.)) * smoothstep(.001, -.001, p.y - bh);
      vec3 ec = mix(cyan, pink, clamp((p.y - hz) / .16, 0., 1.));
      c = mix(c, ec * (.35 + .7 * v), inBar * .8);
    }

    if (lofi) {
      // a city skyline with lit windows, flickering a little with the hats
      float bw = .045;
      float bx = floor(p.x / bw);
      float hb = hz + .015 + .1 * hash12(vec2(bx, 7.)) * (.45 + .55 * smoothstep(0., .45, abs(p.x))) + .02 * step(.8, hash12(vec2(bx, 3.)));
      float inB = smoothstep(.0015, -.0015, p.y - hb);
      vec3 bc = vec3(.02, .018, .03);
      vec2 wcell = vec2(floor(p.x / bw * 4.), floor((p.y - hz) / .011));
      vec2 wf = vec2(fract(p.x / bw * 4.), fract((p.y - hz) / .011));
      float win = step(.62, hash12(wcell + bx * 3.1)) * step(.25, wf.x) * step(wf.x, .75) * step(.3, wf.y) * step(wf.y, .78);
      win *= step(p.y, hb - .006);
      bc += vec3(1., .7, .35) * win * (.25 + .15 * hash12(wcell) + .25 * u_hat * step(.9, hash12(wcell + 5.)));
      c = mix(c, bc, inB);
      c += pink * exp(-abs(p.y - hb) * 400.) * .08 * (1. - inB);
    } else {
      // two ridges: far violet, near dark, both with a neon rim that glows with the mids
      float x = p.x * 3.;
      float m1 = hz + .006 + ridge(x, .7, .085) * (1. - .55 * smoothstep(.0, .25, .3 - abs(p.x)));
      float m2 = hz + .002 + ridge(x + 40., 1.3, .055) * (1. - .7 * smoothstep(.0, .3, .38 - abs(p.x)));
      float in1 = smoothstep(.0015, -.0015, p.y - m1);
      float in2 = smoothstep(.0015, -.0015, p.y - m2);
      c = mix(c, vec3(.05, .01, .09) + violet * .05 * (m1 - p.y) * 10., in1);
      c += pink * exp(-abs(p.y - m1) * 500.) * (.25 + .5 * u_mid + .3 * u_kick) * (1. - in2);
      c = mix(c, vec3(.012, .003, .025), in2);
      c += cyan * exp(-abs(p.y - m2) * 600.) * (.2 + .4 * u_bass) * .8;
    }
  } else {
    // floor: a grid in perspective rolling towards us on the beat (its shape stays still)
    float dy = hz - p.y;
    float z = .32 / (dy + .01);
    vec2 g = vec2(p.x / (dy + .01) * .55, z + u_scroll);
    vec2 fw = fwidth(g);
    vec2 gd = abs(fract(g + .5) - .5) / max(fw, vec2(1e-4));
    float lx = 1. - smoothstep(.5, 1.6, gd.x);
    float ly = 1. - smoothstep(.5, 1.6, gd.y);
    float fade = smoothstep(.35, .08, fw.y) * smoothstep(.5, .1, fw.x);
    float line = max(lx * smoothstep(.6, .1, fw.x), ly * fade);
    vec3 lc = mix(cyan * 1.2, vec3(1., .2, .8), clamp(u_groove * .8 + u_bass * .25, 0., 1.));
    c = mix(vec3(.01, .002, .03), violet * .05, smoothstep(0., .3, dy));
    if (lofi) {
      // wet asphalt: faint lines, the windows' light smeared into long reflections
      c = vec3(.008, .009, .014);
      line *= .25;
      float bx = floor(p.x / .045);
      float refl = hash12(vec2(bx, 7.)) * (.5 + .5 * vnoise(dy * 40. + bx));
      c += vec3(1., .65, .35) * refl * exp(-dy * 9.) * .07;
    }
    c += lc * line * (.35 + .9 * u_kick + .6 * u_bass + u_layB.x * .7 * u_bass) * smoothstep(0., .04, dy);
    // the sun's reflection on the floor
    c += sunHot * exp(-abs(p.x) * 7.) * exp(-dy * 7.) * (.12 + .2 * u_kick) * (.6 + u_energy);
    // the horizon glows
    c += pink * exp(-dy * 40.) * (.5 + .4 * u_kick);
  }
  if (lofi) {
    // rain, slanted, over everything
    vec2 rp = vec2(p.x * 70. + p.y * 9., p.y * 2.2 + u_time * 2.6);
    float col = floor(rp.x);
    float rr = hash12(vec2(col, 1.7));
    float yy = fract(rp.y + rr * 7.);
    float streak = step(.55, rr) * smoothstep(0., .03, yy) * smoothstep(.16, .05, yy) * smoothstep(.22, .0, abs(fract(rp.x) - .5));
    c += vec3(.55, .6, .75) * streak * .07;
  }
  // the playfield sits on a darker glass pane so the bricks read clearly
  vec4 f = u_field;
  vec2 q = max(vec2(f.x - fc.x, f.y - fc.y), vec2(fc.x - f.z, fc.y - f.w));
  float inField = step(max(q.x, q.y), 0.);
  c *= mix(1., .4, inField);
  o = vec4(safe(c), 1.);
}`;

// ---------------------------------------------------------------- neon shapes
// Instanced quads with an SDF, optionally rotated. Premultiplied output: alpha covers, rgb adds
// light (ext.w = 1 → purely additive). kind 0: glow box / capsule / circle, 1: glass brick,
// 2: ring (extra = thickness), 3: hard brick (extra = hp left 0..1), 4: glass shard (a right
// triangle in its box, ext.yz flip it).
export const SHAPE_VS = `${H}
layout(location=0) in vec2 a_corner;
layout(location=1) in vec4 a_box;   // cx, cy, half w, half h (world)
layout(location=2) in vec4 a_par;   // corner radius, kind, glow radius, extra
layout(location=3) in vec4 a_col;   // linear rgb (HDR), alpha
layout(location=4) in vec4 a_ext;   // rotation, flip x, flip y, additive
uniform vec4 u_view;                // field origin in px (x0, y0), px per unit, 0
uniform vec2 u_res;
out vec2 v_p;
out vec4 v_box;
out vec4 v_par;
out vec4 v_col;
out vec4 v_ext;
void main(){
  float m = a_par.z * 4.5 + 2. / u_view.z;
  vec2 hs = a_box.zw + m;
  v_p = a_corner * hs;
  v_box = a_box;
  v_par = a_par;
  v_col = a_col;
  v_ext = a_ext;
  float cs = cos(a_ext.x), sn = sin(a_ext.x);
  vec2 w = a_box.xy + mat2(cs, sn, -sn, cs) * v_p;
  vec2 px = u_view.xy + w * u_view.z;
  gl_Position = vec4(px / u_res * 2. - 1., 0., 1.);
}`;

export const SHAPE_FS = `${H}
in vec2 v_p;
in vec4 v_box;
in vec4 v_par;
in vec4 v_col;
in vec4 v_ext;
uniform float u_px;   // world units per pixel
uniform float u_time;
out vec4 o;
float sdBox(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r; }
float sdTri(vec2 p, vec2 p0, vec2 p1, vec2 p2){
  vec2 e0 = p1 - p0, e1 = p2 - p1, e2 = p0 - p2;
  vec2 v0 = p - p0, v1 = p - p1, v2 = p - p2;
  vec2 pq0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0., 1.);
  vec2 pq1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0., 1.);
  vec2 pq2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0., 1.);
  float s = sign(e0.x * e2.y - e0.y * e2.x);
  vec2 d = min(min(vec2(dot(pq0, pq0), s * (v0.x * e0.y - v0.y * e0.x)),
                   vec2(dot(pq1, pq1), s * (v1.x * e1.y - v1.y * e1.x))),
                   vec2(dot(pq2, pq2), s * (v2.x * e2.y - v2.y * e2.x)));
  return -sqrt(d.x) * sign(d.y);
}
void main(){
  int kind = int(v_par.y + .5);
  vec2 b = v_box.zw;
  float r = min(v_par.x, min(b.x, b.y));
  vec2 p = v_p;
  float d;
  if (kind == 4) {
    vec2 fp = p * vec2(v_ext.y < 0. ? -1. : 1., v_ext.z < 0. ? -1. : 1.);
    d = sdTri(fp, -b, vec2(b.x, -b.y), vec2(-b.x, b.y));
  } else d = sdBox(p, b, r);
  if (kind == 2) d = abs(d) - v_par.w;
  float aa = u_px;
  vec3 col = v_col.rgb;
  float fill = clamp(.5 - d / (2. * aa), 0., 1.);
  // glow fades to exactly zero before the quad's edge (4.5 radii out), or the quad shows as a box
  float gx0 = max(d, 0.) / max(v_par.z, 1e-3);
  float glow = v_par.z > 0. ? exp(-gx0) * (1. - smoothstep(2.5, 4.4, gx0)) * (1. - fill) : 0.;
  vec3 c;
  if (kind == 1 || kind == 3 || kind == 4) {
    // neon glass: dark tinted body brighter towards the top, a thin bright rim, an inner glow,
    // a bevel highlight along the top edge and a glint sweeping across now and then
    vec2 q = p / b;
    float inside = max(-d, 0.);
    float rim = exp(-inside / (1.2 + aa * 1.5));
    float inner = exp(-inside / 7.);
    vec3 body = col * (.06 + .09 * (q.y * .5 + .5));
    float bevel = smoothstep(.45, .95, q.y) * exp(-inside / 3.) * .5;
    float gx = q.x * .8 + q.y * .35 - (fract(u_time * .12 + v_box.x * .0021 + v_box.y * .0013) * 6. - 3.);
    float glint = exp(-gx * gx * 30.) * .45;
    c = body + col * (rim * 1.7 + inner * .45) + (col * .4 + vec3(.35)) * (bevel + glint);
    if (kind == 3) {
      // hard: a heavy inner frame and rivets; cracks spread as it takes hits
      float frame = abs(sdBox(p, b - 6.5, 3.)) - 1.1;
      c += col * clamp(.5 - frame / (2. * aa), 0., 1.) * 1.1;
      vec2 rv = abs(p) - (b - 6.5);
      c += col * 1.5 * smoothstep(1.8, .8, length(rv));
      float dmg = 1. - v_par.w;
      float cr = abs(fract((q.x * 1.7 + q.y * .9 + sin(q.y * 9. + v_box.x) * .15) * 1.6) - .5);
      float cr2 = abs(fract((q.x * -1.3 + q.y * 1.1 + v_box.y * .01) * 1.3) - .5);
      float crack = (smoothstep(.03, 0., cr) * step(.3, dmg) + smoothstep(.025, 0., cr2) * step(.6, dmg));
      c += vec3(1.6, 1.4, 1.1) * crack * .8;
    }
    c *= fill;
  } else {
    c = col * fill;
  }
  c += col * glow * .6;
  float cover = v_ext.w > .5 ? 0. : fill * v_col.a;
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
uniform float u_zoom;      // camera breathing with the beat (1 = still)
uniform vec2 u_shake;      // px
uniform float u_glitch;    // 0..1 slices shifted sideways (lost ball)
uniform float u_dim;       // 0..1 the Filtr brick: the picture sinks with the sound
uniform float u_theme;     // lo-fi: warmer, grainier
out vec4 o;
vec3 aces(vec3 x){ return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14), 0., 1.); }
void main(){
  vec2 uv = (v_uv - .5) / u_zoom + .5 + u_shake / u_res;
  if (u_glitch > .01) {
    float row = floor(v_uv.y * 38.);
    float n = hash12(vec2(row, floor(u_time * 24.)));
    uv.x += (n - .5) * step(.72, n) * .06 * u_glitch;
  }
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
  c *= 1. - u_dim;
  c += u_tint + vec3(u_flash);
  c = aces(c);
  vec2 q = v_uv - .5;
  c *= 1. - dot(q, q) * .9;
  // faint scanlines
  c *= .96 + .04 * sin(gl_FragCoord.y * 1.7);
  c = pow(max(c, 0.), vec3(1. / 2.2));
  c = mix(c, c * vec3(1.06, 1., .9) + vec3(.012, .008, 0.), u_theme);
  c += (hash12(gl_FragCoord.xy + fract(u_time * 7.3) * 311.) - .5) * mix(.03, .065, u_theme);
  o = vec4(c, 1.);
}`;
