import * as THREE from 'three';
import { SCENE_CONFIG } from './cliffMath';

const SKY_VERTEX_SHADER = /* glsl */ `
varying vec3 vWorldDirection;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldDirection = normalize(worldPosition.xyz);
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const SKY_FRAGMENT_SHADER = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDirection;
uniform sampler2D uNoiseTex;

varying vec3 vWorldDirection;

void main() {
  vec3 dir = normalize(vWorldDirection);
  vec3 sunDir = normalize(uSunDirection);
  float elevation = clamp(dir.y, -0.25, 1.0);
  float horizonFactor = pow(1.0 - clamp(elevation, 0.0, 1.0), 3.3);

  vec3 zenithColor = vec3(0.055, 0.085, 0.14);
  vec3 midSkyColor = vec3(0.16, 0.21, 0.30);
  vec3 horizonCool = vec3(0.35, 0.37, 0.43);
  vec3 horizonWarm = vec3(0.98, 0.56, 0.27);

  float sunAlignment = max(dot(dir, sunDir), 0.0);
  vec2 flatDir = normalize(dir.xz + vec2(0.0001));
  vec2 flatSun = normalize(sunDir.xz + vec2(0.0001));
  float warmAzimuth = pow(max(dot(flatDir, flatSun), 0.0), 2.1);

  vec3 skyColor = mix(midSkyColor, zenithColor, smoothstep(0.05, 0.72, elevation));
  vec3 blendedHorizon = mix(horizonCool, horizonWarm, 0.35 + 0.65 * warmAzimuth);
  skyColor = mix(skyColor, blendedHorizon, horizonFactor);

  float mieGlow = pow(sunAlignment, 6.0) * 0.58 + pow(sunAlignment, 28.0) * 0.98;
  skyColor += vec3(1.05, 0.65, 0.34) * mieGlow * smoothstep(-0.08, 0.25, elevation);

  float sunDisc = smoothstep(0.9990, 0.9997, sunAlignment);
  skyColor += vec3(2.8, 1.9, 1.1) * sunDisc;

  if (elevation > 0.01) {
    vec2 cloudUv = dir.xz / (elevation + 0.24) * 0.14;
    vec2 drift = vec2(uTime * 0.0022, uTime * 0.0011);

    vec4 sampleA = texture2D(uNoiseTex, cloudUv + drift);
    vec2 warpedUv = cloudUv * 1.9 + vec2(sampleA.r - 0.5, sampleA.a - 0.5) * 0.18 - drift * 1.3;
    vec4 sampleB = texture2D(uNoiseTex, warpedUv);
    vec4 sampleLit = texture2D(uNoiseTex, cloudUv - sunDir.xz * 0.032 + drift);

    float cloudBase = sampleA.a * 0.64 + sampleB.r * 0.36;
    float cloudDensity = smoothstep(0.40, 0.78, cloudBase);
    float horizonFade = smoothstep(0.015, 0.18, elevation) * (1.0 - smoothstep(0.76, 0.98, elevation) * 0.32);
    cloudDensity *= horizonFade;

    float edgeLight = clamp(sampleA.a - sampleLit.a + 0.28, 0.0, 1.0);

    vec3 cloudShadow = vec3(0.085, 0.105, 0.145);
    vec3 cloudMid = vec3(0.24, 0.27, 0.33);
    vec3 cloudSunRim = vec3(1.22, 0.66, 0.32);

    vec3 cloudColor = mix(cloudShadow, cloudMid, smoothstep(0.12, 0.85, edgeLight));
    float goldenUnderlight = pow(sunAlignment, 2.4) * (0.45 + 0.55 * (1.0 - cloudDensity * 0.6));
    cloudColor = mix(cloudColor, cloudSunRim, clamp(goldenUnderlight * (0.58 + edgeLight * 0.72), 0.0, 0.94));

    skyColor = mix(skyColor, cloudColor, cloudDensity * 0.88);
  }

  float lowerFog = smoothstep(0.06, -0.14, elevation);
  vec3 canyonMistColor = mix(vec3(0.12, 0.15, 0.19), vec3(0.32, 0.24, 0.20), warmAzimuth * 0.6);
  skyColor = mix(skyColor, canyonMistColor, lowerFog);

  gl_FragColor = vec4(skyColor, 1.0);
}
`;

export interface SkySystem {
  readonly mesh: THREE.Mesh;
  readonly environmentTexture: THREE.Texture;
  readonly update: (elapsedSeconds: number) => void;
  readonly dispose: () => void;
}

export function createIcelandicSky(options: {
  readonly renderer: THREE.WebGLRenderer;
  readonly noiseTexture: THREE.DataTexture;
}): SkySystem {
  const sunDir = new THREE.Vector3(
    SCENE_CONFIG.sunDirection.x,
    SCENE_CONFIG.sunDirection.y,
    SCENE_CONFIG.sunDirection.z,
  ).normalize();

  const uniforms = {
    uTime: { value: 0 },
    uSunDirection: { value: sunDir },
    uNoiseTex: { value: options.noiseTexture },
  };

  const geometry = new THREE.SphereGeometry(240, 40, 28);
  const material = new THREE.ShaderMaterial({
    vertexShader: SKY_VERTEX_SHADER,
    fragmentShader: SKY_FRAGMENT_SHADER,
    uniforms,
    side: THREE.BackSide,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;

  const pmremGenerator = new THREE.PMREMGenerator(options.renderer);
  pmremGenerator.compileEquirectangularShader();

  const envScene = new THREE.Scene();
  const envSphere = new THREE.Mesh(geometry, material);
  envScene.add(envSphere);

  const envRenderTarget = pmremGenerator.fromScene(envScene, 0.035);
  pmremGenerator.dispose();

  return {
    mesh,
    environmentTexture: envRenderTarget.texture,
    update: (elapsedSeconds: number) => {
      uniforms.uTime.value = elapsedSeconds;
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
      envRenderTarget.dispose();
    },
  };
}
