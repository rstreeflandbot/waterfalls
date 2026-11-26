export interface WaterfallAudioController {
  readonly isPlaying: () => boolean;
  readonly toggle: () => Promise<boolean>;
  readonly dispose: () => void;
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

function setPlaybackAudioSession(): void {
  if (!('audioSession' in navigator)) {
    return;
  }
  const candidate = Reflect.get(navigator, 'audioSession');
  if (candidate && typeof candidate === 'object' && 'type' in candidate) {
    try {
      Reflect.set(candidate, 'type', 'playback');
    } catch {
      return;
    }
  }
}

function createAudioContextInstance(): AudioContext {
  if (typeof window.AudioContext !== 'undefined') {
    return new window.AudioContext();
  }
  if (window.webkitAudioContext) {
    return new window.webkitAudioContext();
  }
  throw new Error('Web Audio API is unavailable');
}

function createSilentWavObjectUrl(): string {
  const sampleRate = 8000;
  const sampleCount = 800;
  const dataSize = sampleCount * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataSize, true);

  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
}

function createNoiseBuffer(options: {
  readonly context: AudioContext;
  readonly durationSeconds: number;
  readonly flavor: 'brown' | 'pink' | 'white';
}): AudioBuffer {
  const sampleRate = options.context.sampleRate;
  const frameCount = Math.floor(sampleRate * options.durationSeconds);
  const buffer = options.context.createBuffer(2, frameCount, sampleRate);

  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    let lastBrown = 0;
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;

    for (let i = 0; i < frameCount; i++) {
      const white = Math.random() * 2 - 1;

      if (options.flavor === 'white') {
        data[i] = white * 0.5;
      } else if (options.flavor === 'brown') {
        lastBrown = (lastBrown + 0.024 * white) / 1.024;
        data[i] = Math.max(-1, Math.min(1, lastBrown * 3.6));
      } else {
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.969 * b2 + white * 0.153852;
        b3 = 0.8665 * b3 + white * 0.3104856;
        b4 = 0.55 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.016898;
        data[i] = Math.max(
          -1,
          Math.min(1, (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11),
        );
        b6 = white * 0.115926;
      }
    }
  }

  return buffer;
}

