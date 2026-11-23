// Claymation engine. Builds a miniature plasticine set with three.js and renders it frame by frame.
// Runs inside a page served by scripts/lib/clay.mjs. Deterministic: the same timeline and time
// always give the same frame, so frames render offline at any speed and never stutter.
//
//   await window.clay.load({ world, steps, width, height, fps, boil })
//   window.clay.frame(t) -> 'data:image/jpeg;base64,…'   t: ms on the timeline's clock
//
// world: the stage (set, things). steps: [{ index, stage?, actions, camera, start, budget, end }]
// in spec order; steps already shown earlier in the video have start = -Infinity and simply apply.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ---------- small helpers ----------
const TAU = Math.PI * 2;
const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, u) => a + (b - a) * u;
const ease = x => { const p = clamp(x); return p * p * (3 - 2 * p); };
const smoother = x => { const p = clamp(x); return p * p * p * (p * (p * 6 - 15) + 10); };
const backOut = x => { const p = clamp(x); const c = 1.9; return 1 + (c + 1) * (p - 1) ** 3 + c * (p - 1) ** 2; };
// Rises over the first and falls over the last `edge` of an action: gestures that settle back.
const envelope = (p, edge = 0.18) => (p <= 0 || p >= 1 ? 0 : Math.min(1, ease(p / edge), ease((1 - p) / edge)));
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const lerpAngle = (a, b, u) => a + wrap(b - a) * u;
const headingTo = (from, to) => Math.atan2(to.x - from.x, to.z - from.z); // 0 faces the camera (+z)
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function rng(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const hashString = s => [...String(s)].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;

// ---------- colours ----------
export const PALETTE = {
  orange: '#f08a3c', teal: '#35a99a', coral: '#ef6f5e', green: '#5fae3e', blue: '#4f86c6', navy: '#2f4a7a',
  purple: '#8b6fd6', yellow: '#f6c445', pink: '#f49ac1', red: '#d9463b', cream: '#f3dbb5', brown: '#8b5a3c',
  tan: '#c99a5b', grey: '#9aa0a6', gray: '#9aa0a6', white: '#f7f3ea', black: '#2b2522', sky: '#8fc9e8',
};
const colour = (c, fallback) => PALETTE[c] || c || fallback;

// ---------- clay surface ----------
// Plasticine is smooth, with soft fingerprint ridges, gentle dents and the odd tool smear. This
// height map drives a bump map; a second, very faint map mottles the colour like kneaded clay.
function clayCanvas(size = 1024, seed = 7) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const r = rng(seed);
  g.fillStyle = '#808080';
  g.fillRect(0, 0, size, size);
  // Broad, soft dents: blurred blotches.
  g.filter = 'blur(18px)';
  for (let i = 0; i < 90; i++) {
    const v = 110 + r() * 36 | 0;
    g.fillStyle = `rgba(${v},${v},${v},0.55)`;
    g.beginPath();
    g.ellipse(r() * size, r() * size, 20 + r() * 70, 14 + r() * 50, r() * Math.PI, 0, TAU);
    g.fill();
  }
  // Tool smears: soft strokes.
  g.filter = 'blur(2.5px)';
  g.lineCap = 'round';
  for (let i = 0; i < 70; i++) {
    g.strokeStyle = r() < 0.5 ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.09)';
    g.lineWidth = 3 + r() * 9;
    const x = r() * size, y = r() * size, a = r() * TAU, l = 20 + r() * 80;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a + 0.5) * l * 0.6, y + Math.sin(a + 0.5) * l * 0.6, x + Math.cos(a) * l, y + Math.sin(a) * l);
    g.stroke();
  }
  // Fingerprints: fine concentric ridges, slightly blurred so they read as pressed, not drawn.
  g.filter = 'blur(0.8px)';
  for (let k = 0; k < 16; k++) {
    g.save();
    g.translate(r() * size, r() * size);
    g.rotate(r() * Math.PI);
    g.lineWidth = 1.6;
    for (let j = 3; j < 22; j++) {
      g.strokeStyle = j % 2 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.08)';
      g.beginPath();
      g.ellipse(0, 0, j * 2.6, j * 3.5, 0, r() * 0.8, TAU - r() * 1.6);
      g.stroke();
    }
    g.restore();
  }
  g.filter = 'none';
  return c;
}
function mottleCanvas(size = 512, seed = 3) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const r = rng(seed);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, size, size);
  g.filter = 'blur(10px)';
  for (let i = 0; i < 70; i++) {
    const v = 236 + r() * 19 | 0;
    g.fillStyle = `rgba(${v},${v - 2},${v - 5},0.5)`;
    g.beginPath();
    g.arc(r() * size, r() * size, 10 + r() * 40, 0, TAU);
    g.fill();
  }
  g.filter = 'none';
  for (let i = 0; i < 260; i++) { // the odd fleck of dust or another colour
    g.fillStyle = `rgba(60,50,40,${0.05 + r() * 0.08})`;
    g.fillRect(r() * size, r() * size, 1.5, 1.5);
  }
  return c;
}
const clayBase = clayCanvas();
const bump = new THREE.CanvasTexture(clayBase);
bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
bump.repeat.set(1.5, 1.5);
const mottle = new THREE.CanvasTexture(mottleCanvas());
mottle.wrapS = mottle.wrapT = THREE.RepeatWrapping;
mottle.colorSpace = THREE.SRGBColorSpace;
mottle.repeat.set(1.5, 1.5);

// Waxy, soft and mostly matte: a broad sheen and a faint, rough clearcoat, never plastic shine.
const CLAY = { roughness: 0.62, metalness: 0, bumpScale: 2.2, sheen: 0.55, sheenRoughness: 0.45, clearcoat: 0.08, clearcoatRoughness: 0.55 };
const materials = new Map();
function clay(c, extra = null) {
  const key = extra ? null : c;
  if (key && materials.has(key)) return materials.get(key);
  const m = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(c), map: mottle, bumpMap: bump, ...CLAY,
    sheenColor: new THREE.Color(c).lerp(new THREE.Color('#ffffff'), 0.6), ...(extra || {}),
  });
  if (key) materials.set(key, m);
  return m;
}
const glowing = (c, glowColour) => clay(c, { emissive: new THREE.Color(glowColour), emissiveIntensity: 0 });

