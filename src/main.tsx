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
  enemy: 'assets/enemy.png',
};

type ViewMode = 'auto' | 'pc' | 'sp';

const colorGradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    contrast: { value: 1.04 },
    saturation: { value: 1.1 },
    warmth: { value: -0.012 },
    vignette: { value: 0.24 },
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
    uniform float contrast;
    uniform float saturation;
    uniform float warmth;
    uniform float vignette;
    varying vec2 vUv;

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 color = texel.rgb;
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

function makeGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  gradient.addColorStop(0, 'rgba(255, 227, 151, 1)');
  gradient.addColorStop(0.25, 'rgba(255, 174, 58, 0.5)');
  gradient.addColorStop(1, 'rgba(255, 174, 58, 0)');
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

function DungeonScene({ viewMode }: { viewMode: ViewMode }) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current!;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x071018);
    scene.fog = new THREE.FogExp2(0x0a1520, 0.045);

    const camera = new THREE.PerspectiveCamera(36, mount.clientWidth / mount.clientHeight, 0.1, 100);
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
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(renderer.domElement);

    const loader = new THREE.TextureLoader();
    const floorTexture = loader.load(ASSETS.floor);
    floorTexture.colorSpace = THREE.SRGBColorSpace;
    floorTexture.wrapS = THREE.RepeatWrapping;
    floorTexture.wrapT = THREE.RepeatWrapping;
    floorTexture.repeat.set(1.25, 1.25);
    floorTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(18, 18, 96, 96),
      new THREE.MeshStandardMaterial({
        map: floorTexture,
        roughness: 0.82,
        metalness: 0.02,
        emissive: new THREE.Color(0x1a1307),
        emissiveIntensity: 0.22,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const backdropTexture = loader.load(ASSETS.backdrop);
    backdropTexture.colorSpace = THREE.SRGBColorSpace;
    const backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(26, 15.2),
      new THREE.MeshBasicMaterial({ map: backdropTexture, transparent: true }),
    );
    backdrop.position.set(0, 4.9, -8.4);
    scene.add(backdrop);

    const backMist = new THREE.Mesh(
      new THREE.PlaneGeometry(28, 12),
      new THREE.MeshBasicMaterial({ color: 0x7ab5d6, transparent: true, opacity: 0.08, depthWrite: false }),
    );
    backMist.position.set(0, 4.2, -7.8);
    scene.add(backMist);

    const ambient = new THREE.HemisphereLight(0xb8d4ff, 0x171f26, 1.68);
    scene.add(ambient);

    const moon = new THREE.DirectionalLight(0xdfeeff, 3.2);
    moon.position.set(-4.8, 9, 5.5);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    moon.shadow.camera.left = -8;
    moon.shadow.camera.right = 8;
    moon.shadow.camera.top = 8;
    moon.shadow.camera.bottom = -8;
    scene.add(moon);

    const crystal = new THREE.PointLight(0xffb43b, 4.7, 10, 1.75);
    crystal.position.set(4.9, 1.9, -1.6);
    scene.add(crystal);

    const heroKey = new THREE.PointLight(0xffd08a, 1.45, 4.5, 1.4);
    heroKey.position.set(-2.7, 2.1, 1.45);
    scene.add(heroKey);

    const enemyRim = new THREE.PointLight(0x6db7ff, 2.2, 4.8, 1.35);
    enemyRim.position.set(2.0, 2.3, 0.9);
    scene.add(enemyRim);

    const heroTexture = loader.load(ASSETS.hero);
    const enemyTexture = loader.load(ASSETS.enemy);
    heroTexture.colorSpace = THREE.SRGBColorSpace;
    enemyTexture.colorSpace = THREE.SRGBColorSpace;
    heroTexture.magFilter = THREE.NearestFilter;
    enemyTexture.magFilter = THREE.NearestFilter;

    const hero = new THREE.Sprite(new THREE.SpriteMaterial({ map: heroTexture, color: 0xeef4ff, transparent: true, alphaTest: 0.08 }));
    hero.position.set(-2.25, 1.28, 0.5);
    hero.scale.set(2.0, 2.35, 1);
    scene.add(hero);

    const enemy = new THREE.Sprite(new THREE.SpriteMaterial({ map: enemyTexture, color: 0xe8f2ff, transparent: true, alphaTest: 0.08 }));
    enemy.position.set(2.45, 1.32, -0.15);
    enemy.scale.set(2.05, 2.4, 1);
    scene.add(enemy);

    const shadowTexture = makeBlobShadow();
    const shadowMaterial = new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, opacity: 0.72, depthWrite: false });
    const makeShadow = (x: number, z: number, scale: number) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.7 * scale, 0.84 * scale), shadowMaterial.clone());
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(x, 0.018, z + 0.22);
      scene.add(mesh);
      return mesh;
    };
    const heroShadow = makeShadow(-2.25, 0.5, 1.15);
    const enemyShadow = makeShadow(2.45, -0.15, 1.25);

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
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(mount.clientWidth, mount.clientHeight), 0.62, 0.54, 0.18);
    const bokehPass = new BokehPass(scene, camera, { focus: 13.8, aperture: 0.00042, maxblur: 0.0032 });
    const gradePass = new ShaderPass(colorGradeShader);
    composer.addPass(bloomPass);
    composer.addPass(bokehPass);
    composer.addPass(gradePass);

    const clock = new THREE.Clock();
    let raf = 0;
    const animate = () => {
      const t = clock.getElapsedTime();
      raf = requestAnimationFrame(animate);

      floorTexture.offset.set(Math.sin(t * 0.06) * 0.006, Math.cos(t * 0.05) * 0.005);
      camera.position.x = Math.sin(t * 0.2) * 0.18;
      camera.position.y = cameraRig.y + Math.sin(t * 0.16) * 0.08;
      camera.position.z = cameraRig.z;
      camera.lookAt(Math.sin(t * 0.17) * 0.25, cameraRig.targetY, cameraRig.targetZ);

      hero.position.x = layoutRig.heroX;
      hero.position.y = 1.28 + Math.sin(t * 2.2) * 0.045;
      enemy.position.x = layoutRig.enemyX;
      enemy.position.y = 1.32 + Math.sin(t * 1.8 + 1.1) * 0.055;
      hero.scale.set(2.0 * layoutRig.heroScale, 2.35 * layoutRig.heroScale, 1);
      enemy.scale.set(2.05 * layoutRig.enemyScale, 2.4 * layoutRig.enemyScale, 1);
      heroShadow.position.x = layoutRig.heroX;
      enemyShadow.position.x = layoutRig.enemyX;
      heroShadow.scale.setScalar(1 + Math.sin(t * 2.2) * 0.025);
      enemyShadow.scale.setScalar(1 + Math.sin(t * 1.8 + 1.1) * 0.03);

      runeGlows.forEach((glow, i) => {
        glow.material.opacity = 0.5 + Math.sin(t * 1.8 + i * 1.7) * 0.16;
        glow.scale.setScalar(0.82 + Math.sin(t * 1.3 + i) * 0.08);
      });
      beams.forEach((beam, i) => {
        beam.material.opacity = 0.15 + Math.sin(t * 0.8 + i) * 0.045;
      });

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
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      const aspect = width / height;
      const autoProfile = width <= 1050 || aspect < 1.05 ? 'sp' : 'pc';
      const profile = viewMode === 'auto' ? autoProfile : viewMode;
      const isPhone = profile === 'sp';
      cameraRig.fov = isPhone ? (aspect < 0.75 ? 78 : 66) : 46;
      cameraRig.y = isPhone ? 8.55 : 8.0;
      cameraRig.z = isPhone ? (aspect < 0.75 ? 14.6 : 14.0) : 13.2;
      cameraRig.targetY = isPhone ? 1.08 : 1.35;
      cameraRig.targetZ = isPhone ? -2.35 : -2.75;
      layoutRig.heroX = isPhone ? -1.42 : -2.25;
      layoutRig.enemyX = isPhone ? 1.42 : 2.35;
      layoutRig.heroScale = isPhone ? 0.88 : 1;
      layoutRig.enemyScale = isPhone ? 0.88 : 1;
      camera.fov = cameraRig.fov;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      bloomPass.strength = isPhone ? 0.36 : 0.56;
      bloomPass.radius = isPhone ? 0.34 : 0.48;
      bokehPass.uniforms.focus.value = isPhone ? 14.2 : 13.8;
      bokehPass.uniforms.aperture.value = isPhone ? 0.0002 : 0.00042;
      bokehPass.uniforms.maxblur.value = isPhone ? 0.0014 : 0.0032;
      gradePass.uniforms.saturation.value = isPhone ? 1.02 : 1.1;
      gradePass.uniforms.warmth.value = isPhone ? -0.02 : -0.012;
      gradePass.uniforms.vignette.value = isPhone ? 0.16 : 0.24;
      particleMaterial.size = isPhone ? 0.021 : 0.032;
      particleMaterial.opacity = isPhone ? 0.22 : 0.48;
      renderer.setSize(width, height);
      composer.setSize(width, height);
    };
    resize();
    window.addEventListener('resize', resize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
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
      [floorTexture, backdropTexture, heroTexture, enemyTexture, glowTexture, beamTexture, shadowTexture].forEach((texture) => texture.dispose());
    };
  }, [viewMode]);

  return <div className="scene" ref={mountRef} />;
}

function App() {
  const [viewMode, setViewMode] = useState<ViewMode>('auto');

  return (
    <>
      <DungeonScene viewMode={viewMode} />
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
