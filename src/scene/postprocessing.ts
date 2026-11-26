import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SHARED_ATMOS_AND_SHADOW_GLSL } from '../shaders/sharedShaderGlsl';
import { IcelandWaterfallConfig } from './icelandConfig';

const VOLUMETRIC_GODRAYS_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    tSceneDepth: { value: null },
    uInvProjection: { value: new THREE.Matrix4() },
    uInvView: { value: new THREE.Matrix4() },
    uCameraPos: { value: new THREE.Vector3() },
    uSunDirection: { value: new THREE.Vector3() },
    uSunShadowMap: { value: null },
    uSunShadowMatrix: { value: new THREE.Matrix4() },
    uShadowMapSize: { value: 1024 },
    uTime: { value: 0 },
    uRayStrength: { value: 0.34 },
    uRayTint: { value: new THREE.Vector3(1.25, 0.72, 0.34) },
    uPlungeCenterZ: { value: -9.7 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tSceneDepth;
    uniform mat4 uInvProjection;
    uniform mat4 uInvView;
    uniform vec3 uCameraPos;
    uniform vec3 uSunDirection;
    uniform sampler2D uSunShadowMap;
    uniform mat4 uSunShadowMatrix;
    uniform float uShadowMapSize;
    uniform float uTime;
    uniform float uRayStrength;
    uniform vec3 uRayTint;
    uniform float uPlungeCenterZ;

    varying vec2 vUv;

    ${SHARED_ATMOS_AND_SHADOW_GLSL}

    float interleavedGradientNoise(vec2 pixelCoord) {
      vec3 magic = vec3(0.06711056, 0.00583715, 52.9829189);
      return fract(magic.z * fract(dot(pixelCoord, magic.xy)));
    }

    vec3 reconstructWorldPos(vec2 uv, float depth) {
      vec4 clipPos = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
      vec4 viewPos = uInvProjection * clipPos;
      viewPos /= max(viewPos.w, 0.0001);
      return (uInvView * viewPos).xyz;
    }

    void main() {
      vec4 baseColor = texture2D(tDiffuse, vUv);
      if (uRayStrength <= 0.001) {
        gl_FragColor = baseColor;
        return;
      }

      float rawDepth = texture2D(tSceneDepth, vUv).r;
      vec3 worldPos = reconstructWorldPos(vUv, rawDepth);

      vec3 rayVec = worldPos - uCameraPos;
      float maxDist = min(length(rayVec), 68.0);
      vec3 rayDir = rayVec / max(length(rayVec), 0.0001);
      vec3 sunDir = normalize(uSunDirection);

      float cosTheta = dot(rayDir, sunDir);
      float g = 0.72;
      float phase = (1.0 - g * g) / (4.0 * 3.14159 * pow(1.0 + g * g - 2.0 * g * cosTheta, 1.5));
      float phaseWeight = clamp(phase * 0.45, 0.0, 2.5);

      if (phaseWeight < 0.04) {
        gl_FragColor = baseColor;
        return;
      }

      float jitter = interleavedGradientNoise(gl_FragCoord.xy + fract(uTime * 11.3) * 17.0);
      const int STEPS = 14;
      float stepLen = maxDist / float(STEPS);
      float scatterAccum = 0.0;

      for (int i = 0; i < STEPS; i++) {
        float marchDist = (float(i) + jitter) * stepLen;
        vec3 samplePos = uCameraPos + rayDir * marchDist;

        vec4 shadowCoord = uSunShadowMatrix * vec4(samplePos, 1.0);
        float inLight = 1.0;
        if (shadowCoord.w > 0.0) {
          vec3 proj = shadowCoord.xyz / shadowCoord.w;
          if (proj.x > 0.01 && proj.x < 0.99 && proj.y > 0.01 && proj.y < 0.99 && proj.z < 1.0) {
            float stored = unpackThreeShadowDepth(texture2D(uSunShadowMap, proj.xy));
            inLight = proj.z - 0.002 <= stored ? 1.0 : 0.0;
          }
        }

        float plungeDist = length(samplePos.xz - vec2(0.0, uPlungeCenterZ));
        float valleyMist = exp(-max(samplePos.y, 0.0) * 0.068) * (0.35 + 1.2 * exp(-plungeDist * 0.055));
        scatterAccum += inLight * valleyMist * stepLen * 0.016;
      }

      vec3 sunShaftColor = uRayTint * scatterAccum * phaseWeight * uRayStrength;
      gl_FragColor = vec4(baseColor.rgb + sunShaftColor, baseColor.a);
    }
  `,
};

const HALF_RES_MOBILE_FX_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const HALF_RES_MOBILE_FX_FRAGMENT = /* glsl */ `
uniform sampler2D tSceneDepth;
uniform mat4 uInvProjection;
uniform mat4 uInvView;
uniform vec3 uCameraPos;
uniform vec3 uSunDirection;
uniform sampler2D uSunShadowMap;
uniform mat4 uSunShadowMatrix;
uniform float uTime;
uniform float uRayStrength;
uniform vec3 uRayTint;
uniform float uPlungeCenterZ;

varying vec2 vUv;

${SHARED_ATMOS_AND_SHADOW_GLSL}

vec3 reconstructViewPos(vec2 uv, float depth) {
  vec4 clip = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 view = uInvProjection * clip;
  return view.xyz / max(view.w, 0.0001);
}

float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

void main() {
  vec3 sunShaftColor = vec3(0.0);
  if (uRayStrength > 0.001) {
    float rawDepth = texture2D(tSceneDepth, vUv).r;
    vec3 viewPos = reconstructViewPos(vUv, rawDepth);
    vec3 worldPos = (uInvView * vec4(viewPos, 1.0)).xyz;
    vec3 rayVec = worldPos - uCameraPos;
    float maxDist = min(length(rayVec), 68.0);
    vec3 rayDir = rayVec / max(length(rayVec), 0.0001);
    vec3 sunDir = normalize(uSunDirection);

    float cosTheta = dot(rayDir, sunDir);
    float g = 0.72;
    float phase = (1.0 - g * g) / (4.0 * 3.14159 * pow(1.0 + g * g - 2.0 * g * cosTheta, 1.5));
    float phaseWeight = clamp(phase * 0.45, 0.0, 2.5);

    if (phaseWeight >= 0.04) {
      float jitter = ign(gl_FragCoord.xy + fract(uTime * 11.3) * 17.0);
      const int STEPS = 10;
      float stepLen = maxDist / float(STEPS);
      float scatterAccum = 0.0;

      for (int i = 0; i < STEPS; i++) {
        float marchDist = (float(i) + jitter) * stepLen;
        vec3 samplePos = uCameraPos + rayDir * marchDist;

        vec4 shadowCoord = uSunShadowMatrix * vec4(samplePos, 1.0);
        float inLight = 1.0;
        if (shadowCoord.w > 0.0) {
          vec3 proj = shadowCoord.xyz / shadowCoord.w;
          if (proj.x > 0.01 && proj.x < 0.99 && proj.y > 0.01 && proj.y < 0.99 && proj.z < 1.0) {
            float stored = unpackThreeShadowDepth(texture2D(uSunShadowMap, proj.xy));
            inLight = proj.z - 0.002 <= stored ? 1.0 : 0.0;
          }
        }

        float plungeDist = length(samplePos.xz - vec2(0.0, uPlungeCenterZ));
        float valleyMist = exp(-max(samplePos.y, 0.0) * 0.068) * (0.35 + 1.2 * exp(-plungeDist * 0.055));
        scatterAccum += inLight * valleyMist * stepLen * 0.016;
      }

      sunShaftColor = uRayTint * scatterAccum * phaseWeight * uRayStrength;
    }
  }

  gl_FragColor = vec4(sunShaftColor, 1.0);
}
`;

const HALF_RES_FX_COMPOSITE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    tHalfResFx: { value: null },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tHalfResFx;
    varying vec2 vUv;
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      vec4 fx = texture2D(tHalfResFx, vUv);
      gl_FragColor = vec4(base.rgb + fx.rgb, base.a);
    }
  `,
};