// Text printed on clay: a label texture, sized to fit, on the item's colour.
const textures = new Map();
function labelTexture(text, { bg, fg = '#fff7e6', w = 256, h = 256, weight = 600, mono = false } = {}) {
  const key = JSON.stringify([text, bg, fg, w, h, weight, mono]);
  if (textures.has(key)) return textures.get(key);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.globalAlpha = 0.22;
  g.globalCompositeOperation = 'overlay';
  g.drawImage(clayBase, 0, 0, w, h);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  const lines = String(text).split('\n');
  const family = mono ? '"SF Mono", Menlo, Consolas, monospace' : 'Fredoka, "Arial Rounded MT Bold", sans-serif';
  let size = Math.min(h * 0.62 / lines.length, h * 0.42);
  g.font = `${weight} ${size}px ${family}`;
  const widest = Math.max(...lines.map(l => g.measureText(l).width), 1);
  size = Math.min(size, size * (w * 0.84) / widest);
  g.font = `${weight} ${size}px ${family}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  lines.forEach((line, i) => {
    const y = h / 2 + (i - (lines.length - 1) / 2) * size * 1.08;
    g.fillStyle = 'rgba(0,0,0,0.22)';
    g.fillText(line, w / 2 + size * 0.04, y + size * 0.05);
    g.fillStyle = fg;
    g.fillText(line, w / 2, y);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  textures.set(key, t);
  return t;
}
function printed(text, bg, fg, opts = {}) {
  return new THREE.MeshPhysicalMaterial({
    map: labelTexture(text, { bg, fg, ...opts }), bumpMap: bump, ...CLAY, bumpScale: 1.6, ...(opts.emissive ? { emissive: new THREE.Color('#ffffff'), emissiveMap: labelTexture(text, { bg, fg, ...opts }), emissiveIntensity: 0 } : {}),
  });
}

// ---------- hand-moulded geometry ----------
function lumpy(geo, amt = 0.03, seed = 1, renormal = true) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  const v = new THREE.Vector3(), nn = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    nn.fromBufferAttribute(n, i);
    const d = amt * (Math.sin(v.x * 7.1 + seed) * Math.sin(v.y * 6.3 + seed * 1.7) * Math.sin(v.z * 5.7 + seed * 2.3)
      + 0.5 * Math.sin(v.x * 13 + v.y * 11 + v.z * 9 + seed * 3));
    v.addScaledVector(nn, d);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  if (renormal && geo.index) geo.computeVertexNormals();
  return geo;
}
const sphere = (r, seed = 1, amt = 0.015) => lumpy(new THREE.SphereGeometry(r, 32, 24), amt * (r / 0.3 + 0.3), seed);
const rbox = (w, h, d, rad = 0.08, seed = 1, amt = 0.012) => lumpy(new RoundedBoxGeometry(w, h, d, 4, Math.min(rad, w / 2, h / 2, d / 2) * 0.999), amt, seed, false);
const capsule = (r, len, seed = 1) => lumpy(new THREE.CapsuleGeometry(r, len, 8, 24), 0.006, seed);
const cylinder = (r1, r2, h, seed = 1, seg = 16) => lumpy(new THREE.CylinderGeometry(r1, r2, h, seg), 0.01, seed);

function mesh(geo, mat, parent, pos = [0, 0, 0]) {
  const m = new THREE.Mesh(geo, typeof mat === 'string' ? clay(mat) : mat);
  m.castShadow = true;
  m.receiveShadow = true;
  m.position.set(...pos);
  parent.add(m);
  return m;
}

// ---------- things ----------
// Each builder returns { group, h (height), r (footprint radius), rig?, glow?: [materials], ... }.
const CHARACTERS = new Set(['robot', 'person']);
const STACKABLE = new Set(['block', 'parcel', 'server']);

function rig(group, { body, limbs, hands, feet, seed, shoes = false, shoulder = 0.4 }) {
  // A shared skeleton: legs and arms pivot at the hips and shoulders; the head is a group.
  const head = new THREE.Group();
  head.position.set(0, 1.38, 0);
  group.add(head);
  const limb = (x, y, len, r, c, parent) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    parent.add(pivot);
    mesh(capsule(r, len, seed + x * 10), c, pivot, [0, -len / 2 - r * 0.3, 0]);
    return pivot;
  };
  const legs = [limb(-0.15, 0.47, 0.22, 0.085, limbs.legs, group), limb(0.15, 0.47, 0.22, 0.085, limbs.legs, group)];
  for (const leg of legs) {
    if (shoes) mesh(rbox(0.17, 0.1, 0.27, 0.05, seed + 3, 0.006), feet, leg, [0, -0.41, 0.05]);
    else mesh(sphere(0.11, seed + 3), feet, leg, [0, -0.4, 0.04]).scale.set(1, 0.55, 1.35);
  }
  const arms = [limb(shoulder, 0.98, 0.26, 0.068, limbs.arms, group), limb(-shoulder, 0.98, 0.26, 0.068, limbs.arms, group)];
  // A shoulder ball joins each arm to the body, so it never looks stuck on.
  if (shoulder < 0.4) for (const arm of arms) mesh(sphere(0.083, seed + 6), limbs.arms, arm, [0, 0, 0]);
  arms.forEach((arm, k) => {
    // Mitten hands with a thumb, as a sculptor would make them.
    const hand = mesh(sphere(0.082, seed + 4), hands, arm, [0, -0.42, 0.005]);
    hand.scale.set(0.82, 1.12, 0.72);
    mesh(sphere(0.034, seed + 5), hands, arm, [(k === 0 ? -1 : 1) * 0.055, -0.39, 0.035]).scale.set(1, 1.3, 1);
  });
  return { head, legs, arms, body };
}
// Eyes with whites, pupils and a catch-light; small brows; a smile. Returns the eyes, for blinking.
function face(head, { seed, ink = '#2b2522', brows = null, cheeks = '#f4a19a', nose = null, z = 0.27, spread = 0.1, y = 0.04 }) {
  const eyes = [];
  for (const side of [-1, 1]) {
    const eye = new THREE.Group();
    eye.position.set(side * spread, y, z - 0.012);
    head.add(eye);
    mesh(sphere(0.062, seed + 7, 0.002), '#fbf8f2', eye).scale.set(1, 1.12, 0.55);
    mesh(sphere(0.032, seed + 8, 0.001), ink, eye, [side * -0.006, -0.006, 0.028]).scale.set(1, 1.1, 0.6);
    mesh(new THREE.SphereGeometry(0.01, 12, 8), '#ffffff', eye, [side * -0.016 + 0.012, 0.012, 0.047]);
    if (brows) {
      const brow = mesh(capsule(0.012, 0.06, seed + 9), brows, head, [side * spread, y + 0.1, z - 0.02]);
      brow.rotation.z = Math.PI / 2 + side * 0.12;
    }
    mesh(sphere(0.042, seed + 10, 0.002), cheeks, head, [side * spread * 1.75, y - 0.11, z - 0.04]).scale.set(1, 0.75, 0.35);
    eyes.push(eye);
  }
  if (nose) mesh(sphere(0.042, seed + 11, 0.003), nose, head, [0, y - 0.06, z + 0.02]).scale.set(1, 0.9, 1);
  const smile = mesh(new THREE.TorusGeometry(0.058, 0.014, 10, 24, Math.PI * 0.9), '#6b2a26', head, [0, y - 0.13, z - 0.005]);
  smile.rotation.z = Math.PI + Math.PI * 0.05;
  smile.scale.set(1, 0.75, 1);
  return eyes;
}
// A person's body: a lathe-turned shape, narrow at the shoulders and soft at the hips.
function torsoGeometry(seed) {
  const pts = [[0, 0], [0.2, 0.006], [0.262, 0.06], [0.272, 0.2], [0.266, 0.36], [0.276, 0.5], [0.262, 0.58], [0.19, 0.635], [0.0, 0.655]]
    .map(([x, y]) => new THREE.Vector2(x, y));
  const geo = new THREE.LatheGeometry(pts, 48);
  geo.scale(1, 1, 0.74);
  return lumpy(geo, 0.006, seed);
}

const BUILD = {
  robot(def, seed) {
    const g = new THREE.Group();
    const body = colour(def.color, PALETTE.orange);
    const accent = colour(def.accent, PALETTE.blue);
    const torso = mesh(rbox(0.66, 0.6, 0.48, 0.2, seed, 0.008), body, g, [0, 0.78, 0]);
    // A chest panel with two buttons and a lamp.
    mesh(rbox(0.34, 0.22, 0.05, 0.06, seed + 1), accent, g, [0, 0.8, 0.245]);
    const lamp = glowing('#ffd35c', '#ffc24a');
    mesh(sphere(0.034, seed + 2), lamp, g, [-0.075, 0.8, 0.28]);
    mesh(sphere(0.034, seed + 3), '#ff6b6b', g, [0.0, 0.8, 0.28]);
    mesh(sphere(0.034, seed + 4), '#7ad06a', g, [0.075, 0.8, 0.28]);
    const parts = rig(g, { body: torso, limbs: { legs: '#d9d2c5', arms: '#d9d2c5' }, hands: body, feet: accent, seed });
    // A rounded head with a dark visor; the eyes glow inside it.
    mesh(rbox(0.6, 0.48, 0.48, 0.2, seed + 5, 0.006), '#f3e7d3', parts.head, [0, 0.02, 0]);
    mesh(rbox(0.46, 0.27, 0.06, 0.11, seed + 6, 0.003), '#22303f', parts.head, [0, 0.02, 0.23]);
    const glow = glowing('#7ff6ff', '#52e8ff');
    glow.emissiveIntensity = 1.4;
    const eyes = [-1, 1].map(side => {
      const eye = new THREE.Group();
      eye.position.set(side * 0.1, 0.04, 0.27);
      parts.head.add(eye);
      mesh(sphere(0.045, seed + 7, 0.001), glow, eye).scale.set(0.85, 1.15, 0.35);
      return eye;
    });
    const smile = mesh(new THREE.TorusGeometry(0.05, 0.011, 8, 20, Math.PI * 0.8), glow, parts.head, [0, -0.04, 0.265]);
    smile.rotation.z = Math.PI + Math.PI * 0.1;
    for (const side of [-1, 1]) mesh(cylinder(0.07, 0.07, 0.07, seed + 8, 20), accent, parts.head, [side * 0.31, 0.02, 0]).rotation.z = Math.PI / 2;
    mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.2, 10), '#8a8f96', parts.head, [0, 0.35, 0]);
    const bulb = glowing('#ff5d5d', '#ff7a5a');
    mesh(sphere(0.055, seed + 9), bulb, parts.head, [0, 0.47, 0]);
    return { group: g, h: 1.9, r: 0.42, rig: { ...parts, eyes }, glow: [lamp, bulb] };
  },
  person(def, seed) {
    const g = new THREE.Group();
    const shirt = colour(def.shirt ?? def.color, PALETTE.teal);
    const skin = colour(def.skin, '#f1c7a5');
    const hair = colour(def.hair, '#5a3a28');
    const torso = mesh(torsoGeometry(seed), shirt, g, [0, 0.46, 0]);
    const parts = rig(g, { body: torso, limbs: { legs: colour(def.pants, PALETTE.navy), arms: shirt }, hands: skin, feet: colour(def.shoes, '#3a3330'), seed, shoes: true, shoulder: 0.31 });
    mesh(cylinder(0.075, 0.085, 0.16, seed + 2, 20), skin, g, [0, 1.12, 0]);
    const collar = mesh(new THREE.TorusGeometry(0.1, 0.03, 10, 28), new THREE.Color(shirt).offsetHSL(0, 0, -0.06).getStyle(), g, [0, 1.07, 0]);
    collar.rotation.x = Math.PI / 2;
    const head = mesh(sphere(0.29, seed + 5, 0.004), skin, parts.head);
    head.scale.set(1, 1.05, 0.97);
    for (const side of [-1, 1]) mesh(sphere(0.055, seed + 12, 0.002), skin, parts.head, [side * 0.285, -0.01, 0]).scale.set(0.5, 1, 0.8);
    // Hair: a dome over the crown, tipped back so the fringe sits above the eyes.
    const dome = lumpy(new THREE.SphereGeometry(0.315, 48, 24, 0, TAU, 0, Math.PI * 0.56), 0.008, seed + 6);
    const cap = mesh(dome, hair, parts.head, [0, 0.03, -0.01]);
    cap.rotation.x = -0.5;
    const style = def.hairStyle || 'short';
    if (style === 'bun') mesh(sphere(0.13, seed + 8), hair, parts.head, [0, 0.34, -0.08]);
    if (style === 'long') mesh(capsule(0.22, 0.3, seed + 9), hair, parts.head, [0, -0.14, -0.13]).scale.z = 0.62;
    if (style === 'curly') for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU;
      mesh(sphere(0.085, seed + 20 + i), hair, parts.head, [Math.sin(a) * 0.25, 0.21 + Math.cos(a * 2) * 0.03, Math.cos(a) * 0.2 - 0.1]);
    }
    const eyes = face(parts.head, { seed, brows: new THREE.Color(hair).offsetHSL(0, 0, -0.08).getStyle(), nose: new THREE.Color(skin).offsetHSL(0, 0.06, -0.06).getStyle(), z: 0.272 });
    return { group: g, h: 1.85, r: 0.4, rig: { ...parts, eyes } };
  },
  block(def, seed) {
    const g = new THREE.Group();
    const s = def.size ?? 0.5;
    const bg = colour(def.color, PALETTE.teal);
    const text = def.label ?? (def.named ? def.id : null);
    mesh(rbox(s, s, s, s * 0.18, seed, 0.012), text ? printed(text, bg, colour(def.text, '#fff7e6')) : clay(bg), g, [0, s / 2, 0]);
    return { group: g, h: s, r: s * 0.72 };
  },
  parcel(def, seed) {
    const g = new THREE.Group();
    const w = def.size ?? 0.55, h = w * 0.78;
    mesh(rbox(w, h, w, 0.06, seed), colour(def.color, PALETTE.tan), g, [0, h / 2, 0]);
    const ribbon = colour(def.ribbon, PALETTE.red);
    mesh(rbox(w * 1.02, h * 1.02, w * 0.16, 0.03, seed + 1), ribbon, g, [0, h / 2, 0]);
    mesh(rbox(w * 0.16, h * 1.02, w * 1.02, 0.03, seed + 2), ribbon, g, [0, h / 2, 0]);
    mesh(sphere(0.07, seed + 3), ribbon, g, [0, h + 0.03, 0]).scale.set(1.6, 0.6, 1);
    if (def.label) mesh(rbox(w * 0.6, h * 0.36, 0.03, 0.02, seed + 4), printed(def.label, '#fff7e6', '#6b3f26', { w: 256, h: 140 }), g, [0, h * 0.42, w / 2 + 0.03]);
    return { group: g, h, r: w * 0.75 };
  },
  house(def, seed) {
    const g = new THREE.Group();
    mesh(rbox(1.6, 1.3, 1.3, 0.14, seed), colour(def.color, '#f3dbb5'), g, [0, 0.65, 0]);
    const roof = mesh(lumpy(new THREE.ConeGeometry(1.3, 0.95, 4, 3), 0.02, seed + 1), colour(def.roof, '#c9553f'), g, [0, 1.77, 0]);
    roof.rotation.y = Math.PI / 4;
    mesh(rbox(0.25, 0.5, 0.25, 0.06, seed + 2), '#a8473a', g, [0.42, 1.95, -0.25]);
    mesh(rbox(0.42, 0.68, 0.1, 0.08, seed + 3), colour(def.door, PALETTE.blue), g, [0, 0.34, 0.66]);
    mesh(sphere(0.035, seed + 4), PALETTE.yellow, g, [0.12, 0.34, 0.72]);
    const light = glowing('#7d9bb8', '#ffb347');
    for (const x of [-0.48, 0.48]) {
      mesh(rbox(0.36, 0.36, 0.08, 0.06, seed + 5), '#8b5a3c', g, [x, 0.88, 0.66]);
      mesh(rbox(0.26, 0.26, 0.06, 0.05, seed + 6), light, g, [x, 0.88, 0.7]);
    }
    if (def.sign) {
      const sign = BUILD.sign({ text: def.sign, color: '#e9c48f' }, seed + 7).group;
      sign.position.set(1.15, 0, 0.8);
      sign.rotation.y = -0.35;
      g.add(sign);
    }
    return { group: g, h: 2.3, r: 1.05, glow: [light], chimney: new THREE.Vector3(0.42, 2.25, -0.25), door: new THREE.Vector3(0, 0, 0.72) };
  },
  server(def, seed) {
    const g = new THREE.Group();
    const c = colour(def.color, '#3b4a63');
    mesh(rbox(0.72, 1.3, 0.62, 0.1, seed), c, g, [0, 0.65, 0]);
    const lights = [];
    for (let i = 0; i < 3; i++) {
      const y = 0.32 + i * 0.27;
      mesh(rbox(0.56, 0.16, 0.04, 0.03, seed + i), new THREE.Color(c).offsetHSL(0, 0, 0.12).getStyle(), g, [0, y, 0.31]);
      const led = glowing('#2d6b45', '#6dff9e');
      mesh(sphere(0.026, seed + 10 + i), led, g, [0.2, y, 0.34]);
      lights.push(led);
    }
    const tag = def.label ?? (def.named ? def.id : null);
    if (tag) mesh(rbox(0.62, 0.3, 0.03, 0.04, seed + 4), printed(tag, '#fff7e6', '#2b2522', { w: 256, h: 124 }), g, [0, 1.1, 0.32]);
    return { group: g, h: 1.3, r: 0.5, glow: lights, blink: lights };
  },
  laptop(def, seed) {
    const g = new THREE.Group();
    const c = colour(def.color, '#b9bec6');
    mesh(rbox(0.8, 0.06, 0.55, 0.03, seed), c, g, [0, 0.03, 0]);
    const lid = new THREE.Group();
    lid.position.set(0, 0.06, -0.26);
    lid.rotation.x = -0.28;
    g.add(lid);
    mesh(rbox(0.8, 0.54, 0.04, 0.03, seed + 1), c, lid, [0, 0.27, 0]);
    const screenMat = printed(def.screen ?? '>_', '#1e2a2f', '#7ef0c8', { w: 320, h: 200, mono: true, weight: 500, emissive: true });
    screenMat.emissiveIntensity = 0.55;
    mesh(new THREE.PlaneGeometry(0.7, 0.44), screenMat, lid, [0, 0.28, 0.022]).castShadow = false;
    return { group: g, h: 0.06, r: 0.48, glow: [screenMat], glowBase: 0.55 };
  },
  cloud(def, seed) {
    const g = new THREE.Group();
    const c = colour(def.color, '#ffffff');
    const r = rng(seed);
    for (const [dx, dy, s] of [[0, 0, 0.45], [0.5, -0.1, 0.35], [-0.5, -0.12, 0.33], [0.2, 0.25, 0.32], [-0.22, 0.18, 0.3]]) {
      mesh(sphere(s, seed + r() * 99, 0.02), c, g, [dx, dy + 0.05, (r() - 0.5) * 0.2]).castShadow = false;
    }
    if (def.label) mesh(rbox(0.9, 0.3, 0.05, 0.05, seed + 4), printed(def.label, '#fff7e6', '#3b5875', { w: 300, h: 100 }), g, [0, -0.1, 0.48]);
    g.traverse(o => { o.castShadow = false; }); // a floating cloud's shadow reads as a stain on the ground
    return { group: g, h: 0.8, r: 0.9, float: def.height ?? 2.6 };
  },
  sign(def, seed) {
    const g = new THREE.Group();
    const text = def.text ?? def.label ?? (def.named ? def.id : '');
    const lines = String(text).split('\n');
    const w = clamp(0.24 + Math.max(...lines.map(l => l.length)) * 0.13, 0.5, 2.2);
    const h = 0.26 + lines.length * 0.14;
    mesh(cylinder(0.05, 0.06, 0.75, seed), PALETTE.brown, g, [0, 0.37, 0]);
    mesh(rbox(w, h, 0.09, 0.05, seed + 1), printed(text, colour(def.color, '#e9c48f'), colour(def.ink, '#6b3f26'), { w: Math.round(256 * w / h), h: 256 }), g, [0, 0.75 + h / 2, 0]);
    return { group: g, h: 0.8 + h, r: Math.max(0.3, w / 2) };
  },
  banner(def, seed) {
    const g = new THREE.Group();
    const text = def.text ?? def.label ?? (def.named ? def.id : '');
    const w = clamp(0.6 + String(text).length * 0.2, 1.6, 4.5);
    for (const x of [-w / 2, w / 2]) mesh(cylinder(0.05, 0.06, 1.7, seed), PALETTE.brown, g, [x, 0.85, 0]);
    mesh(rbox(w, 0.55, 0.06, 0.06, seed + 1), printed(text, colour(def.color, PALETTE.coral), colour(def.ink, '#fff7e6'), { w: Math.round(256 * w / 0.55), h: 256 }), g, [0, 1.35, 0]);
    return { group: g, h: 1.7, r: w / 2 };
  },
  tree(def, seed) {
    const g = new THREE.Group();
    const s = def.size ?? 1;
    const green = colour(def.color, '#5fae4e');
    mesh(cylinder(0.1, 0.14, 0.7, seed, 12), PALETTE.brown, g, [0, 0.35, 0]);
    const shade = d => new THREE.Color(green).offsetHSL(0, 0, d).getStyle();
    mesh(sphere(0.55, seed + 1, 0.04), green, g, [0, 0.95, 0]);
    mesh(sphere(0.42, seed + 2, 0.04), shade(0.05), g, [0.2, 1.35, 0.1]);
    mesh(sphere(0.3, seed + 3, 0.03), shade(0.1), g, [-0.15, 1.65, 0]);
    g.scale.setScalar(s);
    return { group: g, h: 2 * s, r: 0.6 * s };
  },
  rock(def, seed) {
    const g = new THREE.Group();
    const s = def.size ?? 0.35;
    mesh(sphere(s, seed, 0.05), colour(def.color, '#a7a29a'), g, [0, s * 0.45, 0]).scale.set(1.3, 0.75, 1);
    return { group: g, h: s * 0.8, r: s * 1.2 };
  },
  flower(def, seed) {
    const g = new THREE.Group();
    mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.26, 6), '#3f8f3a', g, [0, 0.13, 0]);
    mesh(sphere(0.07, seed), colour(def.color, PALETTE.pink), g, [0, 0.29, 0]).scale.y = 0.7;
    return { group: g, h: 0.34, r: 0.1 };
  },
};
export const KINDS = Object.keys(BUILD);

// ---------- sets ----------
// A painted backdrop: a big dome with a vertical gradient, so there is no hard horizon line.
function skyDome(top, horizon, bottom = horizon) {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 512;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, top);
  grad.addColorStop(0.46, horizon);
  grad.addColorStop(0.5, horizon);
  grad.addColorStop(1, bottom);
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(70, 48, 32), new THREE.MeshBasicMaterial({ map: t, side: THREE.BackSide, fog: false, depthWrite: false }));
  dome.renderOrder = -1;
  return dome;
}

function buildSet(scene, set) {
  const name = typeof set === 'string' ? set : set?.name || set?.set || 'meadow';
  const opts = typeof set === 'object' && set ? set : {};
  const decor = [];
  const add = (kind, def, at) => {
    const t = BUILD[kind](def, hashString(kind + at.join(',')));
    t.group.position.set(at[0], 0, at[1]);
    if (def.rot) t.group.rotation.y = def.rot;
    scene.add(t.group);
    decor.push(t.group);
  };
  const night = name === 'night';
  const studio = name === 'studio';
  if (!['meadow', 'night', 'studio'].includes(name)) throw new Error(`clay: unknown set "${name}". Use meadow, night or studio.`);
  const horizon = colour(opts.sky ?? opts.color, night ? '#3b4374' : studio ? '#f2d4bd' : '#e6efe9');
  const top = night ? '#0c1230' : studio ? new THREE.Color(horizon).offsetHSL(0, 0, -0.07).getStyle() : '#78b3e3';
  scene.background = new THREE.Color(horizon);
  scene.add(skyDome(top, horizon, studio ? horizon : night ? '#1c2440' : '#cfe3c8'));
  scene.fog = new THREE.Fog(horizon, studio ? 12 : 24, studio ? 26 : 80);

  // Light like a miniature set: a big soft key, a cool rim from behind, and a gentle fill.
  scene.add(new THREE.HemisphereLight(night ? '#9eaefc' : '#fff6e8', night ? '#232b45' : '#8a7a62', night ? 0.6 : 0.7));
  const key = new THREE.DirectionalLight(night ? '#c3cdff' : '#ffeed6', night ? 1.6 : 2.5);
  key.position.set(-5, 9, 7);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  Object.assign(key.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 34 });
  key.shadow.radius = 9;
  key.shadow.blurSamples = 20;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  const rim = new THREE.DirectionalLight(night ? '#b79cff' : '#d8ecff', night ? 1.0 : 1.3);
  rim.position.set(6, 5, -8);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(night ? '#6d7dc8' : '#ffe2c8', night ? 0.3 : 0.45);
  fill.position.set(6, 3, 8);
  scene.add(fill);

  const groundColour = colour(opts.ground, night ? '#4a7351' : studio ? new THREE.Color(horizon).offsetHSL(0, 0, -0.04).getStyle() : '#82c062');
  const ground = mesh(new THREE.CylinderGeometry(60, 60, 0.3, 160), clay(groundColour), scene, [0, -0.15, 0]);
  ground.castShadow = false;
  if (studio || opts.decor === false) return decor;

  const r = rng(5);
  // Rolling hills behind the set, in layers, fading into the painted sky.
  const hillGreen = night ? '#38593f' : '#77b65b';
  for (let i = 0; i < 16; i++) {
    const far = i < 8;
    const x = -30 + (i % 8) * 8.5 + r() * 4;
    const z = far ? -24 - r() * 6 : -13 - r() * 4;
    const radius = far ? 9 + r() * 5 : 5 + r() * 3;
    // Smooth, gently lumpy mounds (lumps don't scale with size, so big hills stay soft).
    const hill = mesh(lumpy(new THREE.SphereGeometry(radius, 96, 48), 0.12, 900 + i), clay(new THREE.Color(hillGreen).offsetHSL(r() * 0.03 - 0.015, 0, (far ? 0.05 : 0) + r() * 0.05 - 0.025).getStyle()), scene, [x, -radius * 0.62, z]);
    hill.scale.set(1.5, 1, 0.8);
    hill.castShadow = false;
  }
  // Grass: small clay tufts of a few rounded blades, leaning out, a slightly different green each.
  const blades = [];
  for (let k = 0; k < 4; k++) {
    const blade = new THREE.CapsuleGeometry(0.013, 0.07 + (k % 2) * 0.03, 3, 6);
    blade.translate(0, 0.05, 0);
    blade.rotateZ(0.32);
    blade.rotateY((k / 4) * TAU + 0.4);
    blades.push(blade);
  }
  const tuft = mergeGeometries(blades);
  const grass = new THREE.InstancedMesh(tuft, clay('#ffffff'), 1400);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  for (let i = 0; i < 1400; i++) {
    const a = r() * TAU, d = 1.5 + Math.sqrt(r()) * 13;
    e.set((r() - 0.5) * 0.5, r() * TAU, (r() - 0.5) * 0.5);
    m.compose(new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d * 0.8), q.setFromEuler(e), new THREE.Vector3(1, 0.6 + r() * 0.9, 1));
    grass.setMatrixAt(i, m);
    grass.setColorAt(i, new THREE.Color(groundColour).offsetHSL((r() - 0.5) * 0.04, 0.05, (night ? 0.1 : 0) + (r() - 0.5) * 0.12));
  }
  grass.receiveShadow = true;
  scene.add(grass);

  for (const [x, z, s] of [[-5.2, -2.9, 1], [-2.3, -3.6, 0.85], [1.5, -3.8, 0.8], [4.7, -3.0, 0.95], [6.6, -0.9, 0.9], [-6.8, -0.7, 0.9], [7.5, -3.5, 1.1], [-8, -3.2, 1.05], [-11, -6, 1.3], [10.5, -6.5, 1.25], [3.5, -7.5, 1.1], [-4, -8, 1.2]]) {
    add('tree', { size: s, color: night ? '#3f7a45' : undefined }, [x, z]);
  }
  for (let i = 0; i < 30; i++) {
    const x = -7 + r() * 14, z = 2.6 + r() * 1.8;
    add('flower', { color: ['pink', 'yellow', 'white', 'purple'][r() * 4 | 0] }, [x, z]);
  }
  for (let i = 0; i < 6; i++) add('rock', { size: 0.15 + r() * 0.2 }, [-7 + r() * 14, -1.6 - r() * 1.5]);
  if (night) {
    const moon = mesh(sphere(0.9, 3, 0.02), clay('#fff4c9', { emissive: new THREE.Color('#fff1b0'), emissiveIntensity: 1.1 }), scene, [-9, 10, -30]);
    moon.castShadow = false;
    const stars = new THREE.MeshBasicMaterial({ color: '#fff8dc', fog: false });
    for (let i = 0; i < 90; i++) mesh(new THREE.SphereGeometry(0.06 + r() * 0.05, 6, 4), stars, scene, [-40 + r() * 80, 6 + r() * 18, -34 - r() * 6]).castShadow = false;
  } else {
    const sun = mesh(sphere(1.1, 60, 0.02), clay('#ffd35c', { emissive: new THREE.Color('#ffb52e'), emissiveIntensity: 0.5 }), scene, [-12, 11, -32]);
    sun.scale.z = 0.3;
    sun.castShadow = false;
    for (const [x, y, z] of [[-4, 7.5, -22], [7, 6.8, -24], [16, 8.5, -30], [-17, 6.5, -26]]) {
      const c = BUILD.cloud({}, hashString(`sky${x}`)).group;
      c.position.set(x, y, z);
      c.scale.setScalar(2.2);
      scene.add(c);
      decor.push(c);
    }
  }
  return decor;
}

// ---------- the stage: things and their state ----------
function parseThing(def, n) {
  const kind = KINDS.find(k => k in def);
  if (!kind) throw new Error(`clay: unknown thing ${JSON.stringify(def)}. Kinds: ${KINDS.join(', ')}`);
  const value = def[kind];
  const named = typeof value === 'string';
  const id = named ? value : def.id || `${kind}${n}`;
  return { ...def, kind, id, named };
}

// One built world per stage: the opening stage, and each step that sets a new one.
const WORLDS = new Map(); // key -> { scene, built: Map(id -> thing), decor, bubbles }
let world = null;          // the world being rendered
const built = st => WORLDS.get(st.sk).built.get(st.id);
const size = st => built(st);

function initialState(stage, sk) {
  const S = { things: new Map(), order: [], sk };
  (stage.things || []).forEach((raw, n) => {
    const def = parseThing(raw, n);
    if (S.things.has(def.id)) throw new Error(`clay: two things are called "${def.id}"`);
    const st = {
      id: def.id, kind: def.kind, sk, def, x: 0, z: 0, y: 0, rot: 0, scale: 1, visible: !def.hidden,
      on: null, carriedBy: null, carrying: null, carry: 0, glow: def.glow ? 1 : 0, look: null, bubble: null, smoke: null, anim: {},
    };
    if (def.on) {
      const base = S.things.get(def.on);
      if (!base) throw new Error(`clay: "${def.id}" is on "${def.on}", which must be listed before it`);
      const top = topOf(S, base);
      Object.assign(st, { x: top.x, z: top.z, y: top.y + size(top).h, on: top.id });
    } else if (Array.isArray(def.at)) {
      [st.x, st.z] = def.at;
    } else {
      throw new Error(`clay: "${def.id}" needs at: [x, z] or on: 'id'`);
    }
    S.things.set(def.id, st);
    S.order.push(def.id);
  });
  for (const st of S.things.values()) st.rot = facing(S, st, st.def.face ?? (CHARACTERS.has(st.kind) ? 'camera' : 0));
  return S;
}
const clone = S => ({ things: new Map([...S.things].map(([k, v]) => [k, { ...v, anim: { ...v.anim } }])), order: S.order, sk: S.sk });

function topOf(S, st) {
  let top = st;
  for (let guard = 0; guard < 50; guard++) {
    const above = [...S.things.values()].find(o => o.on === top.id && !o.carriedBy && o.visible);
    if (!above) return top;
    top = above;
  }
  return top;
}
function facing(S, st, f) {
  if (f === 'camera' || f === 'front') return 0;
  if (f === 'back') return Math.PI;
  if (f === 'left') return -Math.PI / 2;
  if (f === 'right') return Math.PI / 2;
  if (typeof f === 'number') return (f * Math.PI) / 180;
  if (Array.isArray(f)) return headingTo(st, { x: f[0], z: f[1] });
  const other = S.things.get(f);
  if (!other) throw new Error(`clay: cannot face "${f}": no such thing`);
  return headingTo(st, other);
}
const point = (S, ref) => {
  if (Array.isArray(ref)) return { x: ref[0], z: ref[1] };
  const t = S.things.get(ref);
  if (!t) throw new Error(`clay: no thing called "${ref}"`);
  return t;
};
// Where hands hold things: in front of the chest, turning with the body.
const HAND = { forward: 0.55, height: 0.95 };
const handAt = (who, h = 0.5) => ({ x: who.x + Math.sin(who.rot) * HAND.forward, z: who.z + Math.cos(who.rot) * HAND.forward, y: who.y + HAND.height - h / 2 });

// ---------- actions ----------
// Each verb plans against the state at its start: { weight, run(S, p, slot) }. run applies the action
// at progress p (0..1) to a state that already holds everything before it.
const need = (S, id, verb, kinds) => {
  const t = S.things.get(id);
  if (!t) throw new Error(`clay: ${verb}: no thing called "${id}"`);
  if (kinds && !kinds.has(t.kind)) throw new Error(`clay: ${verb}: "${id}" is a ${t.kind}; it needs a character (robot or person)`);
  return t;
};
const unit = (from, to) => { const d = Math.hypot(to.x - from.x, to.z - from.z) || 1; return { x: (to.x - from.x) / d, z: (to.z - from.z) / d }; };
const minus = (p, dir, k) => ({ x: p.x - dir.x * k, z: p.z - dir.z * k });

// Walks a character from where it stands to `dest`, turning first; optionally faces `end` after.
function walkPlan(who, dest, endRot = null) {
  const d = distance(who, dest);
  const heading = d > 0.05 ? headingTo(who, dest) : who.rot;
  const turn = Math.abs(wrap(heading - who.rot));
  const finalTurn = endRot === null ? 0 : Math.abs(wrap(endRot - heading));
  const seconds = (d > 0.05 ? 0.25 + d / 1.7 : 0) + turn * 0.18 + finalTurn * 0.15;
  return {
    seconds,
    run(st, p) {
      const x0 = st.x, z0 = st.z, r0 = st.rot;
      const total = Math.max(seconds, 1e-3);
      const ft = (turn * 0.18) / total, fe = (finalTurn * 0.15) / total;
      if (p < ft) { st.rot = lerpAngle(r0, heading, smoother(p / ft)); return; }
      st.rot = heading;
      const q = clamp((p - ft) / Math.max(1 - ft - fe, 1e-3));
      if (d > 0.05) {
        if (q > 0) st.look = null;
        const s = q - Math.sin(TAU * q) / TAU; // eases in and out, steady in the middle
        st.x = lerp(x0, dest.x, s);
        st.z = lerp(z0, dest.z, s);
        if (q > 0 && q < 1) st.anim.gait = { phase: s * d * 5.2, amount: Math.min(1, q * 6, (1 - q) * 6) };
      }
      if (q >= 1 && endRot !== null) st.rot = lerpAngle(heading, endRot, smoother((p - (1 - fe)) / Math.max(fe, 1e-3)));
    },
  };
}

// Where a carried thing goes: a point on the ground, on top of a stack, beside or into something.
function dropAt(S, item, from, a) {
  const to = a.into ?? a.to;
  if (to === undefined) throw new Error(`clay: carry "${item.id}" needs to: [x, z], to: 'id' or into: 'id'`);
  if (Array.isArray(to)) {
    const p = { x: to[0], z: to[1] };
    return { stand: minus(p, unit(from, p), HAND.forward), place: { ...p, y: 0, on: null } };
  }
  const target = point(S, to);
  if (CHARACTERS.has(target.kind)) throw new Error(`clay: carry "${item.id}" to a character is not supported; carry it next to them instead`);
  const dir = unit(from, target);
  if (a.into) {
    const b = built(target);
    if (b.float !== undefined) {
      // Into something floating, such as a cloud: rise up into its middle.
      return { stand: minus(target, dir, HAND.forward + 0.3), place: { x: target.x, z: target.z, y: b.float, on: null }, into: true };
    }
    const door = b.door ? { x: target.x + Math.sin(target.rot) * b.door.z, z: target.z + Math.cos(target.rot) * b.door.z } : minus(target, dir, size(target).r);
    const out = b.door ? { x: Math.sin(target.rot), z: Math.cos(target.rot) } : { x: -dir.x, z: -dir.z };
    return { stand: { x: door.x + out.x * (HAND.forward + 0.1), z: door.z + out.z * (HAND.forward + 0.1) }, place: { ...door, y: 0, on: null }, into: true };
  }
  if (built(target).float !== undefined) throw new Error(`clay: "${target.id}" floats; use into: '${target.id}' to send things into it`);
  if (STACKABLE.has(target.kind) && !a.side) {
    const top = topOf(S, target);
    return { stand: minus(top, dir, HAND.forward), place: { x: top.x, z: top.z, y: top.y + size(top).h, on: top.id } };
  }
  const sides = { left: { x: -1, z: 0 }, right: { x: 1, z: 0 }, front: { x: 0, z: 1 }, back: { x: 0, z: -1 } };
  const away = a.side ? sides[a.side] : { x: -dir.x, z: -dir.z };
  if (!away) throw new Error(`clay: side must be left, right, front or back (got "${a.side}")`);
  const p = { x: target.x + away.x * (size(target).r + size(item).r + 0.15), z: target.z + away.z * (size(target).r + size(item).r + 0.15) };
  return { stand: minus(p, unit(from, p), HAND.forward), place: { ...p, y: 0, on: null } };
}

function liftPlan(who, item) {
  return {
    seconds: 0.5,
    run(S, p) {
      const it = S.things.get(item.id), me = S.things.get(who.id);
      const h = size(it).h;
      const hand = handAt(me, h);
      const k = smoother(p);
      it.x = lerp(item.x, hand.x, k); it.z = lerp(item.z, hand.z, k);
      it.y = lerp(item.y, hand.y, k) + Math.sin(Math.PI * k) * 0.12;
      it.rot = lerpAngle(item.rot, me.rot, k);
      me.carry = k;
      if (p >= 1) Object.assign(it, { carriedBy: me.id, on: null }), (me.carrying = it.id);
    },
  };
}
function putPlan(who, item, place) {
  return {
    seconds: 0.5,
    run(S, p) {
      const it = S.things.get(item.id), me = S.things.get(who.id);
      const hand = handAt(me, size(it).h);
      const k = smoother(p);
      it.carriedBy = null;
      it.x = lerp(hand.x, place.x, k); it.z = lerp(hand.z, place.z, k);
      it.y = lerp(hand.y, place.y, k) + Math.sin(Math.PI * k) * 0.1;
      if (place.into) it.scale = 1 - smoother((p - 0.35) / 0.65);
      me.carry = 1 - k;
      if (p >= 1) {
        Object.assign(it, { x: place.x, z: place.z, y: place.y, on: place.on, carriedBy: null });
        if (place.into) Object.assign(it, { visible: false, scale: 1 });
        me.carrying = null;
      }
    },
  };
}
// Runs sub-plans one after another, sharing p by their seconds.
function sequence(parts) {
  const total = parts.reduce((s, x) => s + x.seconds, 0) || 1;
  return (S, p) => {
    let acc = 0;
    for (const part of parts) {
      const share = part.seconds / total;
      if (p < acc) break;
      part.run(S, clamp((p - acc) / Math.max(share, 1e-6)));
      acc += share;
    }
  };
}
const forThing = (S, id, run) => (S2, p) => run(S2.things.get(id), p, S2);

const GESTURE = { wave: 1.1, hop: 0.9, cheer: 1, nod: 0.8, shake: 0.9, point: 1.1, shrug: 0.9, think: 1.2 };
const VERBS = {
  walk(S, a) {
    const who = need(S, a.walk, 'walk', CHARACTERS);
    let dest;
    if (Array.isArray(a.to)) dest = { x: a.to[0], z: a.to[1] };
    else {
      const t = point(S, a.to);
      dest = minus(t, unit(who, t), size(t).r + size(who).r + 0.12);
    }
    const end = a.face !== undefined ? facing(S, { ...who, ...dest }, a.face) : null;
    const plan = walkPlan(who, dest, end);
    return { weight: 0.3 + plan.seconds * 0.8, needs: plan.seconds, run: forThing(S, who.id, (st, p) => plan.run(st, p)) };
  },
  carry(S, a) {
    const item = need(S, a.carry, 'carry');
    const who = need(S, a.by, 'carry', CHARACTERS);
    const sim = clone(S);
    const parts = [];
    if (item.carriedBy !== who.id) {
      const dir = unit(who, item);
      const stand = minus(item, dir, HAND.forward);
      const w1 = walkPlan(who, stand, headingTo(stand, item));
      parts.push({ seconds: w1.seconds, run: (S2, p) => w1.run(S2.things.get(who.id), p) });
      w1.run(sim.things.get(who.id), 1);
      const lift = liftPlan(sim.things.get(who.id), sim.things.get(item.id));
      parts.push(lift);
      lift.run(sim, 1);
    }
    const me = sim.things.get(who.id);
    const drop = dropAt(sim, sim.things.get(item.id), me, a);
    const dest = drop.stand;
    const w2 = walkPlan(me, dest, headingTo(dest, drop.place));
    parts.push({ seconds: w2.seconds, run: (S2, p) => w2.run(S2.things.get(who.id), p) });
    w2.run(me, 1);
    parts.push(putPlan(me, sim.things.get(item.id), { ...drop.place, into: drop.into }));
    const total = parts.reduce((s, x) => s + x.seconds, 0);
    return { weight: 0.4 + total * 0.8, needs: total, run: sequence(parts) };
  },
  pick(S, a) {
    const item = need(S, a.pick, 'pick');
    const who = need(S, a.by, 'pick', CHARACTERS);
    const stand = minus(item, unit(who, item), HAND.forward);
    const w = walkPlan(who, stand, headingTo(stand, item));
    const sim = clone(S);
    w.run(sim.things.get(who.id), 1);
    const lift = liftPlan(sim.things.get(who.id), item);
    const parts = [{ seconds: w.seconds, run: (S2, p) => w.run(S2.things.get(who.id), p) }, lift];
    return { weight: 0.4 + (w.seconds + 0.5) * 0.8, needs: w.seconds + 0.5, run: sequence(parts) };
  },
  place(S, a) {
    const item = need(S, a.place, 'place');
    const who = need(S, a.by ?? item.carriedBy, 'place', CHARACTERS);
    if (item.carriedBy !== who.id) throw new Error(`clay: place "${item.id}": ${who.id} is not carrying it`);
    const drop = dropAt(S, item, who, { ...a, to: a.on ?? a.to ?? a.at });
    const w = walkPlan(who, drop.stand, headingTo(drop.stand, drop.place));
    const sim = clone(S);
    w.run(sim.things.get(who.id), 1);
    const put = putPlan(sim.things.get(who.id), item, { ...drop.place, into: drop.into });
    return { weight: 0.4 + (w.seconds + 0.5) * 0.8, needs: w.seconds + 0.5, run: sequence([{ seconds: w.seconds, run: (S2, p) => w.run(S2.things.get(who.id), p) }, put]) };
  },
  turn(S, a) {
    const who = need(S, a.turn, 'turn');
    const to = facing(S, who, a.to ?? a.face ?? 'camera');
    return { weight: 0.5, run: forThing(S, who.id, (st, p) => { st.rot = lerpAngle(who.rot, to, smoother(p)); }) };
  },
  look(S, a) {
    const who = need(S, a.look, 'look', CHARACTERS);
    const target = a.at ?? 'camera';
    return { weight: 0.5, run: forThing(S, who.id, (st, p) => { if (p >= 1) st.look = target; else st.anim.lookTo = { target, p: smoother(p) }; }) };
  },
  bubble(S, a, step) {
    const who = need(S, a.bubble, 'bubble');
    return {
      weight: 0.4,
      run: (S2, p, slot) => {
        const st = S2.things.get(who.id);
        // On screen to the end of the step, and long enough to read even if it comes late in the line.
        st.bubble = a.text ? { text: a.text, side: a.side, from: slot.start, until: a.keep ? Infinity : Math.max(step.end, slot.start + 2600) } : null;
      },
    };
  },
  appear(S, a) {
    const it = need(S, a.appear, 'appear');
    return { weight: 0.6, run: forThing(S, it.id, (st, p) => { st.visible = true; st.scale = backOut(p); }) };
  },
  vanish(S, a) {
    const it = need(S, a.vanish, 'vanish');
    return { weight: 0.6, run: forThing(S, it.id, (st, p) => { st.scale = 1 - smoother(p); if (p >= 1) Object.assign(st, { visible: false, scale: 1 }); }) };
  },
  glow(S, a) {
    const it = need(S, a.glow, 'glow');
    const to = a.off ? 0 : (a.amount ?? 1);
    return { weight: 0.7, run: forThing(S, it.id, (st, p) => { st.glow = lerp(it.glow, to, smoother(p)); }) };
  },
  dim(S, a) { return VERBS.glow(S, { glow: a.dim, off: true }); },
  smoke(S, a) {
    const it = need(S, a.smoke, 'smoke');
    if (!built(it).chimney) throw new Error(`clay: smoke needs a house (got ${it.kind} "${it.id}")`);
    return { weight: 1.4, run: (S2, p, slot) => { S2.things.get(it.id).smoke = { from: slot.start, to: slot.end }; } };
  },
  move(S, a) {
    const it = need(S, a.move, 'move');
    if (CHARACTERS.has(it.kind)) throw new Error(`clay: move slides props; use walk for "${it.id}"`);
    if (a.to === undefined && a.on === undefined && a.into === undefined) throw new Error(`clay: move "${it.id}" needs to: [x, z], on: 'id' or into: 'id'`);
    const drop = dropAt(S, it, it, { to: a.on ?? a.to, into: a.into, side: a.side });
    const place = drop.place;
    const lift = a.arc ?? (distance(it, place) > 1 ? 0.7 : 0.25);
    const y = it.y;
    return {
      weight: 0.5 + distance(it, place) * 0.35,
      needs: 0.3 + distance(it, place) / 2.5,
      run: forThing(S, it.id, (st, p) => {
        const k = smoother(p);
        st.x = lerp(it.x, place.x, k); st.z = lerp(it.z, place.z, k);
        st.y = lerp(y, place.y, k) + Math.sin(Math.PI * k) * lift;
        st.on = p >= 1 ? place.on : null;
        if (drop.into) st.scale = 1 - smoother((p - 0.55) / 0.45);
        if (drop.into && p >= 1) Object.assign(st, { visible: false, scale: 1 });
      }),
    };
  },
  spin(S, a) {
    const it = need(S, a.spin, 'spin');
    return { weight: 0.8, run: forThing(S, it.id, (st, p) => { st.rot = it.rot + TAU * (a.turns ?? 1) * smoother(p); }) };
  },
  wait(S, a) { return { weight: typeof a.wait === 'number' ? a.wait : 1, run: () => {} }; },
  ...Object.fromEntries(Object.entries(GESTURE).map(([verb, weight]) => [verb, (S, a) => {
    const who = need(S, a[verb], verb, CHARACTERS);
    const target = a.at ?? a.to;
    const turnTo = verb === 'point' && target !== undefined ? facing(S, who, target) : null;
    return {
      weight: verb === 'hop' ? 0.4 + (a.times ?? 2) * 0.35 : weight,
      run: forThing(S, who.id, (st, p) => {
        if (turnTo !== null) st.rot = lerpAngle(who.rot, turnTo, smoother(p / 0.25));
        if (p > 0 && p < 1) st.anim[verb] = { p, times: a.times ?? 2 };
      }),
    };
  }])),
};
export const ACTIONS = Object.keys(VERBS);
const verbOf = a => ACTIONS.find(v => v in a) || (() => { throw new Error(`clay: unknown action ${JSON.stringify(a)}. Actions: ${ACTIONS.join(', ')}`); })();

// ---------- timeline ----------
let TL = null;          // { world, steps, fps, boil }
const plans = new Map(); // step index -> slots, planned once against the state at that step's start
const rushed = new Map(); // step index -> warnings: walks and carries squeezed into too little time

function slotsFor(step, S) {
  if (plans.has(step.index)) return plans.get(step.index);
  const sim = clone(S);
  const groups = [];
  for (const a of step.actions) {
    let plan;
    try {
      plan = VERBS[verbOf(a)](sim, a, step);
      plan.verb = verbOf(a);
      plan.who = a[plan.verb];
      // Plan the next action against the state this one leaves behind.
      plan.run(sim, 1, { start: step.start, end: step.start });
    } catch (e) {
      throw new Error(`clay: step ${step.index + 1}: ${e.message.replace(/^clay: /, '')}`);
    }
    if (a.with && groups.length) groups.at(-1).push(plan);
    else groups.push([plan]);
  }
  const weights = groups.map(g => Math.max(...g.map(p => p.weight)));
  const total = weights.reduce((s, w) => s + w, 0) || 1;
  let at = step.start;
  const slots = [];
  groups.forEach((g, i) => {
    const length = step.budget * (weights[i] / total);
    for (const plan of g) slots.push({ plan, start: at, end: at + length });
    at += length;
  });
  // Characters can only move so fast: flag moves that get much less time than they need.
  if (Number.isFinite(step.start)) {
    const notes = slots.filter(sl => sl.plan.needs && (sl.end - sl.start) / 1000 < sl.plan.needs * 0.6).map(sl =>
      `${sl.plan.verb} ${sl.plan.who} is rushed: it needs about ${sl.plan.needs.toFixed(1)}s and gets ${((sl.end - sl.start) / 1000).toFixed(1)}s. Lengthen the line or split the step.`);
    if (notes.length) rushed.set(step.index, notes);
  }
  plans.set(step.index, slots);
  return slots;
}

// Where everything is when a step starts and when it ends: what a wide shot of that step frames.
const extents = new Map();
function extentFor(step, S, slots) {
  if (extents.has(step.index)) return extents.get(step.index);
  const end = clone(S);
  for (const slot of slots) slot.plan.run(end, 1, slot);
  const e = [clone(S), end];
  extents.set(step.index, e);
  return e;
}

const stageOf = step => ({ ...TL.world, ...step.stage, things: step.stage.things ?? TL.world.things });
// The camera holds a shot per step. Close-ups follow their subjects; wide shots frame every thing
// where it is at the start and end of the step, then hold still while things move.
const isWide = spec => !spec || spec === 'wide' || (typeof spec === 'object' && !Array.isArray(spec) && !spec.on);
function stateAt(t) {
  let sk = 'world';
  let S = initialState(TL.world, sk);
  let camera = { spec: TL.world.camera ?? 'wide', from: null, start: -Infinity, ms: 0, extent: [clone(S)], cut: true };
  for (const step of TL.steps) {
    if (t < step.start) break;
    if (step.stage) {
      sk = `stage${step.index}`;
      S = initialState(stageOf(step), sk);
    }
    const slots = slotsFor(step, S);
    const spec = step.camera ?? (step.stage ? step.stage.camera ?? 'wide' : camera.spec);
    if (step.stage || step.camera !== undefined || isWide(spec)) {
      camera = {
        spec, from: step.stage ? null : camera, start: step.start, cut: Boolean(step.stage),
        ms: Math.min(1500, Math.max(600, step.budget * 0.5)), extent: extentFor(step, S, slots),
      };
    }
    for (const slot of slots) {
      if (t < slot.start) continue;
      const p = slot.end > slot.start ? clamp((t - slot.start) / (slot.end - slot.start)) : 1;
      slot.plan.run(S, p, slot);
    }
  }
  return { S, camera, sk };
}

// ---------- the world in three.js ----------
let renderer, cam, W, H, composer, passes, out;

// The finishing pass: a soft vignette and a whisper of grain, like a lens on a real set.
const FINISH = {
  uniforms: { tDiffuse: { value: null }, seed: { value: 0 }, vignette: { value: 0.22 }, grain: { value: 0.016 }, contrast: { value: 1.06 }, saturation: { value: 1.12 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float seed, vignette, grain, contrast, saturation; varying vec2 vUv;
    float rand(vec2 c) { return fract(sin(dot(c + seed, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(vec3(l), c.rgb, saturation);
      c.rgb = (c.rgb - 0.5) * contrast + 0.5;
      vec2 d = vUv - 0.5; d.x *= 1.25;
      c.rgb *= 1.0 - vignette * smoothstep(0.25, 0.85, length(d));
      c.rgb += (rand(vUv * 1000.0) - 0.5) * grain;
      gl_FragColor = c;
    }`,
};
// Ambient occlusion darkens creases and where things touch; a shallow depth of field makes the set
// read as a miniature. Rendered larger than the output and scaled down, for clean edges.
const SUPERSAMPLE = 1.5;
function setupComposer() {
  composer = new EffectComposer(renderer);
  const render = new RenderPass(new THREE.Scene(), cam);
  const ao = new GTAOPass(new THREE.Scene(), cam, W * SUPERSAMPLE, H * SUPERSAMPLE);
  ao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.4, thickness: 1.2, scale: 1.1, samples: 16 });
  ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
  ao.blendIntensity = 0.85;
  const bokeh = new BokehPass(new THREE.Scene(), cam, { focus: 8, aperture: 0.0014, maxblur: 0.0055 });
  const finish = new ShaderPass(FINISH);
  composer.addPass(render);
  composer.addPass(ao);
  composer.addPass(bokeh);
  composer.addPass(new OutputPass());
  composer.addPass(finish);
  passes = { render, ao, bokeh, finish };
}

