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
  hero: 'assets/hero.png',
  heroSlash: 'assets/hero-slash-sheet.png',
  enemy: 'assets/enemy.png',
};

type ViewMode = 'auto' | 'pc' | 'sp';
type BattleMode = 'idle' | 'slash';

const BACKDROP_WORLD_HEIGHT = 34;
const BACKDROP_FALLBACK_ASPECT = 1578 / 997;

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

function makeSlashTexture(layer = 0) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.translate(74, 392 + layer * 8);
  ctx.rotate(-0.08 + layer * 0.018);
  ctx.lineCap = 'round';

  const outer = ctx.createLinearGradient(0, 0, 930, -260);
  outer.addColorStop(0, 'rgba(92, 188, 255, 0)');
  outer.addColorStop(0.18, 'rgba(126, 220, 255, 0.2)');
  outer.addColorStop(0.48, layer === 1 ? 'rgba(255, 234, 154, 0.6)' : 'rgba(205, 244, 255, 0.56)');
  outer.addColorStop(0.74, 'rgba(164, 226, 255, 0.28)');
  outer.addColorStop(1, 'rgba(92, 188, 255, 0)');

  ctx.strokeStyle = outer;
  ctx.lineWidth = 112 - layer * 24;
  ctx.beginPath();
  ctx.moveTo(26 + layer * 24, 0);
  ctx.bezierCurveTo(230, -225 - layer * 25, 590, -318 + layer * 9, 930 - layer * 48, -98 + layer * 20);
  ctx.stroke();

  ctx.globalCompositeOperation = 'destination-out';
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
  ctx.lineWidth = 70 - layer * 14;
  ctx.beginPath();
  ctx.moveTo(92 + layer * 24, -2);
  ctx.bezierCurveTo(288, -160 - layer * 8, 590, -212 + layer * 14, 872 - layer * 58, -70 + layer * 16);
  ctx.stroke();
  ctx.lineWidth = 30 - layer * 5;
  ctx.beginPath();
  ctx.moveTo(116 + layer * 22, 14);
  ctx.bezierCurveTo(326, -88, 590, -130, 824 - layer * 54, -48 + layer * 12);
  ctx.stroke();

  ctx.globalCompositeOperation = 'source-over';
  const core = ctx.createLinearGradient(40, 0, 900, -220);
  core.addColorStop(0, 'rgba(255, 255, 255, 0)');
  core.addColorStop(0.32, 'rgba(227, 249, 255, 0.56)');
  core.addColorStop(0.54, 'rgba(255, 248, 203, 0.66)');
  core.addColorStop(0.78, 'rgba(210, 244, 255, 0.28)');
  core.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.strokeStyle = core;
  ctx.lineWidth = 9 - layer * 1.8;
  ctx.beginPath();
  ctx.moveTo(64 + layer * 30, -4);
  ctx.bezierCurveTo(250, -184 - layer * 8, 584, -250 + layer * 10, 890 - layer * 55, -88 + layer * 17);
  ctx.stroke();

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
      uniform vec3 tint;
      varying vec2 vUv;
      void main() {
        vec4 texel = texture2D(map, vUv);
        float head = 1.0 - smoothstep(revealHead, revealHead + 0.12, vUv.x);
        float tail = smoothstep(revealTail - 0.12, revealTail, vUv.x);
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
    texture.needsUpdate = true;
  };
  image.src = src;

  return texture;
}