const AGX_GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uExposure: { value: 1.12 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;

    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uExposure;

    varying vec2 vUv;

    float hashGrain(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    vec3 agxDefaultContrastApprox(vec3 x) {
      vec3 x2 = x * x;
      vec3 x4 = x2 * x2;
      return 15.5 * x4 * x2
        - 40.14 * x4 * x
        + 31.96 * x4
        - 6.868 * x2 * x
        + 0.4298 * x2
        + 0.1191 * x
        - 0.00232;
    }

    vec3 agxToneMapping(vec3 val) {
      const mat3 linearSrgbToRec2020 = mat3(
        vec3(0.6274, 0.0691, 0.0164),
        vec3(0.3293, 0.9195, 0.0880),
        vec3(0.0433, 0.0113, 0.8956)
      );
      const mat3 rec2020ToLinearSrgb = mat3(
        vec3(1.6605, -0.1246, -0.0182),
        vec3(-0.5876, 1.1329, -0.1006),
        vec3(-0.0728, -0.0083, 1.1187)
      );
      const mat3 agxInset = mat3(
        vec3(0.856627153315983, 0.137318972929847, 0.11189821299995),
        vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903),
        vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859)
      );
      const mat3 agxOutset = mat3(
        vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826),
        vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294),
        vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405)
      );

      vec3 c = linearSrgbToRec2020 * max(val, vec3(0.0));
      c = agxInset * c;
      c = max(c, vec3(1e-10));
      c = log2(c);
      c = clamp((c + 12.47393) / (4.026069 + 12.47393), 0.0, 1.0);
      c = agxDefaultContrastApprox(c);
      c = agxOutset * c;
      c = pow(max(vec3(0.0), c), vec3(2.2));
      c = rec2020ToLinearSrgb * c;
      return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
    }

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 color = agxToneMapping(texel.rgb * uExposure);

      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      vec3 coolShadows = vec3(0.96, 0.99, 1.04);
      vec3 warmHighlights = vec3(1.04, 0.99, 0.95);
      color *= mix(coolShadows, warmHighlights, smoothstep(0.18, 0.85, luma));

      vec2 centered = vUv - 0.5;
      float vignette = 1.0 - dot(centered, centered) * 0.28;
      color *= clamp(vignette, 0.78, 1.0);

      float grain = (hashGrain(vUv * 1200.0 + fract(uTime * 17.0)) - 0.5) * 0.009;
      color = clamp(color + grain, 0.0, 1.0);

      gl_FragColor = vec4(color, texel.a);
    }
  `,
};

const SOURCE_TEXTURE_COPY_SHADER = {
  uniforms: {
    tSource: { value: null },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tSource;
    varying vec2 vUv;
    void main() {
      gl_FragColor = texture2D(tSource, vUv);
    }
  `,
};