function buildWorld(stage, key) {
  const scene = new THREE.Scene();
  const things = new Map();
  const decor = buildSet(scene, stage.set ?? 'meadow');
  (stage.things || []).forEach((raw, n) => {
    const def = parseThing(raw, n);
    if (things.has(def.id)) throw new Error(`clay: two things are called "${def.id}"`);
    const b = BUILD[def.kind](def, hashString(def.id));
    b.def = def;
    scene.add(b.group);
    things.set(def.id, b);
    if (b.chimney) b.puffs = Array.from({ length: 6 }, (_, i) => { const p = mesh(sphere(1, 80 + i, 0.06), clay('#f4f1ec'), scene); p.castShadow = false; p.visible = false; return p; });
  });
  WORLDS.set(key, { scene, built: things, decor, bubbles: new Map() });
}

function bubbleFor(id, text) {
  const { bubbles, scene } = world;
  const key = `${id}\u0000${text}`;
  if (bubbles.has(key)) return bubbles.get(key);
  const g = new THREE.Group();
  const lines = String(text).split('\n');
  const w = clamp(0.5 + Math.max(...lines.map(l => l.length)) * 0.11, 0.9, 2.6);
  const h = 0.34 + lines.length * 0.2;
  mesh(rbox(w, h, 0.12, 0.12, hashString(text)), printed(text, '#fffaf0', '#2b2522', { w: Math.round(256 * w / h), h: 256 }), g, [0, h / 2, 0]);
  const tail = mesh(lumpy(new THREE.ConeGeometry(0.1, 0.24, 12), 0.005, 3), '#fffaf0', g, [-w * 0.22, -0.06, 0]);
  tail.rotation.z = Math.PI + 0.35;
  g.traverse(o => { o.castShadow = false; });
  g.userData.w = w;
  g.visible = false;
  scene.add(g);
  bubbles.set(key, g);
  return g;
}

