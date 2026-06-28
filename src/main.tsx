import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import './styles.css';

const ASSETS = {
  floor: 'assets/dungeon-floor.png',
  backdrop: 'assets/dungeon-backdrop.png',
  highlandFloor: 'assets/highland-floor-tile.png',
  highlandSky: 'assets/highland-sky.png',
  highlandFar: 'assets/highland-far.png',
  highlandMid: 'assets/highland-mid.png',
  hero: 'assets/hero.png',
  heroSlash: 'assets/hero-slash-sheet.png',
  enemy: 'assets/enemy.png',
};

type ViewMode = 'auto' | 'pc' | 'sp';
type BattleMode = 'idle' | 'slash' | 'thrust' | 'special';
type StageId = 'dungeon' | 'sanctum' | 'highland';
type ResponsiveProfile = 'pc' | 'sp';
type Vec3Tuple = [number, number, number];

// Live-tunable parameters for the 大技 (special) cinematic. Read every frame via
// a ref so the on-screen panel updates without rebuilding the Three.js scene.
type TunerParams = {
  auraIntensity: number;
  auraLight: number;
  frameFill: number;
  fovTele: number;
  fovWide: number;
  dofStrength: number;
  bloomBoost: number;
  chroma: number;
};

const DEFAULT_TUNER: TunerParams = {
  auraIntensity: 1,
  auraLight: 4.5,
  frameFill: 0.66,
  fovTele: 22,
  fovWide: 58,
  dofStrength: 1,
  bloomBoost: 0.3,
  chroma: 0.02,
};

type StageCameraProfile = {
  fov: number | ((aspect: number) => number);
  position: Vec3Tuple;
  target: Vec3Tuple;
  idleSway: Vec3Tuple;
  zoom: number;
  shake: number;
};

type StageLayoutProfile = {
  hero: Vec3Tuple;
  enemy: Vec3Tuple;
  heroScale: number;
  enemyScale: number;
};

type StagePostProfile = {
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  focus: number;
  aperture: number;
  maxblur: number;
  exposure: number;
  saturation: number;
  warmth: number;
  vignette: number;
};

type StageDefinition = {
  id: StageId;
  label: string;
  assets: {
    floor: string;
    backdrop: string;
  };
  world: {
    background: number;
    fog: number;
    fogDensity: number;
  };
  floor: {
    repeat: [number, number];
    overlay?: {
      repeat: [number, number];
      opacity: number;
    };
    tint?: number;
    emissive: number;
    emissiveIntensity: number;
    emissiveMap?: boolean;
    unlit?: boolean;
    roughness: number;
  };
  backdrop: {
    position: Vec3Tuple;
    height: number;
    opacity: number;
  };
  parallax: Array<{
    name: 'sky' | 'far' | 'mid';
    asset?: string;
    color?: number;
    opacity: number;
    position: Vec3Tuple;
    size: [number, number];
    drift: number;
  }>;
  lights: {
    hemiSky: number;
    hemiGround: number;
    hemiIntensity: number;
    key: { color: number; intensity: number; position: Vec3Tuple };
    point: { color: number; intensity: number; distance: number; decay: number; position: Vec3Tuple };
    hero: { color: number; intensity: number; distance: number; decay: number; position: Vec3Tuple };
    enemy: { color: number; intensity: number; distance: number; decay: number; position: Vec3Tuple };
  };
  camera: Record<ResponsiveProfile, StageCameraProfile>;
  layout: Record<ResponsiveProfile, StageLayoutProfile>;
  post: Record<ResponsiveProfile, StagePostProfile>;
};

const BACKDROP_WORLD_HEIGHT = 34;
const BACKDROP_FALLBACK_ASPECT = 1578 / 997;

const DUNGEON_CAMERA_PC = {
  fov: (aspect: number) => Math.min(46, Math.max(30, 42 / Math.sqrt(aspect))),
  position: [0, 8.35, 10.8] as Vec3Tuple,
  target: [0, 1.25, -2.25] as Vec3Tuple,
  idleSway: [0.18, 0.08, 0] as Vec3Tuple,
  zoom: 1,
  shake: 0.08,
};

const DUNGEON_CAMERA_SP = {
  fov: (aspect: number) => (aspect < 0.75 ? 72 : 62),
  position: [0, 8.35, 13.5] as Vec3Tuple,
  target: [0, 1.05, -2.2] as Vec3Tuple,
  idleSway: [0.14, 0.06, 0] as Vec3Tuple,
  zoom: 1,
  shake: 0.06,
};

const DUNGEON_POST = {
  pc: {
    bloomStrength: 0.5,
    bloomRadius: 0.44,
    bloomThreshold: 0.15,
    focus: 13.8,
    aperture: 0.00026,
    maxblur: 0.002,
    exposure: 1.1,
    saturation: 1.08,
    warmth: 0.006,
    vignette: 0.2,
  },
  sp: {
    bloomStrength: 0.36,
    bloomRadius: 0.36,
    bloomThreshold: 0.14,
    focus: 14.2,
    aperture: 0.00014,
    maxblur: 0.001,
    exposure: 1.06,
    saturation: 1.04,
    warmth: 0,
    vignette: 0.12,
  },
} satisfies Record<ResponsiveProfile, StagePostProfile>;

const STAGES: Record<StageId, StageDefinition> = {
  dungeon: {
    id: 'dungeon',
    label: 'Dungeon',
    assets: {
      floor: ASSETS.floor,
      backdrop: ASSETS.backdrop,
    },
    world: {
      background: 0x081019,
      fog: 0x0c1a28,
      fogDensity: 0.039,
    },
    floor: {
      repeat: [4.6, 3.1],
      emissive: 0x1c1408,
      emissiveIntensity: 0.24,
      roughness: 0.82,
    },
    backdrop: {
      position: [0, 4.9, -8.4],
      height: BACKDROP_WORLD_HEIGHT,
      opacity: 1,
    },
    parallax: [
      { name: 'sky', color: 0x1b3857, opacity: 0.18, position: [0, 9.2, -13.5], size: [150, 26], drift: 0.012 },
      { name: 'far', color: 0x5c91a8, opacity: 0.08, position: [0, 5.7, -10.6], size: [128, 18], drift: 0.02 },
      { name: 'mid', color: 0x80bedf, opacity: 0.09, position: [0, 4.2, -7.8], size: [136, 24], drift: 0.036 },
    ],
    lights: {
      hemiSky: 0xc6ddff,
      hemiGround: 0x1c252d,
      hemiIntensity: 1.78,
      key: { color: 0xe7f3ff, intensity: 3.55, position: [-4.8, 9, 5.5] },
      point: { color: 0xffb847, intensity: 5.05, distance: 10.5, decay: 1.7, position: [4.9, 1.9, -1.6] },
      hero: { color: 0xffd28e, intensity: 2.15, distance: 5.2, decay: 1.32, position: [-2.7, 2.35, 1.9] },
      enemy: { color: 0x78c0ff, intensity: 2.55, distance: 5, decay: 1.3, position: [2, 2.3, 0.9] },
    },
    camera: {
      pc: DUNGEON_CAMERA_PC,
      sp: DUNGEON_CAMERA_SP,
    },
    layout: {
      pc: { hero: [-2.25, 1.28, 0.5], enemy: [2.35, 1.32, -0.15], heroScale: 1, enemyScale: 1 },
      sp: { hero: [-1.42, 1.28, 0.5], enemy: [1.42, 1.32, -0.15], heroScale: 0.88, enemyScale: 0.88 },
    },
    post: DUNGEON_POST,
  },
  sanctum: {
    id: 'sanctum',
    label: 'Sanctum',
    assets: {
      floor: ASSETS.floor,
      backdrop: ASSETS.backdrop,
    },
    world: {
      background: 0x120d17,
      fog: 0x221323,
      fogDensity: 0.032,
    },
    floor: {
      repeat: [3.8, 2.7],
      emissive: 0x25110c,
      emissiveIntensity: 0.34,
      roughness: 0.74,
    },
    backdrop: {
      position: [0, 5.15, -8.8],
      height: BACKDROP_WORLD_HEIGHT,
      opacity: 0.84,
    },
    parallax: [
      { name: 'sky', color: 0x311931, opacity: 0.22, position: [0, 9.6, -13.2], size: [150, 27], drift: 0.01 },
      { name: 'far', color: 0x6f453f, opacity: 0.11, position: [0, 5.9, -10.2], size: [130, 19], drift: 0.018 },
      { name: 'mid', color: 0xd29362, opacity: 0.1, position: [0, 4.35, -7.45], size: [136, 24], drift: 0.03 },
    ],
    lights: {
      hemiSky: 0xffd8b0,
      hemiGround: 0x261923,
      hemiIntensity: 1.55,
      key: { color: 0xffd7a1, intensity: 3.3, position: [-3.7, 8.6, 4.4] },
      point: { color: 0xff8742, intensity: 5.7, distance: 10.8, decay: 1.55, position: [3.8, 2.0, -1.2] },
      hero: { color: 0xffc06a, intensity: 2.35, distance: 5.4, decay: 1.25, position: [-2.4, 2.2, 1.85] },
      enemy: { color: 0xb7d7ff, intensity: 2.2, distance: 5, decay: 1.35, position: [2.2, 2.45, 0.65] },
    },
    camera: {
      pc: { ...DUNGEON_CAMERA_PC, position: [0, 8.0, 10.15], target: [0, 1.35, -2.0], zoom: 1.05, shake: 0.1 },
      sp: { ...DUNGEON_CAMERA_SP, position: [0, 8.1, 12.9], target: [0, 1.12, -2.05], zoom: 1.03, shake: 0.08 },
    },
    layout: {
      pc: { hero: [-2.05, 1.32, 0.58], enemy: [2.18, 1.35, -0.12], heroScale: 1.02, enemyScale: 1 },
      sp: { hero: [-1.32, 1.3, 0.58], enemy: [1.34, 1.34, -0.12], heroScale: 0.88, enemyScale: 0.88 },
    },
    post: {
      pc: { ...DUNGEON_POST.pc, bloomStrength: 0.58, bloomRadius: 0.48, exposure: 1.08, saturation: 1.1, warmth: 0.018, vignette: 0.24 },
      sp: { ...DUNGEON_POST.sp, bloomStrength: 0.42, exposure: 1.04, saturation: 1.06, warmth: 0.01, vignette: 0.16 },
    },
  },
  highland: {
    id: 'highland',
    label: 'Highland',
    assets: {
      floor: ASSETS.highlandFloor,
      backdrop: ASSETS.highlandMid,
    },
    world: {
      background: 0xbfe8ff,
      fog: 0xcfe8dd,
      fogDensity: 0.015,
    },
    floor: {
      repeat: [4.5, 3.25],
      overlay: { repeat: [2.15, 1.7], opacity: 0.13 },
      tint: 0xd8f0cf,
      emissive: 0x365b3e,
      emissiveIntensity: 0.24,
      emissiveMap: true,
      unlit: true,
      roughness: 0.88,
    },
    backdrop: {
      position: [0, 5.1, -9.2],
      height: 31,
      opacity: 0,
    },
    parallax: [
      { name: 'sky', asset: ASSETS.highlandSky, opacity: 1, position: [0, 9.25, -14.2], size: [45.0, 25.3], drift: 0.006 },
      { name: 'far', asset: ASSETS.highlandFar, opacity: 0.91, position: [0, 5.45, -10.2], size: [29.35, 16.5], drift: 0.018 },
      { name: 'mid', asset: ASSETS.highlandMid, opacity: 0.94, position: [0, 4.05, -7.05], size: [22.2, 12.5], drift: 0.036 },
    ],
    lights: {
      hemiSky: 0xf3fff9,
      hemiGround: 0x243c34,
      hemiIntensity: 1.92,
      key: { color: 0xf5ffe4, intensity: 4.1, position: [-6.4, 12.8, -5.1] },
      point: { color: 0xd6f4d0, intensity: 1.15, distance: 15, decay: 1.7, position: [-4.2, 3.9, -2.1] },
      hero: { color: 0xf6fff2, intensity: 1.62, distance: 6.6, decay: 1.18, position: [-3.1, 3.55, 1.02] },
      enemy: { color: 0xf1fffb, intensity: 1.55, distance: 6.4, decay: 1.2, position: [2.75, 3.45, 0.62] },
    },
    camera: {
      pc: { fov: (aspect: number) => Math.min(41, Math.max(30, 37 / Math.sqrt(aspect))), position: [0, 7.55, 10.15], target: [0, 2.22, -2.82], idleSway: [0.2, 0.09, 0], zoom: 1.02, shake: 0.07 },
      sp: { fov: (aspect: number) => (aspect < 0.75 ? 68 : 59), position: [0, 7.85, 12.25], target: [0, 1.82, -2.6], idleSway: [0.15, 0.07, 0], zoom: 1.01, shake: 0.055 },
    },
    layout: {
      pc: { hero: [-2.45, 1.58, 0.6], enemy: [2.55, 1.62, -0.05], heroScale: 1, enemyScale: 1 },
      sp: { hero: [-1.48, 1.48, 0.62], enemy: [1.5, 1.52, -0.06], heroScale: 0.88, enemyScale: 0.88 },
    },
    post: {
      pc: {
        bloomStrength: 0.22,
        bloomRadius: 0.26,
        bloomThreshold: 0.28,
        focus: 15.2,
        aperture: 0.00004,
        maxblur: 0.00025,
        exposure: 1.04,
        saturation: 1.02,
        warmth: -0.006,
        vignette: 0.1,
      },
      sp: {
        bloomStrength: 0.18,
        bloomRadius: 0.24,
        bloomThreshold: 0.3,
        focus: 15.4,
        aperture: 0.00003,
        maxblur: 0.0002,
        exposure: 1.0,
        saturation: 1.0,
        warmth: -0.004,
        vignette: 0.08,
      },
    },
  },
};

const STAGE_IDS = Object.keys(STAGES) as StageId[];

function setVec3(target: THREE.Vector3, value: Vec3Tuple) {
  target.set(value[0], value[1], value[2]);
}

function getProfile(viewMode: ViewMode, width: number, aspect: number): ResponsiveProfile {
  if (viewMode !== 'auto') return viewMode;
  return width <= 760 || aspect < 0.86 ? 'sp' : 'pc';
}