export function createWaterfallAudio(): WaterfallAudioController {
  let audioContext: AudioContext | null = null;
  let masterGain: GainNode | null = null;
  let silentUnlockUrl: string | null = null;
  let silentUnlockAudio: HTMLAudioElement | null = null;
  let playing = false;
  let activeNodes: AudioNode[] = [];
  let activeSources: AudioScheduledSourceNode[] = [];

  const ensureSilentUnlockAudio = (): HTMLAudioElement => {
    if (!silentUnlockAudio) {
      silentUnlockUrl = createSilentWavObjectUrl();
      const element = new Audio(silentUnlockUrl);
      element.loop = true;
      element.preload = 'auto';
      element.setAttribute('playsinline', '');
      element.setAttribute('webkit-playsinline', '');
      silentUnlockAudio = element;
    }
    return silentUnlockAudio;
  };

  const initializeGraph = (context: AudioContext) => {
    if (masterGain) {
      return;
    }

    const master = context.createGain();
    master.gain.setValueAtTime(0.0001, context.currentTime);
    master.connect(context.destination);
    masterGain = master;

    const rumbleBuffer = createNoiseBuffer({
      context,
      durationSeconds: 4.5,
      flavor: 'brown',
    });
    const torrentBuffer = createNoiseBuffer({
      context,
      durationSeconds: 5.0,
      flavor: 'pink',
    });
    const mistBuffer = createNoiseBuffer({
      context,
      durationSeconds: 4.0,
      flavor: 'white',
    });

    const rumbleSource = context.createBufferSource();
    rumbleSource.buffer = rumbleBuffer;
    rumbleSource.loop = true;

    const rumbleFilter = context.createBiquadFilter();
    rumbleFilter.type = 'lowpass';
    rumbleFilter.frequency.value = 145;
    rumbleFilter.Q.value = 0.7;

    const rumbleGain = context.createGain();
    rumbleGain.gain.value = 0.72;

    const rumbleLfo = context.createOscillator();
    rumbleLfo.frequency.value = 0.14;
    const rumbleLfoDepth = context.createGain();
    rumbleLfoDepth.gain.value = 0.12;
    rumbleLfo.connect(rumbleLfoDepth);
    rumbleLfoDepth.connect(rumbleGain.gain);

    rumbleSource.connect(rumbleFilter);
    rumbleFilter.connect(rumbleGain);
    rumbleGain.connect(master);

    const torrentSource = context.createBufferSource();
    torrentSource.buffer = torrentBuffer;
    torrentSource.loop = true;

    const torrentFilter = context.createBiquadFilter();
    torrentFilter.type = 'bandpass';
    torrentFilter.frequency.value = 620;
    torrentFilter.Q.value = 0.52;

    const torrentGain = context.createGain();
    torrentGain.gain.value = 0.56;

    const torrentLfo = context.createOscillator();
    torrentLfo.frequency.value = 0.21;
    const torrentLfoDepth = context.createGain();
    torrentLfoDepth.gain.value = 95;
    torrentLfo.connect(torrentLfoDepth);
    torrentLfoDepth.connect(torrentFilter.frequency);

    torrentSource.connect(torrentFilter);
    torrentFilter.connect(torrentGain);
    torrentGain.connect(master);

    const mistSource = context.createBufferSource();
    mistSource.buffer = mistBuffer;
    mistSource.loop = true;

    const mistHighpass = context.createBiquadFilter();
    mistHighpass.type = 'highpass';
    mistHighpass.frequency.value = 2600;

    const mistLowpass = context.createBiquadFilter();
    mistLowpass.type = 'lowpass';
    mistLowpass.frequency.value = 7200;

    const mistGain = context.createGain();
    mistGain.gain.value = 0.14;

    const windLfo = context.createOscillator();
    windLfo.frequency.value = 0.09;
    const windLfoDepth = context.createGain();
    windLfoDepth.gain.value = 0.05;
    windLfo.connect(windLfoDepth);
    windLfoDepth.connect(mistGain.gain);

    mistSource.connect(mistHighpass);
    mistHighpass.connect(mistLowpass);
    mistLowpass.connect(mistGain);
    mistGain.connect(master);

    rumbleSource.start();
    torrentSource.start();
    mistSource.start();
    rumbleLfo.start();
    torrentLfo.start();
    windLfo.start();

    activeSources = [rumbleSource, torrentSource, mistSource, rumbleLfo, torrentLfo, windLfo];
    activeNodes = [
      master,
      rumbleFilter,
      rumbleGain,
      rumbleLfoDepth,
      torrentFilter,
      torrentGain,
      torrentLfoDepth,
      mistHighpass,
      mistLowpass,
      mistGain,
      windLfoDepth,
    ];
  };

  return {
    isPlaying: () => playing,
    toggle: async () => {
      const targetPlaying = !playing;

      if (targetPlaying) {
        setPlaybackAudioSession();
        const unlockElement = ensureSilentUnlockAudio();
        void unlockElement.play().catch(() => undefined);
      }

      if (!audioContext) {
        audioContext = createAudioContextInstance();
      }

      const resumePromise =
        audioContext.state !== 'running' ? audioContext.resume() : Promise.resolve();

      initializeGraph(audioContext);

      try {
        await resumePromise;
      } catch {
        silentUnlockAudio?.pause();
        playing = false;
        return false;
      }

      if (!masterGain) {
        return false;
      }

      const now = audioContext.currentTime;
      masterGain.gain.cancelScheduledValues(now);

      if (targetPlaying) {
        masterGain.gain.setTargetAtTime(0.46, now, 0.35);
        playing = true;
      } else {
        masterGain.gain.setTargetAtTime(0.0001, now, 0.22);
        silentUnlockAudio?.pause();
        playing = false;
      }

      return playing;
    },
    dispose: () => {
      for (const source of activeSources) {
        try {
          source.stop();
        } catch {
          source.disconnect();
          continue;
        }
        source.disconnect();
      }
      for (const node of activeNodes) {
        node.disconnect();
      }
      activeSources = [];
      activeNodes = [];
      if (silentUnlockAudio) {
        silentUnlockAudio.pause();
        silentUnlockAudio.src = '';
        silentUnlockAudio = null;
      }
      if (silentUnlockUrl) {
        URL.revokeObjectURL(silentUnlockUrl);
        silentUnlockUrl = null;
      }
      if (audioContext) {
        void audioContext.close();
        audioContext = null;
      }
      masterGain = null;
      playing = false;
    },
  };
}