// Frames the camera on things: a close-up, a group, or the whole stage.
function framing(spec, S, extent) {
  const o = typeof spec === 'string' ? (spec === 'wide' ? { wide: true } : { on: spec }) : Array.isArray(spec) ? { on: spec } : { ...spec };
  const ids = o.wide || !o.on ? null : [].concat(o.on);
  const list = ids ? ids.map(id => S.things.get(id) || (() => { throw new Error(`clay: camera on "${id}": no such thing`); })())
    : extent.flatMap(E => [...E.things.values()].filter(t => t.visible));
  const box = { x0: Infinity, x1: -Infinity, y0: 0, y1: -Infinity, z0: Infinity, z1: -Infinity };
  for (const t of list) {
    const b = built(t);
    const y = t.carriedBy ? 0.95 : (b.float ?? t.y);
    box.x0 = Math.min(box.x0, t.x - b.r); box.x1 = Math.max(box.x1, t.x + b.r);
    box.z0 = Math.min(box.z0, t.z - b.r); box.z1 = Math.max(box.z1, t.z + b.r);
    box.y1 = Math.max(box.y1, y + b.h + (CHARACTERS.has(t.kind) && t.bubble ? 0.9 : 0) + (t.smoke ? 1.2 : 0));
  }
  if (!list.length) Object.assign(box, { x0: -3, x1: 3, z0: -1, z1: 1, y1: 2 });
  const cx = (box.x0 + box.x1) / 2, cz = (box.z0 + box.z1) / 2;
  const spanX = box.x1 - box.x0, spanY = box.y1 - box.y0;
  const aspect = W / H;
  const vfov = THREE.MathUtils.degToRad(30);
  const margin = ids ? 0.35 : 0.55;
  const halfW = Math.max(spanX / 2 + margin, (spanY / 2 + margin) * aspect * 0.92, ids ? 1.25 : 2.6);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
  const dist = (halfW / Math.tan(hfov / 2)) / (o.zoom ?? 1) + Math.max(0, box.z1 - cz);
  const yaw = THREE.MathUtils.degToRad(o.yaw ?? o.angle ?? 0);
  // Wide shots look down a little more, like a camera over a tabletop set: more floor, less sky.
  const pitch = THREE.MathUtils.degToRad(o.pitch ?? (ids ? 10 : 18));
  // Look slightly below centre so subjects sit above the captions.
  const target = new THREE.Vector3(cx, spanY * (ids ? 0.4 : 0.34), cz);
  const pos = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(dist).add(target);
  return { pos, target };
}
function cameraAt(camera, S, t) {
  const here = framing(camera.spec, S, camera.extent);
  if (!camera.from || camera.cut) return here;
  const k = smoother((t - camera.start) / camera.ms);
  if (k >= 1) return here;
  const before = cameraAt(camera.from, S, t);
  return { pos: before.pos.clone().lerp(here.pos, k), target: before.target.clone().lerp(here.target, k) };
}

