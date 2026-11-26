import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

const CINEMATIC_GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
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

    varying vec2 vUv;

    float hashGrain(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    vec3 acesFilm(vec3 x) {
      float a = 2.51;
      float b = 0.03;
      float c = 2.43;
      float d = 0.59;
      float e = 0.14;
      return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
    }

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 color = texel.rgb;

      color = acesFilm(color * 0.94);

      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      vec3 coolShadows = vec3(0.95, 0.98, 1.03);
      vec3 warmHighlights = vec3(1.04, 0.99, 0.95);
      color *= mix(coolShadows, warmHighlights, smoothstep(0.18, 0.85, luma));

      color = pow(max(color, vec3(0.0)), vec3(1.0 / 2.2));

      vec2 centered = vUv - 0.5;
      float vignette = 1.0 - dot(centered, centered) * 0.34;
      color *= clamp(vignette, 0.74, 1.0);

      float grain = (hashGrain(vUv * 1200.0 + fract(uTime * 17.0)) - 0.5) * 0.011;
      color = clamp(color + grain, 0.0, 1.0);

      gl_FragColor = vec4(color, texel.a);
    }
  `,
};

export interface PostProcessingSystem {
  readonly render: (elapsedSeconds: number) => void;
  readonly resize: (size: { readonly width: number; readonly height: number }) => void;
  readonly dispose: () => void;
}

export function createPostProcessing(options: {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly width: number;
  readonly height: number;
  readonly samples: number;
}): PostProcessingSystem {
  const renderTarget = new THREE.WebGLRenderTarget(options.width, options.height, {
    type: THREE.HalfFloatType,
    samples: options.samples,
  });

  const composer = new EffectComposer(options.renderer, renderTarget);
  const renderPass = new RenderPass(options.scene, options.camera);
  composer.addPass(renderPass);

  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(
      Math.max(1, Math.floor(options.width * 0.5)),
      Math.max(1, Math.floor(options.height * 0.5)),
    ),
    0.16,
    0.55,
    1.12,
  );
  composer.addPass(bloomPass);

  const gradePass = new ShaderPass(CINEMATIC_GRADE_SHADER);
  composer.addPass(gradePass);

  return {
    render: (elapsedSeconds: number) => {
      if (gradePass.uniforms.uTime) {
        gradePass.uniforms.uTime.value = elapsedSeconds;
      }
      composer.render();
    },
    resize: (size) => {
      composer.setSize(size.width, size.height);
      bloomPass.resolution.set(
        Math.max(1, Math.floor(size.width * 0.5)),
        Math.max(1, Math.floor(size.height * 0.5)),
      );
    },
    dispose: () => {
      renderTarget.dispose();
      bloomPass.dispose();
      composer.dispose();
    },
  };
}