function resolveFov(fov: StageCameraProfile['fov'], aspect: number) {
  return typeof fov === 'function' ? fov(aspect) : fov;
}

function hasTextureImage(texture: THREE.Texture) {
  const image = texture.image as HTMLImageElement | HTMLCanvasElement | undefined;
  return Boolean(image && image.width > 0 && image.height > 0);
}

function getViewportSize(mount: HTMLElement) {
  const rect = mount.getBoundingClientRect();
  const viewport = window.visualViewport;
  return {
    width: Math.max(1, Math.round(rect.width || viewport?.width || window.innerWidth)),
    height: Math.max(1, Math.round(rect.height || viewport?.height || window.innerHeight)),
  };
}

function getCssViewportSize(mount: HTMLElement) {
  const rect = mount.getBoundingClientRect();
  const viewport = window.visualViewport;
  return {
    width: Math.max(1, Math.round(rect.width || viewport?.width || window.innerWidth)),
    height: Math.max(1, Math.round(rect.height || viewport?.height || window.innerHeight)),
  };
}

function fitBackdropToTexture(backdrop: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>, texture: THREE.Texture) {
  const image = texture.image as HTMLImageElement | undefined;
  const width = image?.naturalWidth || image?.width || 0;
  const height = image?.naturalHeight || image?.height || 0;
  if (width <= 0 || height <= 0) return;

  const nextGeometry = new THREE.PlaneGeometry(BACKDROP_WORLD_HEIGHT * (width / height), BACKDROP_WORLD_HEIGHT);
  backdrop.geometry.dispose();
  backdrop.geometry = nextGeometry;
}

function getShadowProjection(lightPosition: Vec3Tuple) {
  const xzLength = Math.hypot(lightPosition[0], lightPosition[2]) || 1;
  const offsetX = (-lightPosition[0] / xzLength) * 0.64;
  const offsetZ = (-lightPosition[2] / xzLength) * 0.64;
  return {
    x: offsetX,
    z: offsetZ,
    rotation: -0.1 + offsetX * 0.08,
  };
}

const colorGradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    exposure: { value: 1.08 },
    contrast: { value: 1.04 },
    saturation: { value: 1.08 },
    warmth: { value: 0.006 },
    vignette: { value: 0.2 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float exposure;
    uniform float contrast;
    uniform float saturation;
    uniform float warmth;
    uniform float vignette;
    varying vec2 vUv;

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 color = texel.rgb * exposure;
      color = (color - 0.5) * contrast + 0.5;
      float grey = dot(color, vec3(0.299, 0.587, 0.114));
      color = mix(vec3(grey), color, saturation);
      color.r += warmth;
      color.b -= warmth * 0.7;
      float dist = distance(vUv, vec2(0.5));
      float vig = smoothstep(0.88, 0.2, dist);
      color *= mix(1.0 - vignette, 1.0, vig);
      gl_FragColor = vec4(color, texel.a);
    }
  `,
};

// Hit-impact chromatic aberration: radial RGB split + a slight radial smear,
// i.e. the "colors separate" blur Octopath uses on heavy hits.
const chromaticAberrationShader = {
  uniforms: {
    tDiffuse: { value: null },
    amount: { value: 0 },
    blur: { value: 0 },
    center: { value: new THREE.Vector2(0.5, 0.5) },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float amount;
    uniform float blur;
    uniform vec2 center;
    varying vec2 vUv;

    void main() {
      vec2 dir = vUv - center;
      if (amount <= 0.0001 && blur <= 0.0001) {
        gl_FragColor = texture2D(tDiffuse, vUv);
        return;
      }
      vec2 off = dir * amount;
      vec3 acc = vec3(0.0);
      for (int i = 0; i < 4; i += 1) {
        float f = float(i) / 3.0;
        vec2 b = dir * blur * (f - 0.5);
        acc.r += texture2D(tDiffuse, vUv + off * (1.0 + f * 0.6) + b).r;
        acc.g += texture2D(tDiffuse, vUv + b).g;
        acc.b += texture2D(tDiffuse, vUv - off * (1.0 + f * 0.6) + b).b;
      }
      gl_FragColor = vec4(acc / 4.0, 1.0);
    }
  `,
};

function makeGlowTexture(colorStops?: Array<[number, string]>) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  const stops = colorStops ?? [
    [0, 'rgba(255, 227, 151, 1)'],
    [0.25, 'rgba(255, 174, 58, 0.5)'],
    [1, 'rgba(255, 174, 58, 0)'],
  ];
  stops.forEach(([offset, color]) => gradient.addColorStop(offset, color));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(canvas);
}

function makeAuraTexture() {
  // softer, hollow-ish halo: dim center (so it doesn't wash the character),
  // brighter mid ring, smooth falloff.
  return makeGlowTexture([
    [0, 'rgba(255, 250, 235, 0.4)'],
    [0.34, 'rgba(255, 236, 190, 0.46)'],
    [0.62, 'rgba(255, 200, 110, 0.2)'],
    [1, 'rgba(255, 180, 70, 0)'],
  ]);
}

function makeAuraRingTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  const pool = ctx.createRadialGradient(256, 256, 0, 256, 256, 256);
  pool.addColorStop(0, 'rgba(255, 238, 182, 0.42)');
  pool.addColorStop(0.46, 'rgba(255, 208, 124, 0.12)');
  pool.addColorStop(1, 'rgba(255, 208, 124, 0)');
  ctx.fillStyle = pool;
  ctx.fillRect(0, 0, 512, 512);

  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = 'rgba(255, 248, 214, 0.92)';
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.arc(256, 256, 196, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 226, 152, 0.4)';
  ctx.lineWidth = 36;
  ctx.beginPath();
  ctx.arc(256, 256, 196, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 244, 206, 0.5)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(256, 256, 150, 0, Math.PI * 2);
  ctx.stroke();

  // rune ticks around the ring
  for (let i = 0; i < 24; i += 1) {
    const angle = (i / 24) * Math.PI * 2;
    const inner = i % 2 === 0 ? 168 : 178;
    const outer = i % 2 === 0 ? 222 : 210;
    ctx.strokeStyle = `rgba(255, 240, 200, ${i % 2 === 0 ? 0.7 : 0.32})`;
    ctx.lineWidth = i % 2 === 0 ? 6 : 3;
    ctx.beginPath();
    ctx.moveTo(256 + Math.cos(angle) * inner, 256 + Math.sin(angle) * inner);
    ctx.lineTo(256 + Math.cos(angle) * outer, 256 + Math.sin(angle) * outer);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeBeamTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createLinearGradient(0, 0, 128, 0);
  gradient.addColorStop(0, 'rgba(210, 232, 255, 0)');
  gradient.addColorStop(0.45, 'rgba(237, 247, 255, 0.25)');
  gradient.addColorStop(0.55, 'rgba(255, 229, 157, 0.32)');
  gradient.addColorStop(1, 'rgba(210, 232, 255, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 512);
  return new THREE.CanvasTexture(canvas);
}

function makeForestBeamTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 192;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const column = ctx.createLinearGradient(0, 0, 192, 0);
  column.addColorStop(0, 'rgba(221, 255, 225, 0)');
  column.addColorStop(0.24, 'rgba(226, 255, 218, 0.1)');
  column.addColorStop(0.44, 'rgba(249, 255, 210, 0.5)');
  column.addColorStop(0.52, 'rgba(255, 255, 224, 0.68)');
  column.addColorStop(0.62, 'rgba(231, 255, 219, 0.28)');
  column.addColorStop(1, 'rgba(221, 255, 225, 0)');
  ctx.fillStyle = column;
  ctx.fillRect(0, 0, 192, 512);

  const fade = ctx.createLinearGradient(0, 0, 0, 512);
  fade.addColorStop(0, 'rgba(0, 0, 0, 0)');
  fade.addColorStop(0.12, 'rgba(0, 0, 0, 0.78)');
  fade.addColorStop(0.72, 'rgba(0, 0, 0, 0.92)');
  fade.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, 192, 512);
  ctx.globalCompositeOperation = 'source-over';
  return new THREE.CanvasTexture(canvas);
}

function makeForestSkirtTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  const vertical = ctx.createLinearGradient(0, 0, 0, 256);
  vertical.addColorStop(0, 'rgba(21, 45, 36, 0)');
  vertical.addColorStop(0.34, 'rgba(31, 68, 51, 0.12)');
  vertical.addColorStop(0.62, 'rgba(18, 37, 27, 0.34)');
  vertical.addColorStop(0.86, 'rgba(8, 18, 13, 0.28)');
  vertical.addColorStop(1, 'rgba(8, 18, 13, 0)');
  ctx.fillStyle = vertical;
  ctx.fillRect(0, 0, 1024, 256);

  const mist = ctx.createLinearGradient(0, 0, 1024, 0);
  mist.addColorStop(0, 'rgba(181, 235, 219, 0.02)');
  mist.addColorStop(0.28, 'rgba(206, 246, 226, 0.08)');
  mist.addColorStop(0.55, 'rgba(219, 249, 231, 0.06)');
  mist.addColorStop(0.78, 'rgba(194, 238, 219, 0.07)');
  mist.addColorStop(1, 'rgba(181, 235, 219, 0.02)');
  ctx.fillStyle = mist;
  ctx.fillRect(0, 46, 1024, 120);

  for (let i = 0; i < 90; i += 1) {
    const x = Math.random() * 1024;
    const y = 118 + Math.random() * 86;
    const w = 18 + Math.random() * 48;
    const h = 10 + Math.random() * 28;
    const g = ctx.createRadialGradient(x, y, 0, x, y, w);
    g.addColorStop(0, `rgba(${42 + Math.random() * 30}, ${88 + Math.random() * 42}, ${42 + Math.random() * 25}, ${0.08 + Math.random() * 0.1})`);
    g.addColorStop(1, 'rgba(23, 48, 30, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, w, h, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  return new THREE.CanvasTexture(canvas);
}

function makeForestDepthMistTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  const vertical = ctx.createLinearGradient(0, 0, 0, 512);
  vertical.addColorStop(0, 'rgba(188, 235, 226, 0.04)');
  vertical.addColorStop(0.28, 'rgba(202, 241, 226, 0.14)');
  vertical.addColorStop(0.58, 'rgba(214, 247, 229, 0.22)');
  vertical.addColorStop(0.82, 'rgba(174, 224, 209, 0.16)');
  vertical.addColorStop(1, 'rgba(132, 182, 174, 0.02)');
  ctx.fillStyle = vertical;
  ctx.fillRect(0, 0, 1024, 512);

  for (let i = 0; i < 44; i += 1) {
    const x = Math.random() * 1024;
    const y = 80 + Math.random() * 350;
    const radius = 90 + Math.random() * 180;
    const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, `rgba(218, 248, 232, ${0.04 + Math.random() * 0.08})`);
    g.addColorStop(1, 'rgba(218, 248, 232, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, radius * 1.6, radius * 0.46, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  return new THREE.CanvasTexture(canvas);
}

function makeSlashTexture(layer = 0) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;
  ctx.lineCap = 'round';

  const startX = 338 + layer * 30;
  const startY = 88 + layer * 22;
  const endX = 326 + layer * 32;
  const endY = 930 - layer * 34;
  const controlAX = 780 - layer * 36;
  const controlAY = 118 + layer * 26;
  const controlBX = 850 - layer * 24;
  const controlBY = 750 - layer * 42;

  const outer = ctx.createLinearGradient(300, 60, 760, 900);
  outer.addColorStop(0, 'rgba(92, 188, 255, 0)');
  outer.addColorStop(0.18, 'rgba(126, 220, 255, 0.2)');
  outer.addColorStop(0.48, layer === 1 ? 'rgba(255, 234, 154, 0.6)' : 'rgba(205, 244, 255, 0.56)');
  outer.addColorStop(0.74, 'rgba(164, 226, 255, 0.28)');
  outer.addColorStop(1, 'rgba(92, 188, 255, 0)');

  ctx.strokeStyle = outer;
  ctx.lineWidth = 128 - layer * 28;
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.bezierCurveTo(controlAX, controlAY, controlBX, controlBY, endX, endY);
  ctx.stroke();

  ctx.globalCompositeOperation = 'destination-out';
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
  ctx.lineWidth = 76 - layer * 16;
  ctx.beginPath();
  ctx.moveTo(startX - 38, startY + 28);
  ctx.bezierCurveTo(controlAX - 116, controlAY + 72, controlBX - 112, controlBY - 74, endX - 34, endY - 20);
  ctx.stroke();
  ctx.lineWidth = 28 - layer * 5;
  ctx.beginPath();
  ctx.moveTo(startX - 68, startY + 56);
  ctx.bezierCurveTo(controlAX - 186, controlAY + 134, controlBX - 188, controlBY - 150, endX - 70, endY - 44);
  ctx.stroke();

  ctx.globalCompositeOperation = 'source-over';
  const core = ctx.createLinearGradient(280, 60, 760, 900);
  core.addColorStop(0, 'rgba(255, 255, 255, 0)');
  core.addColorStop(0.32, 'rgba(227, 249, 255, 0.56)');
  core.addColorStop(0.54, 'rgba(255, 248, 203, 0.66)');
  core.addColorStop(0.78, 'rgba(210, 244, 255, 0.28)');
  core.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.strokeStyle = core;
  ctx.lineWidth = 11 - layer * 2;
  ctx.beginPath();
  ctx.moveTo(startX + 2, startY + 4);
  ctx.bezierCurveTo(controlAX - 8, controlAY + 4, controlBX - 12, controlBY - 12, endX + 2, endY - 2);
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeThrustTexture(layer = 0) {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const centerX = 192;
  const tailY = 900 - layer * 26;
  const tipY = 98 + layer * 24;
  const coreWidth = 18 - layer * 3;
  const auraWidth = 112 - layer * 24;

  const aura = ctx.createLinearGradient(0, tailY, 0, tipY);
  aura.addColorStop(0, 'rgba(118, 211, 255, 0)');
  aura.addColorStop(0.28, 'rgba(136, 223, 255, 0.06)');
  aura.addColorStop(0.52, 'rgba(136, 223, 255, 0.18)');
  aura.addColorStop(0.76, layer === 1 ? 'rgba(255, 238, 169, 0.52)' : 'rgba(205, 244, 255, 0.48)');
  aura.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.strokeStyle = aura;
  ctx.lineWidth = auraWidth;
  ctx.beginPath();
  ctx.moveTo(centerX, tailY);
  ctx.lineTo(centerX, tipY + 114);
  ctx.stroke();

  ctx.globalCompositeOperation = 'destination-out';
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.lineWidth = 34 - layer * 7;
  ctx.beginPath();
  ctx.moveTo(centerX - 58, tailY + 18);
  ctx.lineTo(centerX - 12, tipY + 170);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(centerX + 58, tailY + 18);
  ctx.lineTo(centerX + 12, tipY + 170);
  ctx.stroke();

  ctx.globalCompositeOperation = 'source-over';
  const core = ctx.createLinearGradient(0, tailY, 0, tipY);
  core.addColorStop(0, 'rgba(255, 255, 255, 0)');
  core.addColorStop(0.42, 'rgba(230, 250, 255, 0.16)');
  core.addColorStop(0.64, 'rgba(230, 250, 255, 0.44)');
  core.addColorStop(0.82, 'rgba(255, 248, 205, 0.92)');
  core.addColorStop(1, 'rgba(255, 255, 255, 0.06)');
  ctx.strokeStyle = core;
  ctx.lineWidth = coreWidth;
  ctx.beginPath();
  ctx.moveTo(centerX, tailY);
  ctx.lineTo(centerX, tipY + 118);
  ctx.stroke();

  const head = ctx.createLinearGradient(0, tipY + 180, 0, tipY);
  head.addColorStop(0, 'rgba(142, 224, 255, 0)');
  head.addColorStop(0.52, 'rgba(210, 245, 255, 0.48)');
  head.addColorStop(0.8, 'rgba(255, 241, 178, 0.78)');
  head.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = head;
  ctx.beginPath();
  ctx.moveTo(centerX, tipY);
  ctx.lineTo(centerX - 112 + layer * 20, tipY + 210);
  ctx.quadraticCurveTo(centerX - 36, tipY + 158, centerX, tipY + 128);
  ctx.quadraticCurveTo(centerX + 36, tipY + 158, centerX + 112 - layer * 20, tipY + 210);
  ctx.closePath();
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeShockRingTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const wake = ctx.createLinearGradient(218, 0, 512, 0);
  wake.addColorStop(0, 'rgba(255, 255, 255, 0.22)');
  wake.addColorStop(0.24, 'rgba(219, 249, 255, 0.12)');
  wake.addColorStop(0.68, 'rgba(185, 238, 255, 0.045)');
  wake.addColorStop(1, 'rgba(185, 238, 255, 0)');
  ctx.fillStyle = wake;
  ctx.beginPath();
  ctx.moveTo(234, 142);
  ctx.bezierCurveTo(332, 142, 404, 184, 494, 228);
  ctx.lineTo(494, 284);
  ctx.bezierCurveTo(396, 322, 326, 360, 234, 370);
  ctx.closePath();
  ctx.fill();

  for (let i = 0; i < 18; i += 1) {
    const p = i / 17;
    const y = 178 + p * 156 + Math.sin(i * 4.3) * 16;
    const length = 92 + Math.sin(i * 2.1) * 42 + (1 - Math.abs(p - 0.5) * 2) * 118;
    const alpha = 0.1 + (1 - Math.abs(p - 0.5) * 2) * 0.16;
    const ray = ctx.createLinearGradient(220, y, 220 + length, y + Math.sin(i) * 18);
    ray.addColorStop(0, `rgba(246, 255, 255, ${alpha})`);
    ray.addColorStop(0.44, `rgba(198, 244, 255, ${alpha * 0.5})`);
    ray.addColorStop(1, 'rgba(198, 244, 255, 0)');
    ctx.strokeStyle = ray;
    ctx.lineWidth = 3 + Math.sin(i * 1.7) * 1.4;
    ctx.beginPath();
    ctx.moveTo(226, y);
    ctx.bezierCurveTo(260 + length * 0.2, y - 30 + Math.sin(i) * 12, 306 + length * 0.5, y + 26, 228 + length, y + Math.sin(i * 2.3) * 32);
    ctx.stroke();
  }

  const drawEllipseArc = (radiusX: number, radiusY: number, width: number, alpha: number, start: number, end: number, warm = false) => {
    const gradient = ctx.createLinearGradient(120, 342, 214, 120);
    gradient.addColorStop(0, warm ? `rgba(255, 226, 152, ${alpha})` : `rgba(238, 254, 255, ${alpha})`);
    gradient.addColorStop(0.44, `rgba(255, 255, 255, ${alpha * 0.96})`);
    gradient.addColorStop(0.76, warm ? `rgba(255, 238, 178, ${alpha * 0.52})` : `rgba(184, 240, 255, ${alpha * 0.44})`);
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.strokeStyle = gradient;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.ellipse(168, 256, radiusX, radiusY, 0, start, end);
    ctx.stroke();
  };

  const drawDimEllipse = (radiusX: number, radiusY: number, width: number, alpha: number) => {
    ctx.strokeStyle = `rgba(190, 242, 255, ${alpha})`;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.ellipse(168, 256, radiusX, radiusY, 0, 0, Math.PI * 2);
    ctx.stroke();
  };

  const halo = ctx.createRadialGradient(168, 256, 16, 168, 256, 190);
  halo.addColorStop(0, 'rgba(255, 255, 255, 0.18)');
  halo.addColorStop(0.28, 'rgba(225, 250, 255, 0.16)');
  halo.addColorStop(0.54, 'rgba(185, 238, 255, 0.06)');
  halo.addColorStop(1, 'rgba(185, 238, 255, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.ellipse(168, 256, 96, 178, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalCompositeOperation = 'lighter';
  drawDimEllipse(52, 184, 6, 0.18);
  drawEllipseArc(42, 172, 18, 0.9, Math.PI * 0.46, Math.PI * 1.28, true);
  drawEllipseArc(54, 186, 7, 0.86, Math.PI * 0.52, Math.PI * 1.22);
  drawEllipseArc(30, 152, 4, 0.5, Math.PI * 0.55, Math.PI * 1.16);

  ctx.globalCompositeOperation = 'destination-out';
  const aperture = ctx.createRadialGradient(168, 256, 18, 168, 256, 82);
  aperture.addColorStop(0, 'rgba(0, 0, 0, 0.82)');
  aperture.addColorStop(0.58, 'rgba(0, 0, 0, 0.24)');
  aperture.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = aperture;
  ctx.beginPath();
  ctx.ellipse(168, 256, 27, 126, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeVortexTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const drawRibbon = (phase: number, lift: number, width: number, alpha: number, warm = false) => {
    const gradient = ctx.createLinearGradient(34, 0, 990, 0);
    gradient.addColorStop(0, 'rgba(138, 221, 255, 0)');
    gradient.addColorStop(0.18, `rgba(212, 247, 255, ${alpha * 0.56})`);
    gradient.addColorStop(0.48, warm ? `rgba(255, 238, 174, ${alpha})` : `rgba(238, 255, 255, ${alpha})`);
    gradient.addColorStop(0.74, `rgba(184, 239, 255, ${alpha * 0.48})`);
    gradient.addColorStop(1, 'rgba(138, 221, 255, 0)');
    ctx.strokeStyle = gradient;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (let i = 0; i <= 112; i += 1) {
      const p = i / 112;
      const x = 44 + p * 936;
      const envelope = Math.sin(p * Math.PI);
      const wave = Math.sin(p * Math.PI * 4.8 + phase);
      const y = 128 + lift + wave * 42 * envelope;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    ctx.lineWidth = Math.max(1.5, width * 0.38);
    ctx.beginPath();
    for (let i = 0; i <= 112; i += 1) {
      const p = i / 112;
      const x = 44 + p * 936;
      const envelope = Math.sin(p * Math.PI);
      const wave = Math.sin(p * Math.PI * 4.8 + phase + Math.PI);
      const y = 128 + lift + wave * 24 * envelope;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };

  drawRibbon(0.1, -18, 10, 0.32);
  drawRibbon(1.75, 8, 6, 0.44, true);
  drawRibbon(3.25, 24, 4, 0.26);

  ctx.globalCompositeOperation = 'destination-out';
  const fade = ctx.createLinearGradient(0, 0, 1024, 0);
  fade.addColorStop(0, 'rgba(0, 0, 0, 1)');
  fade.addColorStop(0.12, 'rgba(0, 0, 0, 0)');
  fade.addColorStop(0.88, 'rgba(0, 0, 0, 0)');
  fade.addColorStop(1, 'rgba(0, 0, 0, 1)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, 1024, 256);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeRevealMaterial(texture: THREE.Texture, tint: number) {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: texture },
      opacity: { value: 0 },
      revealHead: { value: 0 },
      revealTail: { value: 0 },
      revealFromBottom: { value: 0 },
      tint: { value: new THREE.Color(tint) },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      uniform float opacity;
      uniform float revealHead;
      uniform float revealTail;
      uniform float revealFromBottom;
      uniform vec3 tint;
      varying vec2 vUv;
      void main() {
        vec4 texel = texture2D(map, vUv);
        float revealCoord = mix(1.0 - vUv.y, vUv.y, revealFromBottom);
        float head = 1.0 - smoothstep(revealHead, revealHead + 0.12, revealCoord);
        float tail = smoothstep(revealTail - 0.12, revealTail, revealCoord);
        float mask = clamp(head * tail, 0.0, 1.0);
        gl_FragColor = vec4(texel.rgb * tint, texel.a * opacity * mask);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
  });
}

function makeWindTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createLinearGradient(0, 0, 512, 0);
  gradient.addColorStop(0, 'rgba(141, 216, 255, 0)');
  gradient.addColorStop(0.34, 'rgba(172, 232, 255, 0.2)');
  gradient.addColorStop(0.62, 'rgba(255, 235, 168, 0.26)');
  gradient.addColorStop(1, 'rgba(141, 216, 255, 0)');
  ctx.strokeStyle = gradient;
  ctx.lineCap = 'round';
  for (let i = 0; i < 4; i += 1) {
    ctx.lineWidth = 5 - i * 0.6;
    ctx.beginPath();
    ctx.moveTo(28, 62 + i * 10);
    ctx.bezierCurveTo(146, 18 + i * 11, 306, 116 - i * 13, 486, 46 + i * 4);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeSmokeTexture() {
  return makeGlowTexture([
    [0, 'rgba(207, 218, 214, 0.34)'],
    [0.34, 'rgba(158, 174, 170, 0.17)'],
    [1, 'rgba(106, 120, 116, 0)'],
  ]);
}

function makeBlobShadow() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(128, 64, 12, 128, 64, 118);
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0.46)');
  gradient.addColorStop(0.55, 'rgba(0, 0, 0, 0.18)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 128);
  return new THREE.CanvasTexture(canvas);
}

function makeSilhouetteShadowTexture(src: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const image = new Image();
  image.onload = () => {
    if (texture.userData.cancelled) return;
    const scratch = document.createElement('canvas');
    scratch.width = image.naturalWidth;
    scratch.height = image.naturalHeight;
    const scratchCtx = scratch.getContext('2d', { willReadFrequently: true })!;
    scratchCtx.drawImage(image, 0, 0);
    const source = scratchCtx.getImageData(0, 0, scratch.width, scratch.height);
    const data = source.data;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      const isChroma = r > 220 && g < 80 && b > 180;
      const alpha = isChroma || a < 12 ? 0 : Math.min(160, a * 0.72);
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = alpha;
    }

    scratchCtx.putImageData(source, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(258, 276);
    ctx.transform(1, 0.18, -0.48, 0.58, 0, 0);
    ctx.filter = 'blur(5px)';
    ctx.drawImage(scratch, -190, -232, 380, 416);
    ctx.restore();
    if (texture.userData.cancelled) return;
    texture.needsUpdate = true;
  };
  image.src = src;

  return texture;
}

function DungeonScene({ viewMode, battleMode, stageId, paramsRef }: { viewMode: ViewMode; battleMode: BattleMode; stageId: StageId; paramsRef: React.MutableRefObject<TunerParams> }) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current!;
    const stage = STAGES[stageId];
    const params = new URLSearchParams(window.location.search);
    const showDebug = params.has('debug');
    const forcedBattlePhase = params.has('phase') ? Math.min(1, Math.max(0, Number(params.get('phase')) || 0)) : null;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(stage.world.background);
    scene.fog = new THREE.FogExp2(stage.world.fog, stage.world.fogDensity);

    const initialSize = getViewportSize(mount);
    const camera = new THREE.PerspectiveCamera(36, initialSize.width / initialSize.height, 0.1, 100);
    camera.position.set(0, 7.6, 10.8);
    camera.lookAt(0, 0.4, -0.8);
    const cameraRig = {
      fov: 36,
      x: 0,
      y: 7.55,
      z: 10.8,
      targetX: 0,
      targetY: 0.42,
      targetZ: -0.8,
      swayX: 0.18,
      swayY: 0.08,
      swayZ: 0,
      zoom: 1,
      shake: 0,
    };
    const layoutRig = {
      heroX: -2.25,
      heroY: 1.28,
      heroZ: 0.5,
      enemyX: 2.45,
      enemyY: 1.32,
      enemyZ: -0.15,
      heroScale: 1,
      enemyScale: 1,
    };

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(initialSize.width, initialSize.height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);
    renderer.domElement.dataset.debugCanvas = 'true';

    const loader = new THREE.TextureLoader();
    const floorTexture = loader.load(stage.assets.floor);
    floorTexture.colorSpace = THREE.SRGBColorSpace;
    floorTexture.wrapS = THREE.RepeatWrapping;
    floorTexture.wrapT = THREE.RepeatWrapping;
    floorTexture.repeat.set(stage.floor.repeat[0], stage.floor.repeat[1]);
    floorTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();

    const floorMaterial = stage.floor.unlit
      ? new THREE.MeshBasicMaterial({
          map: floorTexture,
          color: stage.floor.tint ?? 0xffffff,
        })
      : new THREE.MeshStandardMaterial({
        map: floorTexture,
        color: stage.floor.tint ?? 0xffffff,
        roughness: stage.floor.roughness,
        metalness: 0.02,
        emissive: new THREE.Color(stage.floor.emissive),
        emissiveMap: stage.floor.emissiveMap ? floorTexture : null,
        emissiveIntensity: stage.floor.emissiveIntensity,
      });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(96, 64, 160, 120), floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const floorOverlayTexture = stage.floor.overlay ? loader.load(stage.assets.floor) : null;
    if (floorOverlayTexture) {
      floorOverlayTexture.colorSpace = THREE.SRGBColorSpace;
      floorOverlayTexture.wrapS = THREE.RepeatWrapping;
      floorOverlayTexture.wrapT = THREE.RepeatWrapping;
      floorOverlayTexture.repeat.set(stage.floor.overlay!.repeat[0], stage.floor.overlay!.repeat[1]);
      floorOverlayTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    }
    const floorOverlay = floorOverlayTexture && stage.floor.overlay
      ? new THREE.Mesh(
          new THREE.PlaneGeometry(96, 64, 48, 36),
          new THREE.MeshBasicMaterial({
            map: floorOverlayTexture,
            transparent: true,
            opacity: stage.floor.overlay.opacity,
            depthWrite: false,
          }),
        )
      : null;
    if (floorOverlay) {
      floorOverlay.rotation.x = -Math.PI / 2;
      floorOverlay.position.y = 0.032;
      scene.add(floorOverlay);
    }

    let backdrop: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
    const backdropTexture = loader.load(stage.assets.backdrop, (texture) => {
      fitBackdropToTexture(backdrop, texture);
    });
    backdropTexture.colorSpace = THREE.SRGBColorSpace;
    backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(stage.backdrop.height * BACKDROP_FALLBACK_ASPECT, stage.backdrop.height),
      new THREE.MeshBasicMaterial({ map: backdropTexture, transparent: true, opacity: stage.backdrop.opacity, depthWrite: false }),
    );
    setVec3(backdrop.position, stage.backdrop.position);
    scene.add(backdrop);

    const parallaxTextures: THREE.Texture[] = [];
    const parallaxLayers = stage.parallax.map((layer) => {
      const texture = layer.asset ? loader.load(layer.asset) : null;
      if (texture) {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.magFilter = THREE.LinearFilter;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        parallaxTextures.push(texture);
      }
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(layer.size[0], layer.size[1]),
        new THREE.MeshBasicMaterial({
          map: texture,
          color: layer.color ?? 0xffffff,
          transparent: true,
          opacity: layer.opacity,
          depthWrite: false,
        }),
      );
      setVec3(mesh.position, layer.position);
      scene.add(mesh);
      return { mesh, config: layer };
    });

    const forestSkirtTexture = stage.id === 'highland' ? makeForestSkirtTexture() : null;
    const forestSkirt = forestSkirtTexture
      ? new THREE.Mesh(
          new THREE.PlaneGeometry(30, 2.05),
          new THREE.MeshBasicMaterial({
            map: forestSkirtTexture,
            transparent: true,
            opacity: 0.62,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
        )
      : null;
    if (forestSkirt) {
      forestSkirt.position.set(0, 0.52, -6.05);
      forestSkirt.rotation.x = -0.04;
      scene.add(forestSkirt);
    }

    const forestDepthMistTexture = stage.id === 'highland' ? makeForestDepthMistTexture() : null;
    const forestDepthMist = forestDepthMistTexture
      ? new THREE.Mesh(
          new THREE.PlaneGeometry(23.8, 9.2),
          new THREE.MeshBasicMaterial({
            map: forestDepthMistTexture,
            transparent: true,
            opacity: 0.58,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
        )
      : null;
    if (forestDepthMist) {
      forestDepthMist.position.set(0, 4.22, -6.94);
      scene.add(forestDepthMist);
    }

    const ambient = new THREE.HemisphereLight(stage.lights.hemiSky, stage.lights.hemiGround, stage.lights.hemiIntensity);
    scene.add(ambient);

    const moon = new THREE.DirectionalLight(stage.lights.key.color, stage.lights.key.intensity);
    setVec3(moon.position, stage.lights.key.position);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    moon.shadow.camera.left = -8;
    moon.shadow.camera.right = 8;
    moon.shadow.camera.top = 8;
    moon.shadow.camera.bottom = -8;
    scene.add(moon);

    const crystal = new THREE.PointLight(stage.lights.point.color, stage.lights.point.intensity, stage.lights.point.distance, stage.lights.point.decay);
    setVec3(crystal.position, stage.lights.point.position);
    scene.add(crystal);

    const heroKey = new THREE.PointLight(stage.lights.hero.color, stage.lights.hero.intensity, stage.lights.hero.distance, stage.lights.hero.decay);
    setVec3(heroKey.position, stage.lights.hero.position);
    scene.add(heroKey);

    const enemyRim = new THREE.PointLight(stage.lights.enemy.color, stage.lights.enemy.intensity, stage.lights.enemy.distance, stage.lights.enemy.decay);
    setVec3(enemyRim.position, stage.lights.enemy.position);
    scene.add(enemyRim);

    const heroTexture = loader.load(ASSETS.hero);
    const heroSlashTexture = loader.load(ASSETS.heroSlash);
    const enemyTexture = loader.load(ASSETS.enemy);
    heroTexture.colorSpace = THREE.SRGBColorSpace;
    heroSlashTexture.colorSpace = THREE.SRGBColorSpace;
    enemyTexture.colorSpace = THREE.SRGBColorSpace;
    heroTexture.magFilter = THREE.NearestFilter;
    heroSlashTexture.magFilter = THREE.NearestFilter;
    enemyTexture.magFilter = THREE.NearestFilter;
    heroSlashTexture.wrapS = THREE.RepeatWrapping;
    heroSlashTexture.wrapT = THREE.RepeatWrapping;
    heroSlashTexture.repeat.set(1 / 4, 1);

    const hero = new THREE.Sprite(new THREE.SpriteMaterial({ map: heroTexture, color: 0xffffff, transparent: true, alphaTest: 0.08 }));
    hero.position.set(layoutRig.heroX, layoutRig.heroY, layoutRig.heroZ);
    hero.scale.set(2.0, 2.35, 1);
    scene.add(hero);

    const enemy = new THREE.Sprite(new THREE.SpriteMaterial({ map: enemyTexture, color: 0xf6fbff, transparent: true, alphaTest: 0.08 }));
    enemy.position.set(layoutRig.enemyX, layoutRig.enemyY, layoutRig.enemyZ);
    enemy.scale.set(2.05, 2.4, 1);
    scene.add(enemy);

    const blobShadowTexture = makeBlobShadow();
    const heroSilhouetteTexture = makeSilhouetteShadowTexture(ASSETS.hero);
    const enemySilhouetteTexture = makeSilhouetteShadowTexture(ASSETS.enemy);
    const shadowProjection = getShadowProjection(stage.lights.key.position);
    const blobShadowMaterial = new THREE.MeshBasicMaterial({ map: blobShadowTexture, transparent: true, opacity: 0.34, depthWrite: false });
    const makeBlob = (x: number, z: number, scale: number) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.7 * scale, 0.84 * scale), blobShadowMaterial.clone());
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, 0.018, z + 0.22);
      scene.add(mesh);
      return mesh;
    };
    const makeSilhouette = (texture: THREE.Texture, x: number, z: number, scale: number) => {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(2.05 * scale, 1.55 * scale),
        new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.58, depthWrite: false }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = shadowProjection.rotation;
      mesh.position.set(x + shadowProjection.x, 0.028, z + shadowProjection.z);
      scene.add(mesh);
      return mesh;
    };
    const heroBlobShadow = makeBlob(layoutRig.heroX, layoutRig.heroZ, 1.15);
    const enemyBlobShadow = makeBlob(layoutRig.enemyX, layoutRig.enemyZ, 1.25);
    const heroShadow = makeSilhouette(heroSilhouetteTexture, layoutRig.heroX, layoutRig.heroZ, 1.02);
    const enemyShadow = makeSilhouette(enemySilhouetteTexture, layoutRig.enemyX, layoutRig.enemyZ, 1.08);
    heroShadow.rotation.z = shadowProjection.rotation;
    enemyShadow.rotation.z = shadowProjection.rotation;

    const isHighland = stage.id === 'highland';
    const glowTexture = makeGlowTexture();
    const glowMaterial = new THREE.SpriteMaterial({
      map: glowTexture,
      color: isHighland ? 0xd7f6be : 0xffbe56,
      transparent: true,
      opacity: isHighland ? 0 : 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const runeGlows = [
      [-4.2, 0.08, 3.0, 1.0],
      [1.15, 0.08, 1.95, 0.7],
      [4.05, 0.08, -3.15, 1.05],
      [5.75, 0.08, 4.85, 0.85],
    ].map(([x, y, z, s]) => {
      const sprite = new THREE.Sprite(glowMaterial.clone());
      sprite.position.set(x, y, z);
      sprite.scale.setScalar(s);
      scene.add(sprite);
      return sprite;
    });

    const floorLightTexture = makeGlowTexture(
      isHighland
        ? [
            [0, 'rgba(219, 255, 199, 0.74)'],
            [0.42, 'rgba(174, 226, 167, 0.2)'],
            [1, 'rgba(174, 226, 167, 0)'],
          ]
        : [
            [0, 'rgba(255, 231, 171, 0.9)'],
            [0.38, 'rgba(255, 205, 113, 0.26)'],
            [1, 'rgba(255, 205, 113, 0)'],
          ],
    );
    const floorLightMaterial = new THREE.MeshBasicMaterial({
      map: floorLightTexture,
      color: isHighland ? 0xdaf6c4 : 0xffdda0,
      transparent: true,
      opacity: isHighland ? 0.18 : 0.24,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const litPatches = [
      [-2.35, 0.04, 0.7, 2.45, 1.36],
      [2.35, 0.04, 0.05, 2.18, 1.18],
      [0.0, 0.04, -2.25, 3.55, 1.75],
    ].map(([x, y, z, sx, sz]) => {
      const patch = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz), floorLightMaterial.clone());
      patch.rotation.x = -Math.PI / 2;
      patch.position.set(x, y, z);
      scene.add(patch);
      return patch;
    });

    const makeCharacterBloom = (map: THREE.Texture, color: number, opacity: number) =>
      new THREE.SpriteMaterial({
        map,
        color,
        transparent: true,
        opacity,
        alphaTest: 0.04,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
    const heroBloom = new THREE.Sprite(makeCharacterBloom(heroTexture, isHighland ? 0xfafff0 : 0xffd99a, isHighland ? 0.13 : 0.14));
    const enemyBloom = new THREE.Sprite(makeCharacterBloom(enemyTexture, isHighland ? 0xf2fffb : 0x8ed0ff, isHighland ? 0.12 : 0.12));
    const heroDayRim = isHighland ? new THREE.Sprite(makeCharacterBloom(heroTexture, 0xffffff, 0.075)) : null;
    const enemyDayRim = isHighland ? new THREE.Sprite(makeCharacterBloom(enemyTexture, 0xf8fffb, 0.07)) : null;
    scene.add(heroBloom, enemyBloom);
    if (heroDayRim && enemyDayRim) {
      scene.add(heroDayRim, enemyDayRim);
    }

    // --- Special move (大技) aura rig ---
    const auraColor = isHighland ? 0xcdf7c2 : 0xffd089;
    const auraTexture = makeAuraTexture();
    const heroAura = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: auraTexture,
        color: auraColor,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      }),
    );
    heroAura.scale.setScalar(0.001);
    // draw behind the hero so the glow reads as a backlit halo around the
    // silhouette instead of washing out the character's front.
    heroAura.renderOrder = -1;
    scene.add(heroAura);

    const auraCore = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: auraTexture,
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      }),
    );
    auraCore.scale.setScalar(0.001);
    scene.add(auraCore);

    // an actual light so the aura illuminates the hero + nearby floor
    const auraLight = new THREE.PointLight(isHighland ? 0xe6ffd6 : 0xffcf8a, 0, 9, 1.6);
    scene.add(auraLight);

    const auraRingTexture = makeAuraRingTexture();
    const auraRing = new THREE.Mesh(
      new THREE.PlaneGeometry(3.7, 3.7),
      new THREE.MeshBasicMaterial({
        map: auraRingTexture,
        color: auraColor,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    auraRing.rotation.x = -Math.PI / 2;
    scene.add(auraRing);

    const auraEmberTexture = makeGlowTexture([
      [0, 'rgba(255, 255, 235, 1)'],
      [0.4, 'rgba(255, 210, 120, 0.5)'],
      [1, 'rgba(255, 180, 70, 0)'],
    ]);
    const auraEmberCount = 130;
    const auraEmberPositions = new Float32Array(auraEmberCount * 3);
    const auraEmberSeeds = Array.from({ length: auraEmberCount }, () => ({
      angle: Math.random() * Math.PI * 2,
      radius: 0.25 + Math.random() * 1.05,
      speed: 0.35 + Math.random() * 0.9,
      phase: Math.random(),
      swirl: (Math.random() - 0.5) * 1.6,
      height: 2.2 + Math.random() * 1.7,
    }));
    const auraEmberGeometry = new THREE.BufferGeometry();
    auraEmberGeometry.setAttribute('position', new THREE.BufferAttribute(auraEmberPositions, 3));
    const auraEmbers = new THREE.Points(
      auraEmberGeometry,
      new THREE.PointsMaterial({
        map: auraEmberTexture,
        color: isHighland ? 0xe9ffdc : 0xffe1a6,
        size: 0.12,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    scene.add(auraEmbers);

    const beamTexture = isHighland ? makeForestBeamTexture() : makeBeamTexture();
    const beamMaterial = new THREE.MeshBasicMaterial({
      map: beamTexture,
      color: isHighland ? 0xf1ffe1 : 0xffefc2,
      transparent: true,
      opacity: isHighland ? 0.78 : 0.34,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    const beamLayout = isHighland
      ? [
          { x: -4.8, y: 4.45, z: -3.2, width: 1.45, height: 9.6, rz: -0.34, ry: 0.18 },
          { x: -2.1, y: 4.3, z: -3.7, width: 1.05, height: 8.8, rz: -0.29, ry: 0.14 },
          { x: 0.7, y: 4.15, z: -4.05, width: 1.35, height: 9.4, rz: -0.25, ry: 0.1 },
          { x: 3.15, y: 4.0, z: -3.55, width: 1.0, height: 8.4, rz: -0.2, ry: 0.08 },
        ]
      : [-3.2, 0.6, 3.7].map((x, index) => ({
          x,
          y: 4.1,
          z: -2.8 - index * 0.8,
          width: 1.0 + index * 0.28,
          height: 8.5,
          rz: -0.28,
          ry: 0.18,
        }));
    const beams = beamLayout.map((layer) => {
      const beam = new THREE.Mesh(new THREE.PlaneGeometry(layer.width, layer.height), beamMaterial.clone());
      beam.position.set(layer.x, layer.y, layer.z);
      beam.rotation.z = layer.rz;
      beam.rotation.y = layer.ry;
      scene.add(beam);
      return beam;
    });

    const slashTextures = [makeSlashTexture(0), makeSlashTexture(1), makeSlashTexture(2)];
    const slashLayers = [
      { width: 4.4, height: 3.92, x: 1.05, y: 1.68, z: 0.78, rotate: -0.03, opacity: 0.78 },
      { width: 3.9, height: 3.48, x: 1.14, y: 1.56, z: 0.8, rotate: -0.07, opacity: 0.48 },
      { width: 4.0, height: 3.7, x: 0.92, y: 1.82, z: 0.82, rotate: 0.03, opacity: 0.36 },
    ];
    const slashArcs = slashTextures.map((texture, index) => {
      const layer = slashLayers[index];
      const material = makeRevealMaterial(texture, index === 1 ? 0xfff2bd : 0xcdf4ff);
      const arc = new THREE.Mesh(new THREE.PlaneGeometry(layer.width, layer.height), material);
      arc.position.set(0, layer.y, layer.z);
      arc.rotation.z = layer.rotate;
      arc.rotation.y = -0.04;
      scene.add(arc);
      return arc;
    });

    const windTexture = makeWindTexture();
    const windRibbons = [0, 1, 2].map((index) => {
      const ribbon = new THREE.Mesh(
        new THREE.PlaneGeometry(3.8 - index * 0.46, 0.64),
        new THREE.MeshBasicMaterial({
          map: windTexture,
          color: index === 1 ? 0xffe1a1 : 0xc9efff,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          depthTest: false,
          side: THREE.DoubleSide,
        }),
      );
      ribbon.position.set(-0.4 + index * 0.28, 1.85 + index * 0.18, 0.7 + index * 0.02);
      ribbon.rotation.z = -0.33 - index * 0.08;
      scene.add(ribbon);
      return ribbon;
    });

    const thrustTextures = [makeThrustTexture(0), makeThrustTexture(1), makeThrustTexture(2)];
    const thrustLayers = [
      { width: 1.18, height: 4.45, alongOffset: 0, side: 0, z: 0.9, rotate: 0, opacity: 0.86 },
      { width: 0.92, height: 4.0, alongOffset: -0.04, side: -0.06, z: 0.93, rotate: -0.02, opacity: 0.48 },
      { width: 1.46, height: 4.18, alongOffset: 0.03, side: 0.08, z: 0.88, rotate: 0.03, opacity: 0.34 },
    ];
    const thrustTrails = thrustTextures.map((texture, index) => {
      const layer = thrustLayers[index];
      const material = makeRevealMaterial(texture, index === 1 ? 0xfff0ba : 0xd3f6ff);
      material.uniforms.revealFromBottom.value = 1;
      const trail = new THREE.Mesh(new THREE.PlaneGeometry(layer.width, layer.height), material);
      trail.rotation.y = -0.05;
      scene.add(trail);
      return trail;
    });

    const shockRingTexture = makeShockRingTexture();
    const shockRingLayers = [
      { along: 0.16, side: -0.015, sizeX: 0.94, sizeY: 0.84, opacity: 0.66, delay: 0, z: -0.02 },
      { along: 0.18, side: 0.01, sizeX: 1.08, sizeY: 0.95, opacity: 0.48, delay: 0.026, z: 0 },
      { along: 0.2, side: 0.025, sizeX: 1.2, sizeY: 1.06, opacity: 0.34, delay: 0.052, z: 0.018 },
      { along: 0.46, side: 0.025, sizeX: 2.42, sizeY: 1.76, opacity: 0.4, delay: 0.04, z: 0.04 },
    ];
    const shockRings = shockRingLayers.map((layer, index) => {
      const ring = new THREE.Mesh(
        new THREE.PlaneGeometry(1.22 + index * 0.08, 1.22 + index * 0.08),
        new THREE.MeshBasicMaterial({
          map: shockRingTexture,
          color: index === 1 ? 0xffecb4 : index === 3 ? 0xe6fbff : 0xd8f6ff,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          depthTest: false,
          side: THREE.DoubleSide,
        }),
      );
      ring.rotation.z = -0.78 + index * 0.18;
      scene.add(ring);
      return ring;
    });

    const vortexTexture = makeVortexTexture();
    const vortexWinds = [0, 1, 2, 3, 4, 5].map((index) => {
      const vortex = new THREE.Mesh(
        new THREE.PlaneGeometry(2.65 + index * 0.18, 0.58 + index * 0.05),
        new THREE.MeshBasicMaterial({
          map: vortexTexture,
          color: index % 2 === 1 ? 0xfff0c0 : 0xe9fbff,
          transparent: true,
          opacity: 0,
          blending: THREE.NormalBlending,
          depthWrite: false,
          depthTest: false,
          side: THREE.DoubleSide,
        }),
      );
      vortex.rotation.z = -0.78 + index * 0.08;
      scene.add(vortex);
      return vortex;
    });

    const vortexLineCount = 5;
    const vortexLineSegments = 42;
    const vortexLinePositions = new Float32Array(vortexLineCount * vortexLineSegments * 2 * 3);
    const vortexLineSeeds = Array.from({ length: vortexLineCount }, (_, index) => ({
      phase: index * 1.42,
      amp: 0.11 + index * 0.018,
      lift: (index - 2) * 0.012,
    }));
    const vortexLineGeometry = new THREE.BufferGeometry();
    vortexLineGeometry.setAttribute('position', new THREE.BufferAttribute(vortexLinePositions, 3));
    const vortexLines = new THREE.LineSegments(
      vortexLineGeometry,
      new THREE.LineBasicMaterial({
        color: 0xf2feff,
        transparent: true,
        opacity: 0,
        blending: THREE.NormalBlending,
        depthWrite: false,
        depthTest: false,
      }),
    );
    scene.add(vortexLines);

    const hitSparkCount = 150;
    const hitPositions = new Float32Array(hitSparkCount * 3);
    const hitSeeds = Array.from({ length: hitSparkCount }, () => ({
      angle: -Math.PI * 0.18 + (Math.random() - 0.5) * Math.PI * 1.55,
      radius: Math.random() * 0.28,
      speed: 0.22 + Math.random() * 1.08,
      lift: -0.08 + Math.random() * 0.54,
    }));
    const hitGeometry = new THREE.BufferGeometry();
    hitGeometry.setAttribute('position', new THREE.BufferAttribute(hitPositions, 3));
    const hitSparks = new THREE.Points(
      hitGeometry,
      new THREE.PointsMaterial({
        color: 0xfff1b1,
        size: 0.062,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    scene.add(hitSparks);

    const hitLineCount = 18;
    const hitLinePositions = new Float32Array(hitLineCount * 2 * 3);
    const hitLineSeeds = Array.from({ length: hitLineCount }, (_, index) => ({
      angle: -Math.PI * 0.08 + (index / hitLineCount - 0.5) * Math.PI * 1.2 + (Math.random() - 0.5) * 0.28,
      length: 0.22 + Math.random() * 0.42,
      delay: index / hitLineCount * 0.28,
      lift: -0.05 + Math.random() * 0.26,
    }));
    const hitLineGeometry = new THREE.BufferGeometry();
    hitLineGeometry.setAttribute('position', new THREE.BufferAttribute(hitLinePositions, 3));
    const hitLines = new THREE.LineSegments(
      hitLineGeometry,
      new THREE.LineBasicMaterial({
        color: 0xfff6d7,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
      }),
    );
    scene.add(hitLines);

    const hitNodeTexture = makeGlowTexture([
      [0, 'rgba(255, 255, 245, 1)'],
      [0.28, 'rgba(255, 208, 92, 0.62)'],
      [1, 'rgba(255, 126, 40, 0)'],
    ]);
    const hitNodes = Array.from({ length: 7 }, (_, index) => {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: hitNodeTexture,
          color: index % 2 === 0 ? 0xfff7d2 : 0xffb447,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          depthTest: false,
        }),
      );
      scene.add(sprite);
      return sprite;
    });
    const hitStreaks = Array.from({ length: 9 }, (_, index) => {
      const streak = new THREE.Mesh(
        new THREE.PlaneGeometry(0.022, 0.5 + (index % 3) * 0.12),
        new THREE.MeshBasicMaterial({
          color: index % 2 === 0 ? 0xfff8df : 0xffb84c,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          depthTest: false,
          side: THREE.DoubleSide,
        }),
      );
      streak.rotation.z = -1.0 + index * 0.22;
      scene.add(streak);
      return streak;
    });

    const slashSparkCount = 210;
    const slashSparkPositions = new Float32Array(slashSparkCount * 3);
    const slashSparkSeeds = Array.from({ length: slashSparkCount }, () => ({
      along: Math.random(),
      drift: (Math.random() - 0.5) * 0.42,
      speed: Math.random() * 0.65 + 0.18,
      lift: (Math.random() - 0.5) * 0.48,
    }));
    const slashSparkGeometry = new THREE.BufferGeometry();
    slashSparkGeometry.setAttribute('position', new THREE.BufferAttribute(slashSparkPositions, 3));
    const slashSparks = new THREE.Points(
      slashSparkGeometry,
      new THREE.PointsMaterial({
        color: 0xdaf5ff,
        size: 0.044,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    scene.add(slashSparks);

    const thrustSparkCount = 170;
    const thrustSparkPositions = new Float32Array(thrustSparkCount * 3);
    const thrustSparkSeeds = Array.from({ length: thrustSparkCount }, () => ({
      along: Math.random(),
      side: (Math.random() - 0.5) * 0.52,
      lift: (Math.random() - 0.5) * 0.2,
      speed: 0.14 + Math.random() * 0.78,
    }));
    const thrustSparkGeometry = new THREE.BufferGeometry();
    thrustSparkGeometry.setAttribute('position', new THREE.BufferAttribute(thrustSparkPositions, 3));
    const thrustSparks = new THREE.Points(
      thrustSparkGeometry,
      new THREE.PointsMaterial({
        color: 0xe6fbff,
        size: 0.04,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    scene.add(thrustSparks);

    const smokeTexture = makeSmokeTexture();
    const smokeCount = 72;
    const smokePositions = new Float32Array(smokeCount * 3);
    const smokeSeeds = Array.from({ length: smokeCount }, () => ({
      angle: Math.random() * Math.PI * 2,
      radius: Math.random() * 0.3,
      drift: -0.65 + Math.random() * 0.5,
      lift: Math.random() * 0.42,
      wobble: Math.random() * Math.PI * 2,
    }));
    const smokeGeometry = new THREE.BufferGeometry();
    smokeGeometry.setAttribute('position', new THREE.BufferAttribute(smokePositions, 3));
    const smoke = new THREE.Points(
      smokeGeometry,
      new THREE.PointsMaterial({
        map: smokeTexture,
        color: 0xbcc8c3,
        size: 0.36,
        transparent: true,
        opacity: 0,
        blending: THREE.NormalBlending,
        depthWrite: false,
      }),
    );
    scene.add(smoke);

    const particleGeometry = new THREE.BufferGeometry();
    const particleCount = isHighland ? 180 : 440;
    const positions = new Float32Array(particleCount * 3);
    const speeds = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i += 1) {
      positions[i * 3] = (Math.random() - 0.5) * (isHighland ? 15 : 13);
      positions[i * 3 + 1] = isHighland ? Math.random() * 2.7 + 1.1 : Math.random() * 5.5 + 0.2;
      positions[i * 3 + 2] = (Math.random() - 0.5) * (isHighland ? 8 : 9) - 1.2;
      speeds[i] = Math.random() * (isHighland ? 0.08 : 0.18) + (isHighland ? 0.015 : 0.04);
    }
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const particleMaterial = new THREE.PointsMaterial({
      map: isHighland ? smokeTexture : null,
      color: isHighland ? 0xdff6ee : 0xffd887,
      size: isHighland ? 0.34 : 0.032,
      transparent: true,
      opacity: isHighland ? 0.16 : 0.52,
      blending: isHighland ? THREE.NormalBlending : THREE.AdditiveBlending,
      depthWrite: false,
    });
    const particles = new THREE.Points(particleGeometry, particleMaterial);
    scene.add(particles);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const initialPostProfile = getProfile(viewMode, initialSize.width, initialSize.width / initialSize.height);
    const initialPost = stage.post[initialPostProfile];
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(initialSize.width, initialSize.height),
      initialPost.bloomStrength,
      initialPost.bloomRadius,
      initialPost.bloomThreshold,
    );
    const bokehPass = new BokehPass(scene, camera, { focus: initialPost.focus, aperture: initialPost.aperture, maxblur: initialPost.maxblur });
    const gradePass = new ShaderPass(colorGradeShader);
    const chromaPass = new ShaderPass(chromaticAberrationShader);
    composer.addPass(bloomPass);
    composer.addPass(bokehPass);
    composer.addPass(gradePass);
    composer.addPass(chromaPass);

    // base post values for the active profile; the special move lerps away from
    // these each frame and resize() keeps them in sync with the current profile.
    const basePost = {
      bloomStrength: initialPost.bloomStrength,
      bloomRadius: initialPost.bloomRadius,
      focus: initialPost.focus,
      aperture: initialPost.aperture,
      maxblur: initialPost.maxblur,
      exposure: initialPost.exposure,
      saturation: initialPost.saturation,
    };

    const clock = new THREE.Clock();
    let raf = 0;
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const easeOutCubic = (value: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, value)), 3);
    const easeInOutCubic = (value: number) => {
      const p = Math.min(1, Math.max(0, value));
      return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    };
    const windowProgress = (progress: number, start: number, end: number) => Math.min(1, Math.max(0, (progress - start) / (end - start)));
    const pulseWindow = (progress: number, start: number, end: number) => {
      const p = windowProgress(progress, start, end);
      return p <= 0 || p >= 1 ? 0 : Math.sin(p * Math.PI);
    };
    const sampleSlashArc = (along: number, drift = 0, lift = 0) => {
      const scale = layoutRig.heroScale > 0.9 ? 1 : 0.76;
      const anchorX = layoutRig.heroX + (layoutRig.heroScale > 0.9 ? 0.58 : 0.38);
      const p = Math.min(1, Math.max(0, along));
      const inv = 1 - p;
      const texX = inv * inv * inv * 338 + 3 * inv * inv * p * 780 + 3 * inv * p * p * 850 + p * p * p * 326;
      const texY = inv * inv * inv * 88 + 3 * inv * inv * p * 118 + 3 * inv * p * p * 750 + p * p * p * 930;
      const planeWidth = 4.4 * scale;
      const planeHeight = 3.92 * scale;
      return {
        x: anchorX + 1.05 * scale + (texX / 1024 - 0.5) * planeWidth + drift * 0.1,
        y: 1.68 + (0.5 - texY / 1024) * planeHeight + drift * 0.16 + lift,
        z: 0.78 + drift * 0.1,
      };
    };
    const sampleThrustLine = (along: number, side = 0, lift = 0) => {
      const scale = layoutRig.heroScale > 0.9 ? 1 : 0.76;
      const p = Math.min(1, Math.max(0, along));
      const originX = layoutRig.heroX + 0.44 * scale;
      const originY = layoutRig.heroY - 0.2;
      const tipX = layoutRig.enemyX - 0.52 * layoutRig.enemyScale;
      const tipY = layoutRig.enemyY + 0.88;
      const dx = tipX - originX;
      const dy = tipY - originY;
      const length = Math.hypot(dx, dy) || 1;
      const normalX = -dy / length;
      const normalY = dx / length;
      return {
        x: originX + (tipX - originX) * p + normalX * side * scale,
        y: originY + (tipY - originY) * p + normalY * side * scale + lift,
        z: 0.84 + p * 0.22 + side * 0.06,
      };
    };
    const getThrustPath = () => {
      const start = sampleThrustLine(0, 0, 0);
      const end = sampleThrustLine(1, 0, 0);
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      return {
        start,
        end,
        angle: Math.atan2(dy, dx) - Math.PI / 2,
        length: Math.hypot(dx, dy),
      };
    };

    const animate = () => {
      const t = clock.getElapsedTime();
      raf = requestAnimationFrame(animate);
      const p = paramsRef.current;
      const isBattleActive = battleMode !== 'idle';
      const combatCycle = isBattleActive ? forcedBattlePhase ?? (t % 3.05) / 3.05 : 0;
      const slashBurst = pulseWindow(combatCycle, 0.32, 0.62);
      const slashDraw = easeOutCubic(windowProgress(combatCycle, 0.32, 0.42));
      const slashFade = 1 - easeOutCubic(windowProgress(combatCycle, 0.56, 0.66));
      const thrustBurst = pulseWindow(combatCycle, 0.28, 0.56);
      const thrustDraw = easeOutCubic(windowProgress(combatCycle, 0.28, 0.38));
      const thrustFade = 1 - easeOutCubic(windowProgress(combatCycle, 0.5, 0.64));
      const hitBurst = pulseWindow(combatCycle, 0.47, 0.77);
      const smokeBurst = pulseWindow(combatCycle, 0.18, 0.92);
      const windBurst = pulseWindow(combatCycle, 0.24, 0.86);
      const lunge = isBattleActive ? easeInOutCubic(windowProgress(combatCycle, 0.18, 0.4)) * (1 - easeOutCubic(windowProgress(combatCycle, 0.58, 0.94))) : 0;
      const recoil = isBattleActive ? pulseWindow(combatCycle, 0.48, 0.8) : 0;

      // --- Special move (大技) timeline ---
      const special = battleMode === 'special';
      const sp = special ? combatCycle : 0;
      const auraRise = easeOutCubic(windowProgress(sp, 0.04, 0.34));
      const auraFall = easeInOutCubic(windowProgress(sp, 0.66, 0.96));
      const aura = special ? auraRise * (1 - auraFall) : 0;
      const release = special ? pulseWindow(sp, 0.46, 0.66) : 0;
      const auraFlare = special ? Math.max(aura, release) : 0;
      // A single "push" progress drives BOTH the dolly-in and the FOV widening,
      // so the zoom and the wide-angle change happen together (true dolly zoom)
      // instead of zooming first and widening afterwards.
      const push = special ? easeInOutCubic(windowProgress(sp, 0.06, 0.42)) : 0;
      const settle = special ? easeInOutCubic(windowProgress(sp, 0.72, 0.97)) : 0;
      const cine = special ? push * (1 - settle) : 0;
      const lensT = push; // telephoto -> wide, locked to the push-in
      // hit chromatic aberration: spikes at impact then decays
      const impact = special && sp >= 0.5 ? Math.max(0, 1 - windowProgress(sp, 0.5, 0.82)) : 0;
      const chroma = impact * impact;

      floorTexture.offset.set(Math.sin(t * 0.06) * 0.006, Math.cos(t * 0.05) * 0.005);
      floorOverlayTexture?.offset.set(0.34 + Math.sin(t * 0.035) * 0.004, 0.19 + Math.cos(t * 0.04) * 0.004);
      const battleShake = isBattleActive ? Math.max(hitBurst, release) * cameraRig.shake : 0;
      const shakeX = (Math.sin(t * 54.1) + Math.sin(t * 31.7)) * 0.5 * battleShake;
      const shakeY = Math.sin(t * 45.3) * battleShake * 0.55;
      const baseCamX = cameraRig.x + Math.sin(t * 0.2) * cameraRig.swayX + shakeX;
      const baseCamY = cameraRig.y + Math.sin(t * 0.16) * cameraRig.swayY + shakeY;
      const baseCamZ = cameraRig.z + Math.sin(t * 0.13) * cameraRig.swayZ;
      const baseLookX = cameraRig.targetX + Math.sin(t * 0.17) * 0.25 + shakeX * 0.2;
      const baseLookY = cameraRig.targetY + shakeY * 0.12;
      const baseLookZ = cameraRig.targetZ;

      let camX = baseCamX;
      let camY = baseCamY;
      let camZ = baseCamZ;
      let lookX = baseLookX;
      let lookY = baseLookY;
      let lookZ = baseLookZ;
      let camFov = cameraRig.fov;

      if (special && cine > 0.0001) {
        const heroFocusX = layoutRig.heroX;
        const heroFocusY = layoutRig.heroY + 0.18;
        const heroFocusZ = layoutRig.heroZ;
        // Dolly zoom: vary the (vertical) FOV while moving the camera distance so
        // the hero keeps the same on-screen size — only the background "breathes".
        const fovDeg = lerp(p.fovTele, p.fovWide, lensT);
        const heroWorldHeight = 2.55 * layoutRig.heroScale;
        const frameFill = p.frameFill; // hero occupies this fraction of the vertical frame
        const dist = heroWorldHeight / (2 * frameFill * Math.tan((fovDeg * Math.PI) / 360));
        const dnx = 0.2;
        const dny = 0.32;
        const dnz = 1.0;
        const dlen = Math.hypot(dnx, dny, dnz);
        const handheld = Math.sin(t * 0.8) * 0.025;
        const cineX = heroFocusX + (dnx / dlen) * dist + handheld + shakeX;
        const cineY = heroFocusY + (dny / dlen) * dist + Math.sin(t * 0.62) * 0.02 + shakeY;
        const cineZ = heroFocusZ + (dnz / dlen) * dist;
        camX = lerp(baseCamX, cineX, cine);
        camY = lerp(baseCamY, cineY, cine);
        camZ = lerp(baseCamZ, cineZ, cine);
        lookX = lerp(baseLookX, heroFocusX + handheld * 0.4 + shakeX * 0.5, cine);
        lookY = lerp(baseLookY, heroFocusY + 0.42, cine);
        lookZ = lerp(baseLookZ, heroFocusZ, cine);
        camFov = lerp(cameraRig.fov, fovDeg, cine);
      }

      camera.position.set(camX, camY, camZ);
      camera.lookAt(lookX, lookY, lookZ);
      if (special) {
        camera.fov = camFov;
        camera.updateProjectionMatrix();
      }
      parallaxLayers.forEach(({ mesh, config }) => {
        mesh.position.x = config.position[0] + camera.position.x * config.drift + Math.sin(t * 0.05 + config.position[2]) * config.drift * 0.8;
      });

      if (special) {
        // Strong DOF: pull focus onto the hero, blur the background heavily.
        const heroDist = Math.hypot(camX - layoutRig.heroX, camY - (layoutRig.heroY + 0.18), camZ - layoutRig.heroZ);
        bokehPass.uniforms.focus.value = lerp(basePost.focus, heroDist, cine);
        bokehPass.uniforms.aperture.value = lerp(basePost.aperture, 0.0022 * p.dofStrength, cine);
        bokehPass.uniforms.maxblur.value = lerp(basePost.maxblur, 0.011 * p.dofStrength, cine);
        bloomPass.strength = basePost.bloomStrength + auraFlare * p.bloomBoost;
        bloomPass.radius = basePost.bloomRadius + auraFlare * 0.12;
        gradePass.uniforms.exposure.value = basePost.exposure + release * 0.2;
        gradePass.uniforms.saturation.value = basePost.saturation + release * 0.15;
        chromaPass.uniforms.amount.value = chroma * p.chroma;
        chromaPass.uniforms.blur.value = chroma * p.chroma * 1.2;
        chromaPass.uniforms.center.value.set(0.5, 0.52);
      } else {
        chromaPass.uniforms.amount.value = 0;
        chromaPass.uniforms.blur.value = 0;
      }

      const heroCombatScale = isBattleActive && combatCycle < 0.9 ? 1.12 : 1;
      const isSlashSprite = isBattleActive && combatCycle < 0.9;
      if (isSlashSprite) {
        const frame = combatCycle < 0.25 ? 0 : combatCycle < 0.4 ? 1 : combatCycle < 0.62 ? 2 : 3;
        hero.material.map = heroSlashTexture;
        heroSlashTexture.offset.x = frame / 4;
        if (hasTextureImage(heroSlashTexture)) {
          heroSlashTexture.needsUpdate = true;
        }
      } else {
        hero.material.map = heroTexture;
      }
      hero.material.needsUpdate = true;

      hero.position.x = layoutRig.heroX + lunge * (special ? 0.26 : layoutRig.heroScale > 0.9 ? 0.72 : 0.42);
      hero.position.y = layoutRig.heroY + Math.sin(t * 2.2) * 0.045 + lunge * 0.08;
      hero.position.z = layoutRig.heroZ;
      enemy.position.x = layoutRig.enemyX + recoil * 0.05;
      enemy.position.y = layoutRig.enemyY + Math.sin(t * 1.8 + 1.1) * 0.055 + recoil * 0.04;
      enemy.position.z = layoutRig.enemyZ;
      hero.scale.set(2.2 * layoutRig.heroScale * heroCombatScale, 2.48 * layoutRig.heroScale * heroCombatScale, 1);
      enemy.scale.set(2.05 * layoutRig.enemyScale, 2.4 * layoutRig.enemyScale, 1);
      heroBloom.position.copy(hero.position);
      heroBloom.position.z += 0.012;
      heroBloom.scale.set(2.3 * layoutRig.heroScale * heroCombatScale, 2.68 * layoutRig.heroScale * heroCombatScale, 1);
      enemyBloom.position.copy(enemy.position);
      enemyBloom.position.z += 0.012;
      enemyBloom.scale.set(2.2 * layoutRig.enemyScale, 2.58 * layoutRig.enemyScale, 1);
      if (heroDayRim && enemyDayRim) {
        heroDayRim.position.copy(hero.position);
        heroDayRim.position.x -= 0.035 * layoutRig.heroScale;
        heroDayRim.position.y += 0.075 * layoutRig.heroScale;
        heroDayRim.position.z += 0.018;
        heroDayRim.scale.set(2.18 * layoutRig.heroScale * heroCombatScale, 2.56 * layoutRig.heroScale * heroCombatScale, 1);
        enemyDayRim.position.copy(enemy.position);
        enemyDayRim.position.x -= 0.032 * layoutRig.enemyScale;
        enemyDayRim.position.y += 0.065 * layoutRig.enemyScale;
        enemyDayRim.position.z += 0.018;
        enemyDayRim.scale.set(2.14 * layoutRig.enemyScale, 2.5 * layoutRig.enemyScale, 1);
      }
      heroBlobShadow.position.x = hero.position.x;
      enemyBlobShadow.position.x = layoutRig.enemyX;
      heroShadow.position.x = hero.position.x + shadowProjection.x;
      enemyShadow.position.x = layoutRig.enemyX + shadowProjection.x;
      heroBlobShadow.position.z = layoutRig.heroZ + 0.22;
      enemyBlobShadow.position.z = layoutRig.enemyZ + 0.22;
      heroShadow.position.z = layoutRig.heroZ + shadowProjection.z;
      enemyShadow.position.z = layoutRig.enemyZ + shadowProjection.z;
      heroBlobShadow.scale.setScalar(1 + Math.sin(t * 2.2) * 0.025);
      enemyBlobShadow.scale.setScalar(1 + Math.sin(t * 1.8 + 1.1) * 0.03);
      heroShadow.scale.setScalar(1 + Math.sin(t * 2.2) * 0.018);
      enemyShadow.scale.setScalar(1 + Math.sin(t * 1.8 + 1.1) * 0.02);

      // --- aura / special-move visuals ---
      // Keep the glow as a character-sized rim/backlight, not a screen-filling
      // fireball — the hero must stay clearly readable through it.
      const auraPulse = aura * (0.85 + Math.sin(t * 9.0) * 0.15);
      const auraK = p.auraIntensity;
      heroAura.position.set(hero.position.x, hero.position.y + 0.12, hero.position.z - 0.08);
      heroAura.scale.setScalar((2.55 + Math.sin(t * 4.0) * 0.18 + release * 0.8) * layoutRig.heroScale);
      (heroAura.material as THREE.SpriteMaterial).opacity = Math.min(0.7, (auraPulse * 0.22 + release * 0.2) * auraK);
      auraCore.position.set(hero.position.x, hero.position.y + 0.18, hero.position.z - 0.06);
      auraCore.scale.setScalar((0.85 + release * 0.8) * layoutRig.heroScale);
      (auraCore.material as THREE.SpriteMaterial).opacity = Math.min(0.6, (aura * 0.07 + release * 0.3) * auraK);
      auraLight.position.set(hero.position.x, hero.position.y + 0.2, hero.position.z + 0.6);
      auraLight.intensity = auraFlare * p.auraLight;
      auraRing.position.set(hero.position.x, 0.05, layoutRig.heroZ + 0.18);
      auraRing.scale.setScalar((0.95 + easeOutCubic(aura) * 0.5 + release * 0.3) * layoutRig.heroScale);
      (auraRing.material as THREE.MeshBasicMaterial).opacity = (aura * 0.3 + release * 0.18) * auraK;
      auraRing.rotation.z = t * 0.6;
      const auraEmberArr = auraEmberGeometry.attributes.position.array as Float32Array;
      for (let i = 0; i < auraEmberCount; i += 1) {
        const seed = auraEmberSeeds[i];
        const rise = (seed.phase + t * seed.speed * 0.35) % 1;
        const swirlAngle = seed.angle + rise * seed.swirl * Math.PI;
        const radius = seed.radius * (1 - rise * 0.5);
        auraEmberArr[i * 3] = hero.position.x + Math.cos(swirlAngle) * radius;
        auraEmberArr[i * 3 + 1] = hero.position.y - 1.0 + rise * seed.height;
        auraEmberArr[i * 3 + 2] = hero.position.z + Math.sin(swirlAngle) * radius * 0.6 + 0.04;
      }
      auraEmberGeometry.attributes.position.needsUpdate = true;
      (auraEmbers.material as THREE.PointsMaterial).opacity = aura * 0.6 * auraK;
      (auraEmbers.material as THREE.PointsMaterial).size = (0.1 + aura * 0.07) * (layoutRig.heroScale > 0.9 ? 1 : 0.8);

      runeGlows.forEach((glow, i) => {
        glow.material.opacity = 0.5 + Math.sin(t * 1.8 + i * 1.7) * 0.16;
        glow.scale.setScalar(0.82 + Math.sin(t * 1.3 + i) * 0.08);
      });
      beams.forEach((beam, i) => {
        beam.material.opacity = 0.17 + Math.sin(t * 0.8 + i) * 0.04;
      });
      litPatches.forEach((patch, i) => {
        patch.material.opacity = 0.16 + Math.sin(t * 0.75 + i) * 0.035;
      });

      const slashCenterX = layoutRig.heroX + (layoutRig.heroScale > 0.9 ? 0.58 : 0.38);
      slashArcs.forEach((arc, i) => {
        const layer = slashLayers[i];
        const layerDelay = i * 0.01;
        const draw = easeOutCubic(windowProgress(combatCycle, 0.32 + layerDelay, 0.42 + layerDelay));
        const wipe = easeOutCubic(windowProgress(combatCycle, 0.47 + layerDelay, 0.62 + layerDelay));
        const fade = 1 - easeOutCubic(windowProgress(combatCycle, 0.6 + layerDelay, 0.68 + layerDelay));
        const material = arc.material as THREE.ShaderMaterial;
        arc.position.set(slashCenterX + layer.x * layoutRig.heroScale, layer.y, layer.z);
        arc.scale.setScalar(layoutRig.heroScale > 0.9 ? 1 : 0.76);
        material.uniforms.revealHead.value = Math.min(1.04, -0.1 + draw * 1.14);
        material.uniforms.revealTail.value = Math.max(-0.12, -0.12 + wipe * 1.2);
        material.uniforms.opacity.value = battleMode === 'slash' || special ? Math.max(0, fade) * layer.opacity : 0;
      });

      windRibbons.forEach((ribbon, i) => {
        const localPulse = Math.max(0, windBurst - i * 0.07);
        ribbon.position.x = layoutRig.heroX + 1.12 + i * 0.34;
        ribbon.position.y = 1.5 + i * 0.19 + Math.sin(t * 3.4 + i) * 0.018;
        ribbon.position.z = 0.66 + i * 0.035;
        ribbon.scale.set(0.85 + slashDraw * 0.2, 0.4 + localPulse * 0.14, 1);
        ribbon.material.opacity = battleMode === 'slash' || special ? localPulse * slashFade * (0.26 - i * 0.04) : 0;
      });

      const thrustPath = getThrustPath();
      thrustTrails.forEach((trail, i) => {
        const layer = thrustLayers[i];
        const layerDelay = i * 0.012;
        const draw = easeOutCubic(windowProgress(combatCycle, 0.28 + layerDelay, 0.38 + layerDelay));
        const wipe = easeOutCubic(windowProgress(combatCycle, 0.43 + layerDelay, 0.56 + layerDelay));
        const fade = 1 - easeOutCubic(windowProgress(combatCycle, 0.52 + layerDelay, 0.66 + layerDelay));
        const material = trail.material as THREE.ShaderMaterial;
        const center = sampleThrustLine(0.5 + layer.alongOffset, layer.side, 0);
        trail.position.set(center.x, center.y, layer.z);
        trail.rotation.z = thrustPath.angle + layer.rotate;
        trail.scale.set(layoutRig.heroScale > 0.9 ? 1 : 0.78, (thrustPath.length / layer.height) * 1.02, 1);
        material.uniforms.revealHead.value = Math.min(1.06, -0.08 + draw * 1.16);
        material.uniforms.revealTail.value = Math.max(-0.12, -0.12 + wipe * 1.18);
        material.uniforms.opacity.value = battleMode === 'thrust' ? Math.max(0, fade) * layer.opacity : 0;
      });

      shockRings.forEach((ring, i) => {
        const layer = shockRingLayers[i];
        const local = windowProgress(combatCycle, 0.2 + layer.delay, 0.5 + layer.delay);
        const flash = local <= 0 || local >= 1 ? 0 : Math.sin(local * Math.PI);
        const point = sampleThrustLine(layer.along, layer.side + Math.sin(t * 3.1 + i) * 0.008, 0.08);
        ring.position.set(
          point.x,
          point.y + (i === 3 ? 0.03 : 0),
          point.z + layer.z,
        );
        ring.scale.set(
          (layer.sizeX + easeOutCubic(local) * (0.22 + i * 0.04)) * layoutRig.heroScale,
          (layer.sizeY + easeOutCubic(local) * (0.14 + i * 0.03)) * layoutRig.heroScale,
          1,
        );
        ring.rotation.z = thrustPath.angle + Math.PI / 2 - 0.16 + Math.sin(t * 2.2 + i) * 0.022;
        ring.material.opacity = battleMode === 'thrust' ? flash * (i === 3 ? Math.max(thrustFade, 0.62) : thrustFade) * layer.opacity : 0;
      });

      vortexWinds.forEach((vortex, i) => {
        const localPulse = Math.max(0, windBurst - i * 0.045);
        const along = 0.16 + i * 0.105 + Math.sin(t * 1.8 + i) * 0.014;
        const side = Math.sin(t * (2.4 + i * 0.18) + i) * (0.09 + i * 0.012);
        const point = sampleThrustLine(along, side, 0.012 * i);
        vortex.position.set(point.x, point.y, point.z + 0.11 + i * 0.02);
        vortex.scale.set(0.84 + thrustDraw * 0.32 + i * 0.04, 0.66 + localPulse * 0.28, 1);
        vortex.rotation.z = thrustPath.angle + Math.PI / 2 + Math.sin(t * 2.2 + i) * 0.11;
        vortex.material.opacity = battleMode === 'thrust' ? localPulse * thrustFade * (0.52 - i * 0.052) : 0;
      });

      const vortexLineArr = vortexLineGeometry.attributes.position.array as Float32Array;
      let vortexLineOffset = 0;
      vortexLineSeeds.forEach((seed, lineIndex) => {
        for (let segment = 0; segment < vortexLineSegments; segment += 1) {
          const p0 = 0.16 + (segment / vortexLineSegments) * 0.62;
          const p1 = 0.16 + ((segment + 1) / vortexLineSegments) * 0.62;
          const envelope0 = Math.sin((p0 - 0.16) / 0.62 * Math.PI);
          const envelope1 = Math.sin((p1 - 0.16) / 0.62 * Math.PI);
          const side0 = Math.sin((p0 * 5.4 + t * 0.82 + seed.phase) * Math.PI) * seed.amp * envelope0;
          const side1 = Math.sin((p1 * 5.4 + t * 0.82 + seed.phase) * Math.PI) * seed.amp * envelope1;
          const point0 = sampleThrustLine(p0, side0, seed.lift + Math.cos(p0 * Math.PI * 5 + seed.phase) * 0.018 * envelope0);
          const point1 = sampleThrustLine(p1, side1, seed.lift + Math.cos(p1 * Math.PI * 5 + seed.phase) * 0.018 * envelope1);
          vortexLineArr[vortexLineOffset] = point0.x;
          vortexLineArr[vortexLineOffset + 1] = point0.y;
          vortexLineArr[vortexLineOffset + 2] = point0.z + 0.18 + lineIndex * 0.006;
          vortexLineArr[vortexLineOffset + 3] = point1.x;
          vortexLineArr[vortexLineOffset + 4] = point1.y;
          vortexLineArr[vortexLineOffset + 5] = point1.z + 0.18 + lineIndex * 0.006;
          vortexLineOffset += 6;
        }
      });
      vortexLineGeometry.attributes.position.needsUpdate = true;
      vortexLines.material.opacity = battleMode === 'thrust' ? windBurst * thrustFade * 0.24 : 0;

      const hitArr = hitGeometry.attributes.position.array as Float32Array;
      const hitAge = windowProgress(combatCycle, 0.47, 0.77);
      const hitOriginX = layoutRig.enemyX - 0.46;
      const hitOriginY = layoutRig.enemyY + 0.7;
      const hitOriginZ = enemy.position.z + 0.16;
      for (let i = 0; i < hitSparkCount; i += 1) {
        const seed = hitSeeds[i];
        const distance = seed.radius + easeOutCubic(hitAge) * seed.speed;
        hitArr[i * 3] = hitOriginX + Math.cos(seed.angle) * distance * 0.42;
        hitArr[i * 3 + 1] = hitOriginY + Math.sin(seed.angle) * distance * 0.28 + seed.lift * hitAge;
        hitArr[i * 3 + 2] = hitOriginZ + Math.sin(seed.angle * 1.7) * distance * 0.1;
      }
      hitGeometry.attributes.position.needsUpdate = true;
      hitSparks.material.opacity = isBattleActive ? hitBurst * 0.5 : 0;
      hitSparks.material.size = 0.028 + hitBurst * 0.034;

      const hitLineArr = hitLineGeometry.attributes.position.array as Float32Array;
      hitLineSeeds.forEach((seed, i) => {
        const local = windowProgress(hitAge, seed.delay, seed.delay + 0.28);
        const flash = local <= 0 || local >= 1 ? 0 : Math.sin(local * Math.PI);
        const length = seed.length * (0.38 + easeOutCubic(local) * 0.92) * flash;
        const spread = 0.12 + local * 0.34;
        const baseX = hitOriginX + Math.cos(seed.angle) * spread * 0.34;
        const baseY = hitOriginY + Math.sin(seed.angle) * spread * 0.26 + seed.lift * local;
        const baseZ = hitOriginZ + Math.sin(seed.angle * 1.3) * 0.05;
        const dx = Math.cos(seed.angle) * length;
        const dy = Math.sin(seed.angle) * length * 0.62;
        const offset = i * 6;
        hitLineArr[offset] = baseX - dx * 0.28;
        hitLineArr[offset + 1] = baseY - dy * 0.28;
        hitLineArr[offset + 2] = baseZ;
        hitLineArr[offset + 3] = baseX + dx;
        hitLineArr[offset + 4] = baseY + dy;
        hitLineArr[offset + 5] = baseZ + 0.01;
      });
      hitLineGeometry.attributes.position.needsUpdate = true;
      hitLines.material.opacity = isBattleActive ? Math.min(1, hitBurst * 1.25) : 0;
      hitNodes.forEach((node, i) => {
        const local = windowProgress(hitAge, i * 0.045, 0.28 + i * 0.045);
        const flash = local <= 0 || local >= 1 ? 0 : Math.sin(local * Math.PI);
        const angle = -0.55 + i * 0.18;
        const spread = 0.16 + i * 0.035 + local * 0.16;
        node.position.set(
          hitOriginX + Math.cos(angle) * spread,
          hitOriginY + Math.sin(angle) * spread * 0.62 + (i % 3) * 0.08,
          hitOriginZ + 0.02 + i * 0.004,
        );
        node.scale.setScalar((0.2 + i * 0.018 + flash * 0.22) * layoutRig.enemyScale);
        node.material.opacity = isBattleActive ? flash * 0.66 : 0;
      });
      hitStreaks.forEach((streak, i) => {
        const local = windowProgress(hitAge, i * 0.035, 0.2 + i * 0.035);
        const flash = local <= 0 || local >= 1 ? 0 : Math.sin(local * Math.PI);
        const angle = -0.95 + i * 0.22;
        const spread = 0.08 + easeOutCubic(local) * 0.16;
        streak.position.set(
          hitOriginX + Math.cos(angle) * spread * 0.58,
          hitOriginY + Math.sin(angle) * spread * 0.48 + (i % 2) * 0.07,
          hitOriginZ + 0.04 + i * 0.006,
        );
        streak.rotation.z = angle + Math.PI / 2;
        streak.scale.set(0.34 + flash * 0.22, 0.18 + flash * 0.34, 1);
        streak.material.opacity = isBattleActive ? flash * (0.16 + (i % 3) * 0.04) : 0;
      });

      const slashSparkArr = slashSparkGeometry.attributes.position.array as Float32Array;
      const slashAge = windowProgress(combatCycle, 0.32, 0.62);
      const sparkHead = Math.min(1, 0.08 + slashDraw * 0.92);
      const sparkTail = Math.max(0, sparkHead - 0.52 + windowProgress(combatCycle, 0.47, 0.62) * 0.9);
      for (let i = 0; i < slashSparkCount; i += 1) {
        const seed = slashSparkSeeds[i];
        const along = sparkTail + seed.along * Math.max(0.04, sparkHead - sparkTail);
        const point = sampleSlashArc(along, seed.drift, seed.lift * slashAge);
        slashSparkArr[i * 3] = point.x;
        slashSparkArr[i * 3 + 1] = point.y;
        slashSparkArr[i * 3 + 2] = point.z;
      }
      slashSparkGeometry.attributes.position.needsUpdate = true;
      slashSparks.material.opacity = battleMode === 'slash' || special ? slashBurst * 0.56 : 0;
      slashSparks.material.size = 0.024 + slashBurst * 0.032;

      const thrustSparkArr = thrustSparkGeometry.attributes.position.array as Float32Array;
      const thrustAge = windowProgress(combatCycle, 0.28, 0.58);
      const thrustHead = Math.min(1, 0.08 + thrustDraw * 0.96);
      const thrustTail = Math.max(0, thrustHead - 0.42 + windowProgress(combatCycle, 0.42, 0.58) * 0.86);
      for (let i = 0; i < thrustSparkCount; i += 1) {
        const seed = thrustSparkSeeds[i];
        const along = thrustTail + seed.along * Math.max(0.04, thrustHead - thrustTail);
        const side = seed.side * (0.25 + thrustAge * 0.9) + Math.sin(t * seed.speed + i) * 0.025;
        const point = sampleThrustLine(along, side, seed.lift * thrustAge);
        thrustSparkArr[i * 3] = point.x;
        thrustSparkArr[i * 3 + 1] = point.y;
        thrustSparkArr[i * 3 + 2] = point.z;
      }
      thrustSparkGeometry.attributes.position.needsUpdate = true;
      thrustSparks.material.opacity = battleMode === 'thrust' ? thrustBurst * 0.62 : 0;
      thrustSparks.material.size = 0.022 + thrustBurst * 0.038;

      const smokeArr = smokeGeometry.attributes.position.array as Float32Array;
      const smokeAge = windowProgress(combatCycle, 0.18, 0.92);
      for (let i = 0; i < smokeCount; i += 1) {
        const seed = smokeSeeds[i];
        const spread = seed.radius + smokeAge * (0.48 + i / smokeCount * 0.28);
        smokeArr[i * 3] = layoutRig.heroX - 0.06 + Math.cos(seed.angle) * spread + seed.drift * smokeAge;
        smokeArr[i * 3 + 1] = layoutRig.heroY - 1 + seed.lift * smokeAge + Math.sin(t * 1.4 + seed.wobble) * 0.025;
        smokeArr[i * 3 + 2] = layoutRig.heroZ + 0.06 + Math.sin(seed.angle) * spread * 0.7;
      }
      smokeGeometry.attributes.position.needsUpdate = true;
      smoke.material.opacity = battleMode === 'slash' || special ? smokeBurst * 0.36 : 0;
      smoke.material.size = (layoutRig.heroScale > 0.9 ? 0.24 : 0.18) + smokeAge * 0.34;

      const arr = particleGeometry.attributes.position.array as Float32Array;
      for (let i = 0; i < particleCount; i += 1) {
        if (isHighland) {
          arr[i * 3] += speeds[i] * 0.018 + Math.sin(t * 0.42 + i) * 0.0015;
          arr[i * 3 + 1] += Math.sin(t * 0.28 + i * 0.37) * 0.0008;
          arr[i * 3 + 2] += Math.cos(t * 0.22 + i) * 0.0009;
          if (arr[i * 3] > 7.6) arr[i * 3] = -7.6;
        } else {
          arr[i * 3 + 1] -= speeds[i] * 0.012;
          arr[i * 3] += Math.sin(t + i) * 0.0009;
          if (arr[i * 3 + 1] < 0.1) arr[i * 3 + 1] = 5.8;
        }
      }
      particleGeometry.attributes.position.needsUpdate = true;

      composer.render();
    };
    animate();

    const resize = () => {
      const { width, height } = getViewportSize(mount);
      if (width <= 0 || height <= 0) return;
      const aspect = width / height;
      const profile = getProfile(viewMode, width, aspect);
      const isPhone = profile === 'sp';
      const cameraProfile = stage.camera[profile];
      const layoutProfile = stage.layout[profile];
      cameraRig.fov = resolveFov(cameraProfile.fov, aspect);
      cameraRig.x = cameraProfile.position[0];
      cameraRig.y = cameraProfile.position[1];
      cameraRig.z = cameraProfile.position[2] / cameraProfile.zoom;
      cameraRig.targetX = cameraProfile.target[0];
      cameraRig.targetY = cameraProfile.target[1];
      cameraRig.targetZ = cameraProfile.target[2];
      cameraRig.swayX = cameraProfile.idleSway[0];
      cameraRig.swayY = cameraProfile.idleSway[1];
      cameraRig.swayZ = cameraProfile.idleSway[2];
      cameraRig.zoom = cameraProfile.zoom;
      cameraRig.shake = cameraProfile.shake;
      layoutRig.heroX = layoutProfile.hero[0];
      layoutRig.heroY = layoutProfile.hero[1];
      layoutRig.heroZ = layoutProfile.hero[2];
      layoutRig.enemyX = layoutProfile.enemy[0];
      layoutRig.enemyY = layoutProfile.enemy[1];
      layoutRig.enemyZ = layoutProfile.enemy[2];
      layoutRig.heroScale = layoutProfile.heroScale;
      layoutRig.enemyScale = layoutProfile.enemyScale;
      camera.fov = cameraRig.fov;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      const post = stage.post[profile];
      bloomPass.strength = post.bloomStrength;
      bloomPass.radius = post.bloomRadius;
      bloomPass.threshold = post.bloomThreshold;
      bokehPass.uniforms.focus.value = post.focus;
      bokehPass.uniforms.aperture.value = post.aperture;
      bokehPass.uniforms.maxblur.value = post.maxblur;
      gradePass.uniforms.exposure.value = post.exposure;
      gradePass.uniforms.saturation.value = post.saturation;
      gradePass.uniforms.warmth.value = post.warmth;
      gradePass.uniforms.vignette.value = post.vignette;
      basePost.bloomStrength = post.bloomStrength;
      basePost.bloomRadius = post.bloomRadius;
      basePost.focus = post.focus;
      basePost.aperture = post.aperture;
      basePost.maxblur = post.maxblur;
      basePost.exposure = post.exposure;
      basePost.saturation = post.saturation;
      particleMaterial.size = isHighland ? (isPhone ? 0.26 : 0.36) : (isPhone ? 0.024 : 0.034);
      particleMaterial.opacity = isHighland ? (isPhone ? 0.12 : 0.16) : (isPhone ? 0.3 : 0.5);
      renderer.setSize(width, height, false);
      renderer.setViewport(0, 0, width, height);
      renderer.setScissorTest(false);
      composer.setSize(width, height);

      if (showDebug) {
        const mountRect = mount.getBoundingClientRect();
        const canvasRect = renderer.domElement.getBoundingClientRect();
        const rendererSize = renderer.getSize(new THREE.Vector2());
        const cssSize = getCssViewportSize(mount);
        mount.dataset.debug = [
          `css viewport ${window.innerWidth}x${window.innerHeight} dpr ${window.devicePixelRatio}`,
          `outer ${window.outerWidth}x${window.outerHeight}`,
          `screen ${window.screen.width}x${window.screen.height}`,
          `css measured ${cssSize.width}x${cssSize.height}`,
          `mount ${Math.round(mountRect.width)}x${Math.round(mountRect.height)}`,
          `canvas css ${Math.round(canvasRect.width)}x${Math.round(canvasRect.height)}`,
          `canvas buffer ${renderer.domElement.width}x${renderer.domElement.height}`,
          `renderer ${Math.round(rendererSize.x)}x${Math.round(rendererSize.y)}`,
          `used ${width}x${height}`,
          `profile ${profile}`,
        ].join(' / ');
      }
    };
    resize();
    window.addEventListener('resize', resize);
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      resizeObserver.disconnect();
      mount.removeChild(renderer.domElement);
      composer.dispose();
      renderer.dispose();
      heroSilhouetteTexture.userData.cancelled = true;
      enemySilhouetteTexture.userData.cancelled = true;
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Sprite || object instanceof THREE.Points || object instanceof THREE.LineSegments) {
          object.geometry?.dispose?.();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
      [
        floorTexture,
        floorOverlayTexture,
        backdropTexture,
        ...parallaxTextures,
        forestSkirtTexture,
        forestDepthMistTexture,
        heroTexture,
        heroSlashTexture,
        enemyTexture,
        glowTexture,
        auraTexture,
        auraRingTexture,
        auraEmberTexture,
        beamTexture,
        blobShadowTexture,
        heroSilhouetteTexture,
        enemySilhouetteTexture,
        floorLightTexture,
        ...slashTextures,
        ...thrustTextures,
        shockRingTexture,
        vortexTexture,
        windTexture,
        hitNodeTexture,
        smokeTexture,
      ].forEach((texture) => texture?.dispose());
    };
  }, [viewMode, battleMode, stageId]);

  return <div className="scene" ref={mountRef} />;
}

const TUNER_FIELDS: Array<{ key: keyof TunerParams; label: string; min: number; max: number; step: number }> = [
  { key: 'auraIntensity', label: 'オーラ強度', min: 0, max: 2, step: 0.05 },
  { key: 'auraLight', label: 'オーラ光量', min: 0, max: 10, step: 0.1 },
  { key: 'frameFill', label: 'ズーム量', min: 0.4, max: 0.9, step: 0.01 },
  { key: 'fovTele', label: '望遠FOV', min: 12, max: 45, step: 1 },
  { key: 'fovWide', label: '広角FOV', min: 40, max: 80, step: 1 },
  { key: 'dofStrength', label: 'ボケ強度', min: 0, max: 2.5, step: 0.05 },
  { key: 'bloomBoost', label: 'ブルーム', min: 0, max: 1, step: 0.02 },
  { key: 'chroma', label: '色収差', min: 0, max: 0.05, step: 0.002 },
];

function formatTunerValue(value: number, step: number) {
  const decimals = step < 0.01 ? 3 : step < 1 ? 2 : 0;
  return value.toFixed(decimals);
}

function TunerPanel({
  open,
  params,
  onChange,
  onToggle,
  onReset,
}: {
  open: boolean;
  params: TunerParams;
  onChange: (next: TunerParams) => void;
  onToggle: () => void;
  onReset: () => void;
}) {
  return (
    <div className="tuner" aria-label="大技パラメータ調整">
      {open && (
        <div className="tuner-body">
          <div className="tuner-title">大技 調整 <span>（大技POC中に反映）</span></div>
          {TUNER_FIELDS.map((field) => (
            <label className="tuner-row" key={field.key}>
              <span className="tuner-name">{field.label}</span>
              <input
                type="range"
                min={field.min}
                max={field.max}
                step={field.step}
                value={params[field.key]}
                onChange={(event) => onChange({ ...params, [field.key]: Number(event.target.value) })}
              />
              <span className="tuner-value">{formatTunerValue(params[field.key], field.step)}</span>
            </label>
          ))}
          <button className="tuner-reset" onClick={onReset} type="button">
            リセット
          </button>
        </div>
      )}
      <button className="tuner-toggle" onClick={onToggle} type="button">
        {open ? '× 調整パネル' : '⚙ 調整'}
      </button>
    </div>
  );
}

function App() {
  const [viewMode, setViewMode] = useState<ViewMode>('auto');
  const [battleMode, setBattleMode] = useState<BattleMode>(() => {
    const battle = new URLSearchParams(window.location.search).get('battle');
    return battle === 'slash' || battle === 'thrust' || battle === 'special' ? battle : 'idle';
  });
  const [stageId, setStageId] = useState<StageId>(() => {
    const stage = new URLSearchParams(window.location.search).get('stage');
    return stage === 'sanctum' || stage === 'highland' ? stage : 'dungeon';
  });
  const [tunerParams, setTunerParams] = useState<TunerParams>(DEFAULT_TUNER);
  const [tunerOpen, setTunerOpen] = useState(false);
  const tunerParamsRef = useRef<TunerParams>(tunerParams);
  // keep the ref in sync so the running animation loop reads live values without
  // tearing down and rebuilding the scene on every slider tick.
  tunerParamsRef.current = tunerParams;

  return (
    <>
      <DungeonScene viewMode={viewMode} battleMode={battleMode} stageId={stageId} paramsRef={tunerParamsRef} />
      <div className="battle-switch" aria-label="戦闘演出切替">
        {([
          ['idle', '待機'],
          ['slash', '斬撃POC'],
          ['thrust', '突きPOC'],
          ['special', '大技POC'],
        ] as const).map(([mode, label]) => (
          <button
            className={battleMode === mode ? 'active' : ''}
            key={mode}
            onClick={() => setBattleMode(mode)}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
      <div className="stage-switch" aria-label="stage switch">
        {STAGE_IDS.map((id) => (
          <button
            className={stageId === id ? 'active' : ''}
            key={id}
            onClick={() => setStageId(id)}
            type="button"
          >
            {STAGES[id].label}
          </button>
        ))}
      </div>
      <div className="view-switch" aria-label="表示モード切替">
        {(['auto', 'pc', 'sp'] as const).map((mode) => (
          <button
            className={viewMode === mode ? 'active' : ''}
            key={mode}
            onClick={() => setViewMode(mode)}
            type="button"
          >
            {mode.toUpperCase()}
          </button>
        ))}
      </div>
      <TunerPanel
        open={tunerOpen}
        params={tunerParams}
        onChange={setTunerParams}
        onToggle={() => setTunerOpen((open) => !open)}
        onReset={() => setTunerParams(DEFAULT_TUNER)}
      />
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