function pose(b, st, t, S) {
  const g = b.group;
  const a = st.anim;
  const seed = hashString(st.id) % 1000;
  const r = b.rig;
  let lift = 0;
  if (r) {
    const gait = a.gait || { phase: 0, amount: 0 };
    const sw = Math.sin(gait.phase);
    r.legs[0].rotation.x = sw * 0.6 * gait.amount;
    r.legs[1].rotation.x = -sw * 0.6 * gait.amount;
    lift += Math.abs(sw) * 0.06 * gait.amount;
    const carry = st.carry;
    r.arms.forEach((arm, k) => {
      const side = k === 0 ? 1 : -1; // 0: the character's left (+x), 1: right
      let x = (k === 0 ? -1 : 1) * sw * 0.5 * gait.amount * (1 - carry) - 1.2 * carry;
      let z = -side * 0.35 * carry;
      if (a.wave && k === 0) { const e = envelope(a.wave.p); z = lerp(z, 2.3 + Math.sin(t * 0.018) * 0.4, e); x = lerp(x, 0, e); }
      if (a.cheer) { const e = envelope(a.cheer.p); z = lerp(z, side * 2.6, e); x = lerp(x, 0, e); }
      if (a.point && k === 0) { const e = envelope(a.point.p, 0.25); x = lerp(x, -1.45, e); z = lerp(z, 0.15, e); }
      if (a.shrug) { const e = envelope(a.shrug.p, 0.3); z = lerp(z, side * 0.9, e); x = lerp(x, -0.5, e); }
      if (a.think && k === 1) { const e = envelope(a.think.p, 0.25); x = lerp(x, -2.3, e); z = lerp(z, 0.75, e); }
      arm.rotation.set(x, 0, z);
    });
    // Head: idle tilt, gestures, and where it is looking.
    const lookAt = target => {
      if (target === 'camera') return -st.rot;
      const p = S.things.get(target) || (Array.isArray(target) ? { x: target[0], z: target[1] } : null);
      return p ? wrap(headingTo(st, p) - st.rot) : 0;
    };
    let yaw = st.look ? lookAt(st.look) : 0;
    if (a.lookTo) yaw = lerp(yaw, lookAt(a.lookTo.target), a.lookTo.p);
    yaw = clamp(yaw, -1.0, 1.0);
    const nod = a.nod ? Math.sin(a.nod.p * Math.PI * 4) * 0.25 * envelope(a.nod.p) : 0;
    const shake = a.shake ? Math.sin(a.shake.p * Math.PI * 6) * 0.35 * envelope(a.shake.p) : 0;
    const think = a.think ? envelope(a.think.p, 0.25) * 0.2 : 0;
    r.head.rotation.set(nod + carry * 0.25 - think * 0.5, yaw + shake, Math.sin(t * 0.0021 + seed) * 0.07 + think);
    const blink = ((t + seed * 37) % 3700) < 110;
    for (const e of r.eyes) e.scale.y = blink ? 0.15 : 1;
    // Hops and celebration bounces, with a squash on landing.
    let squash = 0;
    if (a.hop) { const n = a.hop.times; const ph = (a.hop.p * n) % 1; lift += Math.sin(Math.PI * ph) * 0.3; squash = ph < 0.12 || ph > 0.88 ? 1 : 0; }
    if (a.cheer) lift += Math.abs(Math.sin(a.cheer.p * Math.PI * 3)) * 0.12 * envelope(a.cheer.p);
    const breathe = 1 + Math.sin(t * 0.003 + seed) * 0.012;
    r.body.scale.set(1 + 0.08 * squash, breathe - 0.1 * squash, 1 + 0.08 * squash);
  }
  g.position.set(st.x, (b.float ?? st.y) + lift + (b.float ? Math.sin(t * 0.0012 + seed) * 0.06 : 0), st.z);
  g.rotation.set(0, st.rot, 0);
  g.scale.setScalar(Math.max(0.0001, st.scale));
  g.visible = st.visible && st.scale > 0.001;
  return lift;
}

