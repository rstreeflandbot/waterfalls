import * as THREE from 'three';
import { WaterfallPresetConfig } from './waterfallPresets';

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
uniform vec3 uZenithColor;
uniform vec3 uMidSkyColor;
uniform vec3 uHorizonCool;
uniform vec3 uHorizonWarm;
uniform vec3 uCloudShadow;
uniform vec3 uCloudMid;
uniform vec3 uCloudSunRim;
uniform vec3 uLowerMistCool;
uniform vec3 uLowerMistWarm;

varying vec3 vWorldDirection;

void main() {
  vec3 dir = normalize(vWorldDirection);
  vec3 sunDir = normalize(uSunDirection);
  float elevation = clamp(dir.y, -0.25, 1.0);
  float horizonFactor = pow(1.0 - clamp(elevation, 0.0, 1.0), 3.3);

  float sunAlignment = max(dot(dir, sunDir), 0.0);
  vec2 flatDir = normalize(dir.xz + vec2(0.0001));
  vec2 flatSun = normalize(sunDir.xz + vec2(0.0001));
  float warmAzimuth = pow(max(dot(flatDir, flatSun), 0.0), 2.1);

  vec3 skyColor = mix(uMidSkyColor, uZenithColor, smoothstep(0.05, 0.72, elevation));
  vec3 blendedHorizon = mix(uHorizonCool, uHorizonWarm, 0.35 + 0.65 * warmAzimuth);
  skyColor = mix(skyColor, blendedHorizon, horizonFactor);

  float mieGlow = pow(sunAlignment, 6.0) * 0.58 + pow(sunAlignment, 28.0) * 0.98;
  skyColor += uCloudSunRim * 0.85 * mieGlow * smoothstep(-0.08, 0.25, elevation);

  float sunDisc = smoothstep(0.9990, 0.9997, sunAlignment);
  skyColor += vec3(2.8, 1.95, 1.2) * sunDisc;

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

    vec3 cloudColor = mix(uCloudShadow, uCloudMid, smoothstep(0.12, 0.85, edgeLight));
    float goldenUnderlight = pow(sunAlignment, 2.4) * (0.45 + 0.55 * (1.0 - cloudDensity * 0.6));
    cloudColor = mix(cloudColor, uCloudSunRim, clamp(goldenUnderlight * (0.58 + edgeLight * 0.72), 0.0, 0.94));

    skyColor = mix(skyColor, cloudColor, cloudDensity * 0.86);
  }

  float lowerFog = smoothstep(0.06, -0.14, elevation);
  vec3 canyonMistColor = mix(uLowerMistCool, uLowerMistWarm, warmAzimuth * 0.6);
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
  readonly preset: WaterfallPresetConfig;
}): SkySystem {
  const { preset } = options;
  const sunDir = new THREE.Vector3(
    preset.sunDirection.x,
    preset.sunDirection.y,
    preset.sunDirection.z,
  ).normalize();

  const p = preset.skyPalette;
  const uniforms = {
    uTime: { value: 0 },
    uSunDirection: { value: sunDir },
    uNoiseTex: { value: options.noiseTexture },
    uZenithColor: { value: new THREE.Vector3(p.zenith[0], p.zenith[1], p.zenith[2]) },
    uMidSkyColor: { value: new THREE.Vector3(p.midSky[0], p.midSky[1], p.midSky[2]) },
    uHorizonCool: {
      value: new THREE.Vector3(p.horizonCool[0], p.horizonCool[1], p.horizonCool[2]),
    },
    uHorizonWarm: {
      value: new THREE.Vector3(p.horizonWarm[0], p.horizonWarm[1], p.horizonWarm[2]),
    },
    uCloudShadow: {
      value: new THREE.Vector3(p.cloudShadow[0], p.cloudShadow[1], p.cloudShadow[2]),
    },
    uCloudMid: { value: new THREE.Vector3(p.cloudMid[0], p.cloudMid[1], p.cloudMid[2]) },
    uCloudSunRim: {
      value: new THREE.Vector3(p.cloudSunRim[0], p.cloudSunRim[1], p.cloudSunRim[2]),
    },
    uLowerMistCool: {
      value: new THREE.Vector3(p.lowerMistCool[0], p.lowerMistCool[1], p.lowerMistCool[2]),
    },
    uLowerMistWarm: {
      value: new THREE.Vector3(p.lowerMistWarm[0], p.lowerMistWarm[1], p.lowerMistWarm[2]),
    },
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