export interface PostProcessingSystem {
  readonly render: (input: {
    readonly elapsedSeconds: number;
    readonly sourceColorTexture: THREE.Texture;
    readonly sceneDepthTexture: THREE.Texture;
    readonly camera: THREE.PerspectiveCamera;
    readonly shadowMap: THREE.Texture;
    readonly shadowMatrix: THREE.Matrix4;
    readonly shadowMapSize: number;
  }) => void;
  readonly resize: (size: { readonly width: number; readonly height: number }) => void;
  readonly dispose: () => void;
}

export function createPostProcessing(options: {
  readonly renderer: THREE.WebGLRenderer;
  readonly width: number;
  readonly height: number;
  readonly isSoftwareGpu: boolean;
  readonly isMobileGpu: boolean;
  readonly config: IcelandWaterfallConfig;
}): PostProcessingSystem {
  const pixelRatio = options.renderer.getPixelRatio();
  const renderW = Math.max(1, Math.floor(options.width * pixelRatio));
  const renderH = Math.max(1, Math.floor(options.height * pixelRatio));
  const useHalfResMobileFx = options.isMobileGpu && !options.isSoftwareGpu;

  const renderTarget = new THREE.WebGLRenderTarget(options.width, options.height, {
    type: THREE.HalfFloatType,
    samples: 0,
  });

  const composer = new EffectComposer(options.renderer, renderTarget);

  const sourcePass = new ShaderPass(SOURCE_TEXTURE_COPY_SHADER);
  composer.addPass(sourcePass);

  const halfW = Math.max(1, Math.floor(renderW * 0.5));
  const halfH = Math.max(1, Math.floor(renderH * 0.5));
  const halfResFxTarget = useHalfResMobileFx
    ? new THREE.WebGLRenderTarget(halfW, halfH, {
        type: THREE.HalfFloatType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: false,
      })
    : null;

  const sunDirectionVec = new THREE.Vector3(
    options.config.sunDirection.x,
    options.config.sunDirection.y,
    options.config.sunDirection.z,
  ).normalize();
  const rayTintVec = new THREE.Vector3(
    options.config.godRayTint[0],
    options.config.godRayTint[1],
    options.config.godRayTint[2],
  );
  const rayStrength = options.isSoftwareGpu ? 0.0 : options.config.godRayStrength;

  const halfResFxScene = new THREE.Scene();
  const halfResFxCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const halfResFxQuadGeo = new THREE.PlaneGeometry(2, 2);

  interface HalfResFxUniforms {
    readonly tSceneDepth: { value: THREE.Texture | null };
    readonly uInvProjection: { value: THREE.Matrix4 };
    readonly uInvView: { value: THREE.Matrix4 };
    readonly uCameraPos: { value: THREE.Vector3 };
    readonly uSunDirection: { value: THREE.Vector3 };
    readonly uSunShadowMap: { value: THREE.Texture | null };
    readonly uSunShadowMatrix: { value: THREE.Matrix4 };
    readonly uTime: { value: number };
    readonly uRayStrength: { value: number };
    readonly uRayTint: { value: THREE.Vector3 };
    readonly uPlungeCenterZ: { value: number };
  }

  const halfResFxUniforms: HalfResFxUniforms = {
    tSceneDepth: { value: null },
    uInvProjection: { value: new THREE.Matrix4() },
    uInvView: { value: new THREE.Matrix4() },
    uCameraPos: { value: new THREE.Vector3() },
    uSunDirection: { value: sunDirectionVec.clone() },
    uSunShadowMap: { value: null },
    uSunShadowMatrix: { value: new THREE.Matrix4() },
    uTime: { value: 0 },
    uRayStrength: { value: rayStrength },
    uRayTint: { value: rayTintVec.clone() },
    uPlungeCenterZ: { value: options.config.waterStyle.plungeCenterZ },
  };
  const halfResFxMat = new THREE.ShaderMaterial({
    vertexShader: HALF_RES_MOBILE_FX_VERTEX,
    fragmentShader: HALF_RES_MOBILE_FX_FRAGMENT,
    uniforms: { ...halfResFxUniforms },
    depthTest: false,
    depthWrite: false,
  });
  halfResFxScene.add(new THREE.Mesh(halfResFxQuadGeo, halfResFxMat));

  const godRaysPass = new ShaderPass(VOLUMETRIC_GODRAYS_SHADER);
  if (godRaysPass.uniforms.uSunDirection) {
    godRaysPass.uniforms.uSunDirection.value = sunDirectionVec;
  }
  if (godRaysPass.uniforms.uRayStrength) {
    godRaysPass.uniforms.uRayStrength.value = rayStrength;
  }
  if (godRaysPass.uniforms.uRayTint) {
    godRaysPass.uniforms.uRayTint.value = rayTintVec;
  }
  if (godRaysPass.uniforms.uPlungeCenterZ) {
    godRaysPass.uniforms.uPlungeCenterZ.value = options.config.waterStyle.plungeCenterZ;
  }

  const halfResCompositePass = new ShaderPass(HALF_RES_FX_COMPOSITE_SHADER);
  if (useHalfResMobileFx && halfResFxTarget) {
    if (halfResCompositePass.uniforms.tHalfResFx) {
      halfResCompositePass.uniforms.tHalfResFx.value = halfResFxTarget.texture;
    }
    composer.addPass(halfResCompositePass);
  } else {
    composer.addPass(godRaysPass);
  }

  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(
      Math.max(1, Math.floor(options.width * 0.5)),
      Math.max(1, Math.floor(options.height * 0.5)),
    ),
    0.15,
    0.58,
    1.18,
  );
  composer.addPass(bloomPass);

  const gradePass = new ShaderPass(AGX_GRADE_SHADER);
  if (gradePass.uniforms.uExposure) {
    gradePass.uniforms.uExposure.value = options.config.exposure;
  }
  composer.addPass(gradePass);

  const smaaPass = new SMAAPass(renderW, renderH);
  smaaPass.enabled = !options.isSoftwareGpu;
  composer.addPass(smaaPass);

  const invProjection = new THREE.Matrix4();
  const invView = new THREE.Matrix4();

  return {
    render: (input) => {
      if (sourcePass.uniforms.tSource) {
        sourcePass.uniforms.tSource.value = input.sourceColorTexture;
      }

      invProjection.copy(input.camera.projectionMatrixInverse);
      invView.copy(input.camera.matrixWorld);

      if (useHalfResMobileFx && halfResFxTarget) {
        halfResFxUniforms.tSceneDepth.value = input.sceneDepthTexture;
        halfResFxUniforms.uInvProjection.value.copy(invProjection);
        halfResFxUniforms.uInvView.value.copy(invView);
        halfResFxUniforms.uCameraPos.value.copy(input.camera.position);
        halfResFxUniforms.uSunShadowMap.value = input.shadowMap;
        halfResFxUniforms.uSunShadowMatrix.value.copy(input.shadowMatrix);
        halfResFxUniforms.uTime.value = input.elapsedSeconds;

        options.renderer.setRenderTarget(halfResFxTarget);
        options.renderer.render(halfResFxScene, halfResFxCamera);
      } else {
        if (godRaysPass.uniforms.tSceneDepth) {
          godRaysPass.uniforms.tSceneDepth.value = input.sceneDepthTexture;
        }
        if (godRaysPass.uniforms.uInvProjection) {
          godRaysPass.uniforms.uInvProjection.value = invProjection;
        }
        if (godRaysPass.uniforms.uInvView) {
          godRaysPass.uniforms.uInvView.value = invView;
        }
        if (godRaysPass.uniforms.uCameraPos) {
          godRaysPass.uniforms.uCameraPos.value = input.camera.position;
        }
        if (godRaysPass.uniforms.uSunShadowMap) {
          godRaysPass.uniforms.uSunShadowMap.value = input.shadowMap;
        }
        if (godRaysPass.uniforms.uSunShadowMatrix) {
          godRaysPass.uniforms.uSunShadowMatrix.value = input.shadowMatrix;
        }
        if (godRaysPass.uniforms.uShadowMapSize) {
          godRaysPass.uniforms.uShadowMapSize.value = input.shadowMapSize;
        }
        if (godRaysPass.uniforms.uTime) {
          godRaysPass.uniforms.uTime.value = input.elapsedSeconds;
        }
      }

      if (gradePass.uniforms.uTime) {
        gradePass.uniforms.uTime.value = input.elapsedSeconds;
      }

      composer.render();
    },
    resize: (size) => {
      const pr = options.renderer.getPixelRatio();
      const nextRenderW = Math.max(1, Math.floor(size.width * pr));
      const nextRenderH = Math.max(1, Math.floor(size.height * pr));
      composer.setSize(size.width, size.height);
      if (halfResFxTarget) {
        halfResFxTarget.setSize(
          Math.max(1, Math.floor(nextRenderW * 0.5)),
          Math.max(1, Math.floor(nextRenderH * 0.5)),
        );
      }
      bloomPass.resolution.set(
        Math.max(1, Math.floor(size.width * 0.5)),
        Math.max(1, Math.floor(size.height * 0.5)),
      );
      smaaPass.setSize(nextRenderW, nextRenderH);
    },
    dispose: () => {
      halfResFxTarget?.dispose();
      halfResFxQuadGeo.dispose();
      halfResFxMat.dispose();
      renderTarget.dispose();
      bloomPass.dispose();
      smaaPass.dispose();
      composer.dispose();
    },
  };
}