function render(t) {
  const { S, camera, sk } = stateAt(t);
  world = WORLDS.get(sk);
  const { scene, decor } = world;
  const frameNo = Math.round((t * TL.fps) / 1000);
  const r = rng(frameNo * 9973 + 11);
  const jitter = k => (r() - 0.5) * k * TL.boil;

  const lifts = new Map();
  for (const st of S.things.values()) lifts.set(st.id, pose(built(st), st, t, S));
  // Carried things ride in the carrier's hands, bobbing with every step.
  for (const st of S.things.values()) {
    if (!st.carriedBy) continue;
    const who = S.things.get(st.carriedBy);
    const hand = handAt(who, built(st).h);
    const g = built(st).group;
    g.position.set(hand.x, hand.y + (lifts.get(who.id) || 0), hand.z);
    g.rotation.y = who.rot;
  }
  // Glow: lit windows, blinking server lights, bright screens.
  for (const st of S.things.values()) {
    const b = built(st);
    if (!b.glow && !b.puffs) continue;
    (b.glow || []).forEach((m, i) => {
      const blink = b.blink ? 0.55 + 0.45 * (Math.sin(t * 0.009 + i * 2.1) > -0.2 ? 1 : 0) : 1;
      m.emissiveIntensity = (b.glowBase ?? 0) + st.glow * 3.2 * blink;
    });
    if (b.puffs) {
      b.puffs.forEach((p, i) => {
        const sm = st.smoke;
        const born = sm ? sm.from + i * Math.max(250, (sm.to - sm.from) / b.puffs.length) : 0;
        const k = sm ? (t - born) / 1700 : -1;
        p.visible = k > 0 && k < 1 && (!sm || born <= sm.to);
        if (!p.visible) return;
        b.group.updateMatrixWorld();
        const base = b.group.localToWorld(b.chimney.clone());
        p.scale.setScalar(lerp(0.08, 0.32, k) * (k > 0.85 ? 1 - (k - 0.85) / 0.15 * 0.6 : 1));
        p.position.set(base.x + k * 0.3 + Math.sin(k * 6 + i) * 0.08, base.y + k * 1.3, base.z);
      });
    }
  }
  // Speech bubbles above heads, turned towards the camera.
  for (const g of world.bubbles.values()) g.visible = false;
  const view = cameraAt(camera, S, t);
  for (const st of S.things.values()) {
    if (!st.bubble || !st.visible || t > st.bubble.until + 250) continue;
    const g = bubbleFor(st.id, st.bubble.text);
    const b = built(st);
    const out = st.bubble.until === Infinity ? 1 : 1 - smoother((t - st.bubble.until) / 250);
    const s = backOut((t - st.bubble.from) / 350) * out;
    if (s <= 0.001) continue;
    g.visible = true;
    g.scale.setScalar(s);
    // Bubbles sit to the clearer side: away from the nearest other thing at head height or above.
    const side = st.bubble.side === 'left' ? -1 : st.bubble.side === 'right' ? 1 : (() => {
      let left = Infinity, right = Infinity;
      for (const o of S.things.values()) {
        if (o === st || !o.visible) continue;
        const ob = built(o);
        if ((ob.float ?? o.y) + ob.h < 1.4 || Math.abs(o.z - st.z) > 2.5) continue;
        const dx = o.x - st.x;
        if (dx >= 0) right = Math.min(right, dx); else left = Math.min(left, -dx);
      }
      return right >= left ? 1 : -1;
    })();
    // The bubble reaches out to that side, with its tail just above the head.
    const w = g.userData.w;
    g.position.set(st.x + side * (w / 2 - 0.15), (b.float ?? st.y) + b.h + 0.12 + (lifts.get(st.id) || 0), st.z + 0.1);
    g.children[1].position.x = -side * (w / 2 - 0.2);
    g.children[1].rotation.z = Math.PI + 0.35 * side;
    g.rotation.y = Math.atan2(view.pos.x - g.position.x, view.pos.z - g.position.z);
  }
  // Stop-motion boil: tiny changes every frame, as if each pose was touched by hand.
  bump.offset.set(0.5 + jitter(0.012), 0.5 + jitter(0.012));
  for (const b of world.built.values()) { b.group.rotation.z += jitter(0.012); b.group.position.x += jitter(0.006); }
  for (const g of decor) { g.rotation.z = jitter(0.01); }

  cam.position.copy(view.pos).add(new THREE.Vector3(jitter(0.008), jitter(0.008), 0));
  // A slow sway keeps still shots alive.
  cam.position.x += Math.sin(t / 5200) * 0.12;
  cam.lookAt(view.target);
  passes.render.scene = scene;
  passes.ao.scene = scene;
  passes.bokeh.scene = scene;
  // Focus on what the shot is about; blur grows gently in front of and behind it.
  passes.bokeh.uniforms.focus.value = cam.position.distanceTo(view.target);
  passes.bokeh.uniforms.aperture.value = 0.0014 * (TL.dof ?? 1);
  passes.finish.uniforms.seed.value = (frameNo % 97) * 0.731;
  composer.render();
  const g = out.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(renderer.domElement, 0, 0, W, H);
  return out.toDataURL('image/jpeg', 0.93);
}