function DungeonScene({ viewMode, battleMode }: { viewMode: ViewMode; battleMode: BattleMode }) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current!;
    const params = new URLSearchParams(window.location.search);
    const showDebug = params.has('debug');
    const forcedBattlePhase = params.has('phase') ? Math.min(1, Math.max(0, Number(params.get('phase')) || 0)) : null;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x081019);
    scene.fog = new THREE.FogExp2(0x0c1a28, 0.039);

    const initialSize = getViewportSize(mount);
    const camera = new THREE.PerspectiveCamera(36, initialSize.width / initialSize.height, 0.1, 100);
    camera.position.set(0, 7.6, 10.8);
    camera.lookAt(0, 0.4, -0.8);
    const cameraRig = {
      fov: 36,
      y: 7.55,
      z: 10.8,
      targetY: 0.42,
      targetZ: -0.8,
    };
    const layoutRig = {
      heroX: -2.25,
      enemyX: 2.45,
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
    const floorTexture = loader.load(ASSETS.floor);
    floorTexture.colorSpace = THREE.SRGBColorSpace;
    floorTexture.wrapS = THREE.RepeatWrapping;
    floorTexture.wrapT = THREE.RepeatWrapping;
    floorTexture.repeat.set(4.6, 3.1);
    floorTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(96, 64, 160, 120),
      new THREE.MeshStandardMaterial({
        map: floorTexture,
        roughness: 0.82,
        metalness: 0.02,
        emissive: new THREE.Color(0x1c1408),
        emissiveIntensity: 0.24,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    let backdrop: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
    const backdropTexture = loader.load(ASSETS.backdrop, (texture) => {
      fitBackdropToTexture(backdrop, texture);
    });
    backdropTexture.colorSpace = THREE.SRGBColorSpace;
    backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(BACKDROP_WORLD_HEIGHT * BACKDROP_FALLBACK_ASPECT, BACKDROP_WORLD_HEIGHT),
      new THREE.MeshBasicMaterial({ map: backdropTexture, transparent: true }),
    );
    backdrop.position.set(0, 4.9, -8.4);
    scene.add(backdrop);

    const backMist = new THREE.Mesh(
      new THREE.PlaneGeometry(136, 24),
      new THREE.MeshBasicMaterial({ color: 0x80bedf, transparent: true, opacity: 0.09, depthWrite: false }),
    );
    backMist.position.set(0, 4.2, -7.8);
    scene.add(backMist);

    const ambient = new THREE.HemisphereLight(0xc6ddff, 0x1c252d, 1.78);
    scene.add(ambient);

    const moon = new THREE.DirectionalLight(0xe7f3ff, 3.55);
    moon.position.set(-4.8, 9, 5.5);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    moon.shadow.camera.left = -8;
    moon.shadow.camera.right = 8;
    moon.shadow.camera.top = 8;
    moon.shadow.camera.bottom = -8;
    scene.add(moon);

    const crystal = new THREE.PointLight(0xffb847, 5.05, 10.5, 1.7);
    crystal.position.set(4.9, 1.9, -1.6);
    scene.add(crystal);

    const heroKey = new THREE.PointLight(0xffd28e, 2.15, 5.2, 1.32);
    heroKey.position.set(-2.7, 2.35, 1.9);
    scene.add(heroKey);

    const enemyRim = new THREE.PointLight(0x78c0ff, 2.55, 5.0, 1.3);
    enemyRim.position.set(2.0, 2.3, 0.9);
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
    hero.position.set(-2.25, 1.28, 0.5);
    hero.scale.set(2.0, 2.35, 1);
    scene.add(hero);

    const enemy = new THREE.Sprite(new THREE.SpriteMaterial({ map: enemyTexture, color: 0xf6fbff, transparent: true, alphaTest: 0.08 }));
    enemy.position.set(2.45, 1.32, -0.15);
    enemy.scale.set(2.05, 2.4, 1);
    scene.add(enemy);

    const blobShadowTexture = makeBlobShadow();
    const heroSilhouetteTexture = makeSilhouetteShadowTexture(ASSETS.hero);
    const enemySilhouetteTexture = makeSilhouetteShadowTexture(ASSETS.enemy);
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
      mesh.rotation.z = -0.1;
      mesh.position.set(x + 0.28, 0.028, z + 0.58);
      scene.add(mesh);
      return mesh;
    };
    const heroBlobShadow = makeBlob(-2.25, 0.5, 1.15);
    const enemyBlobShadow = makeBlob(2.45, -0.15, 1.25);
    const heroShadow = makeSilhouette(heroSilhouetteTexture, -2.25, 0.5, 1.02);
    const enemyShadow = makeSilhouette(enemySilhouetteTexture, 2.45, -0.15, 1.08);

    const glowTexture = makeGlowTexture();
    const glowMaterial = new THREE.SpriteMaterial({ map: glowTexture, color: 0xffbe56, transparent: true, opacity: 0.72, blending: THREE.AdditiveBlending, depthWrite: false });
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

    const floorLightTexture = makeGlowTexture([
      [0, 'rgba(255, 231, 171, 0.9)'],
      [0.38, 'rgba(255, 205, 113, 0.26)'],
      [1, 'rgba(255, 205, 113, 0)'],
    ]);
    const floorLightMaterial = new THREE.MeshBasicMaterial({
      map: floorLightTexture,
      color: 0xffdda0,
      transparent: true,
      opacity: 0.24,
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
    const heroBloom = new THREE.Sprite(makeCharacterBloom(heroTexture, 0xffd99a, 0.14));
    const enemyBloom = new THREE.Sprite(makeCharacterBloom(enemyTexture, 0x8ed0ff, 0.12));
    scene.add(heroBloom, enemyBloom);

    const beamTexture = makeBeamTexture();
    const beamMaterial = new THREE.MeshBasicMaterial({
      map: beamTexture,
      color: 0xffefc2,
      transparent: true,
      opacity: 0.34,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    const beams = [-3.2, 0.6, 3.7].map((x, index) => {
      const beam = new THREE.Mesh(new THREE.PlaneGeometry(1.0 + index * 0.28, 8.5), beamMaterial.clone());
      beam.position.set(x, 4.1, -2.8 - index * 0.8);
      beam.rotation.z = -0.28;
      beam.rotation.y = 0.18;
      scene.add(beam);
      return beam;
    });

    const slashTextures = [makeSlashTexture(0), makeSlashTexture(1), makeSlashTexture(2)];
    const slashLayers = [
      { width: 4.35, height: 1.46, x: -0.05, y: 2.05, z: 0.78, rotate: -0.18, opacity: 0.72 },
      { width: 3.55, height: 0.92, x: 0.28, y: 1.72, z: 0.8, rotate: -0.28, opacity: 0.46 },
      { width: 2.95, height: 0.78, x: -0.48, y: 2.3, z: 0.82, rotate: -0.08, opacity: 0.34 },
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
    const particleCount = 440;
    const positions = new Float32Array(particleCount * 3);
    const speeds = new Float32Array(particleCount);
    for (let i = 0; i < particleCount; i += 1) {
      positions[i * 3] = (Math.random() - 0.5) * 13;
      positions[i * 3 + 1] = Math.random() * 5.5 + 0.2;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 9 - 1.2;
      speeds[i] = Math.random() * 0.18 + 0.04;
    }
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const particleMaterial = new THREE.PointsMaterial({
      color: 0xffd887,
      size: 0.032,
      transparent: true,
      opacity: 0.52,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const particles = new THREE.Points(particleGeometry, particleMaterial);
    scene.add(particles);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(initialSize.width, initialSize.height), 0.52, 0.46, 0.14);
    const bokehPass = new BokehPass(scene, camera, { focus: 13.8, aperture: 0.00026, maxblur: 0.002 });
    const gradePass = new ShaderPass(colorGradeShader);
    composer.addPass(bloomPass);
    composer.addPass(bokehPass);
    composer.addPass(gradePass);

    const clock = new THREE.Clock();
    let raf = 0;
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

    const animate = () => {
      const t = clock.getElapsedTime();
      raf = requestAnimationFrame(animate);
      const combatCycle = battleMode === 'slash' ? forcedBattlePhase ?? (t % 3.05) / 3.05 : 0;
      const slashBurst = pulseWindow(combatCycle, 0.28, 0.72);
      const slashDraw = easeOutCubic(windowProgress(combatCycle, 0.26, 0.54));
      const slashFade = 1 - easeOutCubic(windowProgress(combatCycle, 0.56, 0.82));
      const hitBurst = pulseWindow(combatCycle, 0.47, 0.77);
      const smokeBurst = pulseWindow(combatCycle, 0.18, 0.92);
      const windBurst = pulseWindow(combatCycle, 0.24, 0.86);
      const lunge = battleMode === 'slash' ? easeInOutCubic(windowProgress(combatCycle, 0.18, 0.4)) * (1 - easeOutCubic(windowProgress(combatCycle, 0.58, 0.94))) : 0;
      const recoil = battleMode === 'slash' ? pulseWindow(combatCycle, 0.48, 0.8) : 0;

      floorTexture.offset.set(Math.sin(t * 0.06) * 0.006, Math.cos(t * 0.05) * 0.005);
      camera.position.x = Math.sin(t * 0.2) * 0.18;
      camera.position.y = cameraRig.y + Math.sin(t * 0.16) * 0.08;
      camera.position.z = cameraRig.z;
      camera.lookAt(Math.sin(t * 0.17) * 0.25, cameraRig.targetY, cameraRig.targetZ);

      const heroCombatScale = battleMode === 'slash' && combatCycle < 0.9 ? 1.12 : 1;
      const isSlashSprite = battleMode === 'slash' && combatCycle < 0.9;
      if (isSlashSprite) {
        const frame = combatCycle < 0.25 ? 0 : combatCycle < 0.4 ? 1 : combatCycle < 0.62 ? 2 : 3;
        hero.material.map = heroSlashTexture;
        heroSlashTexture.offset.x = frame / 4;
        heroSlashTexture.needsUpdate = true;
      } else {
        hero.material.map = heroTexture;
      }
      hero.material.needsUpdate = true;

      hero.position.x = layoutRig.heroX + lunge * (layoutRig.heroScale > 0.9 ? 0.72 : 0.42);
      hero.position.y = 1.28 + Math.sin(t * 2.2) * 0.045 + lunge * 0.08;
      enemy.position.x = layoutRig.enemyX + recoil * 0.05;
      enemy.position.y = 1.32 + Math.sin(t * 1.8 + 1.1) * 0.055 + recoil * 0.04;
      hero.scale.set(2.2 * layoutRig.heroScale * heroCombatScale, 2.48 * layoutRig.heroScale * heroCombatScale, 1);
      enemy.scale.set(2.05 * layoutRig.enemyScale, 2.4 * layoutRig.enemyScale, 1);
      heroBloom.position.copy(hero.position);
      heroBloom.position.z += 0.012;
      heroBloom.scale.set(2.3 * layoutRig.heroScale * heroCombatScale, 2.68 * layoutRig.heroScale * heroCombatScale, 1);
      enemyBloom.position.copy(enemy.position);
      enemyBloom.position.z += 0.012;
      enemyBloom.scale.set(2.2 * layoutRig.enemyScale, 2.58 * layoutRig.enemyScale, 1);
      heroBlobShadow.position.x = hero.position.x;
      enemyBlobShadow.position.x = layoutRig.enemyX;
      heroShadow.position.x = hero.position.x + 0.28;
      enemyShadow.position.x = layoutRig.enemyX + 0.28;
      heroBlobShadow.scale.setScalar(1 + Math.sin(t * 2.2) * 0.025);
      enemyBlobShadow.scale.setScalar(1 + Math.sin(t * 1.8 + 1.1) * 0.03);
      heroShadow.scale.setScalar(1 + Math.sin(t * 2.2) * 0.018);
      enemyShadow.scale.setScalar(1 + Math.sin(t * 1.8 + 1.1) * 0.02);

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

      const slashCenterX = (layoutRig.heroX + layoutRig.enemyX) * 0.5 - (layoutRig.heroScale > 0.9 ? 0.1 : 0.02);
      slashArcs.forEach((arc, i) => {
        const layer = slashLayers[i];
        const layerDelay = i * 0.045;
        const draw = easeOutCubic(windowProgress(combatCycle, 0.26 + layerDelay, 0.56 + layerDelay));
        const fade = 1 - easeOutCubic(windowProgress(combatCycle, 0.57 + layerDelay, 0.84 + layerDelay));
        const material = arc.material as THREE.ShaderMaterial;
        arc.position.set(slashCenterX + layer.x * layoutRig.heroScale, layer.y, layer.z);
        arc.scale.setScalar(layoutRig.heroScale > 0.9 ? 1 : 0.76);
        material.uniforms.revealHead.value = Math.min(1.02, 0.08 + draw * 0.92);
        material.uniforms.revealTail.value = Math.max(-0.08, draw - 0.7);
        material.uniforms.opacity.value = battleMode === 'slash' ? Math.max(0, fade) * layer.opacity : 0;
      });

      windRibbons.forEach((ribbon, i) => {
        const localPulse = Math.max(0, windBurst - i * 0.07);
        ribbon.position.x = layoutRig.heroX + 1.12 + i * 0.34;
        ribbon.position.y = 1.5 + i * 0.19 + Math.sin(t * 3.4 + i) * 0.018;
        ribbon.position.z = 0.66 + i * 0.035;
        ribbon.scale.set(0.85 + slashDraw * 0.2, 0.4 + localPulse * 0.14, 1);
        ribbon.material.opacity = battleMode === 'slash' ? localPulse * slashFade * (0.26 - i * 0.04) : 0;
      });

      const hitArr = hitGeometry.attributes.position.array as Float32Array;
      for (let i = 0; i < hitSparkCount; i += 1) {
        const seed = hitSeeds[i];
        const burstAge = windowProgress(combatCycle, 0.47, 0.77);
        const distance = seed.radius + easeOutCubic(burstAge) * seed.speed;
        hitArr[i * 3] = layoutRig.enemyX - 0.34 + Math.cos(seed.angle) * distance * 0.54;
        hitArr[i * 3 + 1] = 1.9 + Math.sin(seed.angle) * distance * 0.34 + seed.lift * burstAge;
        hitArr[i * 3 + 2] = enemy.position.z + 0.11 + Math.sin(seed.angle * 1.7) * distance * 0.12;
      }
      hitGeometry.attributes.position.needsUpdate = true;
      hitSparks.material.opacity = battleMode === 'slash' ? hitBurst * 0.95 : 0;
      hitSparks.material.size = 0.036 + hitBurst * 0.046;

      const slashSparkArr = slashSparkGeometry.attributes.position.array as Float32Array;
      const slashAge = windowProgress(combatCycle, 0.3, 0.68);
      for (let i = 0; i < slashSparkCount; i += 1) {
        const seed = slashSparkSeeds[i];
        const along = Math.min(1, seed.along + slashAge * seed.speed);
        const arcX = layoutRig.heroX + 0.52 + along * (layoutRig.enemyX - layoutRig.heroX - 0.42);
        const arcY = 1.18 + Math.sin(along * Math.PI) * 1.18 + seed.drift * 0.72;
        slashSparkArr[i * 3] = arcX;
        slashSparkArr[i * 3 + 1] = arcY + seed.lift * slashAge;
        slashSparkArr[i * 3 + 2] = 0.78 + (seed.drift * 0.16);
      }
      slashSparkGeometry.attributes.position.needsUpdate = true;
      slashSparks.material.opacity = battleMode === 'slash' ? slashBurst * 0.72 : 0;
      slashSparks.material.size = 0.026 + slashBurst * 0.036;

      const smokeArr = smokeGeometry.attributes.position.array as Float32Array;
      const smokeAge = windowProgress(combatCycle, 0.18, 0.92);
      for (let i = 0; i < smokeCount; i += 1) {
        const seed = smokeSeeds[i];
        const spread = seed.radius + smokeAge * (0.48 + i / smokeCount * 0.28);
        smokeArr[i * 3] = layoutRig.heroX - 0.06 + Math.cos(seed.angle) * spread + seed.drift * smokeAge;
        smokeArr[i * 3 + 1] = 0.28 + seed.lift * smokeAge + Math.sin(t * 1.4 + seed.wobble) * 0.025;
        smokeArr[i * 3 + 2] = 0.56 + Math.sin(seed.angle) * spread * 0.7;
      }
      smokeGeometry.attributes.position.needsUpdate = true;
      smoke.material.opacity = battleMode === 'slash' ? smokeBurst * 0.36 : 0;
      smoke.material.size = (layoutRig.heroScale > 0.9 ? 0.24 : 0.18) + smokeAge * 0.34;

      const arr = particleGeometry.attributes.position.array as Float32Array;
      for (let i = 0; i < particleCount; i += 1) {
        arr[i * 3 + 1] -= speeds[i] * 0.012;
        arr[i * 3] += Math.sin(t + i) * 0.0009;
        if (arr[i * 3 + 1] < 0.1) arr[i * 3 + 1] = 5.8;
      }
      particleGeometry.attributes.position.needsUpdate = true;

      composer.render();
    };
    animate();

    const resize = () => {
      const { width, height } = getViewportSize(mount);
      if (width <= 0 || height <= 0) return;
      const aspect = width / height;
      const autoProfile = width <= 760 || aspect < 0.86 ? 'sp' : 'pc';
      const profile = viewMode === 'auto' ? autoProfile : viewMode;
      const isPhone = profile === 'sp';
      cameraRig.fov = isPhone ? (aspect < 0.75 ? 72 : 62) : Math.min(46, Math.max(30, 42 / Math.sqrt(aspect)));
      cameraRig.y = isPhone ? 8.35 : 8.35;
      cameraRig.z = isPhone ? (aspect < 0.75 ? 14.2 : 13.5) : 10.8;
      cameraRig.targetY = isPhone ? 1.05 : 1.25;
      cameraRig.targetZ = isPhone ? -2.2 : -2.25;
      layoutRig.heroX = isPhone ? -1.42 : -2.25;
      layoutRig.enemyX = isPhone ? 1.42 : 2.35;
      layoutRig.heroScale = isPhone ? 0.88 : 1;
      layoutRig.enemyScale = isPhone ? 0.88 : 1;
      camera.fov = cameraRig.fov;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      bloomPass.strength = isPhone ? 0.36 : 0.5;
      bloomPass.radius = isPhone ? 0.36 : 0.44;
      bloomPass.threshold = isPhone ? 0.14 : 0.15;
      bokehPass.uniforms.focus.value = isPhone ? 14.2 : 13.8;
      bokehPass.uniforms.aperture.value = isPhone ? 0.00014 : 0.00026;
      bokehPass.uniforms.maxblur.value = isPhone ? 0.001 : 0.002;
      gradePass.uniforms.exposure.value = isPhone ? 1.06 : 1.1;
      gradePass.uniforms.saturation.value = isPhone ? 1.04 : 1.08;
      gradePass.uniforms.warmth.value = isPhone ? 0 : 0.006;
      gradePass.uniforms.vignette.value = isPhone ? 0.12 : 0.2;
      particleMaterial.size = isPhone ? 0.024 : 0.034;
      particleMaterial.opacity = isPhone ? 0.3 : 0.5;
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
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Sprite || object instanceof THREE.Points) {
          object.geometry?.dispose?.();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
      [
        floorTexture,
        backdropTexture,
        heroTexture,
        heroSlashTexture,
        enemyTexture,
        glowTexture,
        beamTexture,
        blobShadowTexture,
        heroSilhouetteTexture,
        enemySilhouetteTexture,
        floorLightTexture,
        ...slashTextures,
        windTexture,
        smokeTexture,
      ].forEach((texture) => texture.dispose());
    };
  }, [viewMode, battleMode]);

  return <div className="scene" ref={mountRef} />;
}

function App() {
  const [viewMode, setViewMode] = useState<ViewMode>('auto');
  const [battleMode, setBattleMode] = useState<BattleMode>(() => (new URLSearchParams(window.location.search).get('battle') === 'slash' ? 'slash' : 'idle'));

  return (
    <>
      <DungeonScene viewMode={viewMode} battleMode={battleMode} />
      <div className="battle-switch" aria-label="戦闘演出切替">
        {([
          ['idle', '待機'],
          ['slash', '斬撃POC'],
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
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