window.clay = {
  async load({ world, steps, width, height, fps = 24, boil = 0.5, dof = 1 }) {
    W = width; H = height;
    if (!renderer) {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.VSMShadowMap; // soft, wide shadows, like big studio lights
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      document.body.append(renderer.domElement);
      out = document.createElement('canvas');
    }
    renderer.setPixelRatio(SUPERSAMPLE);
    renderer.setSize(W, H);
    out.width = W; out.height = H;
    cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 160);
    setupComposer();
    await document.fonts.load('600 40px Fredoka');
    TL = { world: { set: 'meadow', things: [], ...world }, steps: steps.map(s => ({ ...s, start: s.start ?? -Infinity, end: s.end ?? -Infinity, budget: s.budget ?? 0 })), fps, boil, dof };
    plans.clear();
    extents.clear();
    rushed.clear();
    WORLDS.clear();
    buildWorld(TL.world, 'world');
    for (const step of TL.steps) if (step.stage) buildWorld(stageOf(step), `stage${step.index}`);
    // Plan every step now, so mistakes in the spec surface before any frame renders.
    for (const step of TL.steps) stateAt(step.start + (step.budget || 0) + 1);
    return { warnings: [...rushed].flatMap(([index, notes]) => notes.map(text => ({ index, text }))) };
  },
  frame: render,
  /** For checking framing: the camera and where every thing is at time t. */
  inspect(t) {
    const { S, camera } = stateAt(t);
    const v = cameraAt(camera, S, t);
    return { camera: { spec: camera.spec, pos: v.pos.toArray().map(n => +n.toFixed(2)), target: v.target.toArray().map(n => +n.toFixed(2)) },
      things: [...S.things.values()].map(st => ({ id: st.id, x: +st.x.toFixed(2), z: +st.z.toFixed(2), y: +st.y.toFixed(2), visible: st.visible, carriedBy: st.carriedBy })) };
  },
  kinds: KINDS,
  actions: ACTIONS,
};
window.clayReady = true;
