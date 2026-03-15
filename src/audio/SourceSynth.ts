import * as Tone from 'tone';
import type { NoiseColor, SoundArchetype, SourceVariation } from '../types.ts';
import { PERFORMANCE_BUDGET } from '../engine/PerformanceBudget.ts';

/**
 * Tone.js signal chain for a single sound source.
 *
 * Engine families:
 * - subtractive: osc + sub + optional air partial
 * - noise: colored noise bed
 * - fm: inharmonic/FM tones
 * - resonator: noise excitation into comb resonance
 *
 * Common tail:
 * source bus -> filter -> envelope -> ampModGain -> distanceGain -> Panner3D -> masterGain
 * ampLfo                       -> ampModGain.gain
 * timbreLfo                    -> filter.frequency
 */

type StartableSource = Tone.Oscillator | Tone.FMOscillator | Tone.Noise;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function noiseType(color: NoiseColor | undefined): NoiseColor {
  return color ?? 'pink';
}

export class SourceSynth {
  private mainSource:   StartableSource;
  private subOsc:       Tone.Oscillator | null = null;
  private airOsc:       Tone.Oscillator | null = null;
  private mainMix:      Tone.Gain;
  private subMix:       Tone.Gain | null = null;
  private airMix:       Tone.Gain | null = null;
  private preFilterBus: Tone.Gain;
  private resonatorComb: Tone.FeedbackCombFilter | null = null;
  private filter:       Tone.Filter;
  private envelope:     Tone.AmplitudeEnvelope;
  private ampModGain:   Tone.Gain;
  private distanceGain: Tone.Gain;
  private panner:       Tone.Panner3D;
  private lfo:          Tone.LFO;
  private timbreLfo:    Tone.LFO | null;
  private releaseSeconds: number;
  private active = false;
  private disposeTimer: ReturnType<typeof setTimeout> | null = null;
  private lastDistanceGain = 0;
  private lastPos = { x: 0, y: 0, z: -1 };
  private readonly baseMainGain: number;

  constructor(
    private readonly archetype: SoundArchetype,
    variation: SourceVariation,
    masterGain: Tone.Gain,
  ) {
    const engine = archetype.engine ?? 'subtractive';
    const isRhythmic = archetype.mode === 'rhythmic';

    // Apply per-source variation: detune via frequency multiplier, shifted filter, varied LFO rate
    const detuneMult   = Math.pow(2, variation.detuneCents / 1200);
    const tunedFreq    = Math.max(16, archetype.frequency * detuneMult);
    const tunedFilter  = archetype.filter.freq * variation.filterFreqMult;
    const tunedLfoRate = archetype.lfoRate * variation.lfoRateMult;

    this.baseMainGain = engine === 'noise' ? 0.72 : engine === 'resonator' ? 0.64 : 0.58;
    this.mainMix = new Tone.Gain(this.baseMainGain);
    this.preFilterBus = new Tone.Gain(1);

    if (engine === 'noise') {
      this.mainSource = new Tone.Noise(noiseType(archetype.noiseColor));
    } else if (engine === 'fm') {
      this.mainSource = new Tone.FMOscillator({
        frequency: tunedFreq,
        type: archetype.waveform,
        modulationType: archetype.fmModulationType ?? 'sine',
        harmonicity: clamp(archetype.fmHarmonicity ?? 1.8, 0.2, 12),
        modulationIndex: clamp(archetype.fmModulationIndex ?? 3.2, 0.2, 40),
      });
    } else if (engine === 'resonator') {
      this.mainSource = new Tone.Noise(noiseType(archetype.noiseColor ?? 'white'));
      const resonatorHz = Math.max(40, archetype.resonatorHz ?? tunedFreq);
      const delayTime = clamp(1 / resonatorHz, 0.001, 0.05);
      const resonance = clamp(archetype.resonatorFeedback ?? 0.76, 0.05, 0.96);
      this.resonatorComb = new Tone.FeedbackCombFilter({
        delayTime,
        resonance,
      });
    } else {
      this.mainSource = new Tone.Oscillator(tunedFreq, archetype.waveform);
      this.subOsc = new Tone.Oscillator(tunedFreq * 0.5, 'sine');
      this.subMix = new Tone.Gain(0.26);
      if (PERFORMANCE_BUDGET.synth.enableAirOsc) {
        this.airOsc = new Tone.Oscillator(
          tunedFreq * 1.5,
          archetype.waveform === 'sine' ? 'triangle' : 'sawtooth',
        );
        this.airMix = new Tone.Gain(0.19);
      }
    }

    const filterQ = engine === 'resonator'
      ? Math.max(archetype.filter.Q, 4.2)
      : archetype.filter.Q;
    const filterFreq = engine === 'resonator'
      ? Math.max(tunedFilter, archetype.resonatorHz ?? tunedFreq)
      : tunedFilter;
    this.filter = new Tone.Filter({
      type:      archetype.filter.type,
      frequency: filterFreq,
      Q:         filterQ,
    });

    // Rhythmic mode keeps transient envelopes; drone mode keeps long sustain.
    this.releaseSeconds = isRhythmic
      ? Math.max(0.08, archetype.release)
      : Math.max(2.5, archetype.release);

    this.envelope = new Tone.AmplitudeEnvelope({
      attack: isRhythmic
        ? Math.max(0.002, archetype.attack)
        : Math.max(0.9, archetype.attack),
      decay: isRhythmic
        ? Math.max(0.03, archetype.decay)
        : Math.max(0.8, archetype.decay),
      sustain: isRhythmic
        ? Math.min(0.45, Math.max(0, archetype.sustain))
        : Math.max(0.72, archetype.sustain),
      release: this.releaseSeconds,
    });

    this.ampModGain   = new Tone.Gain(1);
    this.distanceGain = new Tone.Gain(0);

    this.panner = new Tone.Panner3D({
      panningModel:  PERFORMANCE_BUDGET.synth.panningModel,
      distanceModel: 'linear',
      rolloffFactor: 1,
      refDistance:   1,
      maxDistance:   10000,
      positionX:     0,
      positionY:     0,
      positionZ:     -1,
    });

    const depthNorm = Math.min(1, archetype.lfoDepth / 140);
    const baseAmpDepth = isRhythmic
      ? 0.58 + depthNorm * 0.38
      : 0.12 + depthNorm * 0.45;
    const ampDepth = engine === 'noise'
      ? Math.min(0.95, baseAmpDepth + 0.08)
      : engine === 'fm'
        ? Math.min(0.92, baseAmpDepth + 0.04)
        : baseAmpDepth;
    this.lfo = new Tone.LFO({
      frequency: isRhythmic
        ? Math.min(18, Math.max(0.25, tunedLfoRate))
        : Math.min(0.35, Math.max(0.02, tunedLfoRate * 0.12)),
      min: 1 - ampDepth,
      max: 1,
    });

    const timbreMinScale = engine === 'noise' ? 0.42 : 0.58;
    const timbreMaxScale = engine === 'noise' ? 1.9 : 1.42;
    this.timbreLfo = PERFORMANCE_BUDGET.synth.enableTimbreLfo
      ? new Tone.LFO({
          frequency: isRhythmic
            ? Math.min(2.4, Math.max(0.06, tunedLfoRate * 0.22))
            : Math.max(0.01, tunedLfoRate * 0.054),
          min: Math.max(40, filterFreq * timbreMinScale),
          max: Math.max(80, filterFreq * timbreMaxScale),
        })
      : null;

    // Wire signal chain
    this.mainSource.connect(this.mainMix);
    this.mainMix.connect(this.preFilterBus);
    if (this.subOsc && this.subMix) {
      this.subOsc.connect(this.subMix);
      this.subMix.connect(this.preFilterBus);
    }
    if (this.airOsc && this.airMix) {
      this.airOsc.connect(this.airMix);
      this.airMix.connect(this.preFilterBus);
    }

    if (this.resonatorComb) {
      this.preFilterBus.connect(this.resonatorComb);
      this.resonatorComb.connect(this.filter);
    } else {
      this.preFilterBus.connect(this.filter);
    }

    this.filter.connect(this.envelope);
    this.envelope.connect(this.ampModGain);
    this.ampModGain.connect(this.distanceGain);
    this.distanceGain.connect(this.panner);
    this.panner.connect(masterGain);

    // Wire slow modulators (amplitude + timbre only; pitch remains fixed)
    this.lfo.connect(this.ampModGain.gain);
    this.timbreLfo?.connect(this.filter.frequency);
  }

  start(): void {
    if (this.active) return;
    // Cancel any pending disposal (re-entered range before old timer fired)
    if (this.disposeTimer !== null) {
      clearTimeout(this.disposeTimer);
      this.disposeTimer = null;
    }
    this.mainSource.start();
    this.subOsc?.start();
    this.airOsc?.start();
    this.lfo.start();
    this.timbreLfo?.start();
    this.envelope.triggerAttack();
    this.active = true;
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    // Mute quickly to silence overlap with any incoming replacement synth
    this.distanceGain.gain.rampTo(0, 0.08);
    this.envelope.triggerRelease();
    const releaseMs = this.releaseSeconds * 1000 + 300;
    this.disposeTimer = setTimeout(() => {
      this.disposeTimer = null;
      this.disposeNodes();
    }, releaseMs);
  }

  /** Distance-based gain: 0 = silent, 1 = full. Smoothed to avoid clicks. */
  setDistanceGain(gain: number): void {
    const clamped = Math.max(0, Math.min(1, gain));
    if (Math.abs(clamped - this.lastDistanceGain) < PERFORMANCE_BUDGET.synth.minGainDelta) {
      return;
    }
    this.distanceGain.gain.rampTo(clamped, 0.05);
    this.lastDistanceGain = clamped;
  }

  /** Source position in player-local frame for Panner3D. */
  setPosition(x: number, y: number, z: number): void {
    const eps = PERFORMANCE_BUDGET.synth.minPositionDelta;
    if (
      Math.abs(x - this.lastPos.x) < eps &&
      Math.abs(y - this.lastPos.y) < eps &&
      Math.abs(z - this.lastPos.z) < eps
    ) {
      return;
    }
    this.panner.positionX.value = x;
    this.panner.positionY.value = y;
    this.panner.positionZ.value = z;
    this.lastPos = { x, y, z };
  }

  isActive(): boolean { return this.active; }

  /**
   * Live-update a single archetype parameter on the running signal chain.
   * Changes that require node rebuild (e.g. filter type) are silently ignored
   * here — the archetype object mutation in SoundSource handles future synths.
   */
  updateParam(key: string, value: number | string): void {
    const engine = this.archetype.engine ?? 'subtractive';
    const isRhythmic = this.archetype.mode === 'rhythmic';

    switch (key) {
      case 'frequency': {
        if (engine === 'subtractive') {
          const hz = Number(value);
          (this.mainSource as Tone.Oscillator).frequency.rampTo(hz, 0.05);
          if (this.subOsc)  this.subOsc.frequency.rampTo(hz * 0.5, 0.05);
          if (this.airOsc)  this.airOsc.frequency.rampTo(hz * 1.5, 0.05);
        } else if (engine === 'fm') {
          (this.mainSource as Tone.FMOscillator).frequency.rampTo(Number(value), 0.05);
        }
        break;
      }
      case 'waveform': {
        if (engine === 'subtractive') {
          (this.mainSource as Tone.Oscillator).type = value as Tone.ToneOscillatorType;
        } else if (engine === 'fm') {
          (this.mainSource as Tone.FMOscillator).type = value as Tone.ToneOscillatorType;
        }
        break;
      }
      case 'attack':
        this.envelope.attack = Number(value);
        break;
      case 'decay':
        this.envelope.decay = Number(value);
        break;
      case 'sustain': {
        const v = Number(value);
        this.envelope.sustain = v;
        // Ramp mainMix gain for immediate audible effect on the held note.
        this.mainMix.gain.rampTo(this.baseMainGain * Math.max(0, v), 0.05);
        break;
      }
      case 'release': {
        const r = Number(value);
        this.envelope.release = r;
        this.releaseSeconds = r;
        break;
      }
      case 'lfoRate': {
        const rate = Number(value);
        const clampedAmp = isRhythmic
          ? Math.min(18, Math.max(0.25, rate))
          : Math.min(0.35, Math.max(0.02, rate * 0.12));
        this.lfo.frequency.rampTo(clampedAmp, 0.2);
        if (this.timbreLfo) {
          const clampedTimbre = isRhythmic
            ? Math.min(2.4, Math.max(0.06, rate * 0.22))
            : Math.max(0.01, rate * 0.054);
          this.timbreLfo.frequency.rampTo(clampedTimbre, 0.2);
        }
        break;
      }
      case 'lfoDepth': {
        const depth = Number(value);
        const depthNorm = Math.min(1, depth / 140);
        const baseAmpDepth = isRhythmic
          ? 0.58 + depthNorm * 0.38
          : 0.12 + depthNorm * 0.45;
        const ampDepth = engine === 'noise'
          ? Math.min(0.95, baseAmpDepth + 0.08)
          : engine === 'fm'
            ? Math.min(0.92, baseAmpDepth + 0.04)
            : baseAmpDepth;
        this.lfo.min = 1 - ampDepth;
        break;
      }
      case 'filter.freq':
        this.filter.frequency.rampTo(Number(value), 0.1);
        break;
      case 'filter.Q':
        this.filter.Q.value = Number(value);
        break;
      case 'fmHarmonicity':
        if (engine === 'fm') {
          (this.mainSource as Tone.FMOscillator).harmonicity.value = Number(value);
        }
        break;
      case 'fmModulationIndex':
        if (engine === 'fm') {
          (this.mainSource as Tone.FMOscillator).modulationIndex.value = Number(value);
        }
        break;
      case 'fmModulationType':
        if (engine === 'fm') {
          (this.mainSource as Tone.FMOscillator).modulationType = value as Tone.ToneOscillatorType;
        }
        break;
      case 'noiseColor':
        if (engine === 'noise' || engine === 'resonator') {
          (this.mainSource as Tone.Noise).type = value as Tone.NoiseType;
        }
        break;
      case 'resonatorHz':
        if (this.resonatorComb) {
          const hz = Math.max(40, Number(value));
          this.resonatorComb.delayTime.value = clamp(1 / hz, 0.001, 0.05);
        }
        break;
      case 'resonatorFeedback':
        if (this.resonatorComb) {
          this.resonatorComb.resonance.value = clamp(Number(value), 0.05, 0.96);
        }
        break;
    }
  }

  dispose(): void {
    if (this.disposeTimer !== null) {
      clearTimeout(this.disposeTimer);
      this.disposeTimer = null;
    }
    if (this.active) {
      this.distanceGain.gain.rampTo(0, 0.05);
      this.envelope.triggerRelease();
      this.active = false;
    }
    this.lastDistanceGain = 0;
    // Small delay to let the gain ramp settle before hard-killing nodes
    setTimeout(() => this.disposeNodes(), 200);
  }

  private disposeNodes(): void {
    try {
      this.mainSource.stop();
      this.subOsc?.stop();
      this.airOsc?.stop();
      this.lfo.stop();
      this.timbreLfo?.stop();

      this.mainSource.dispose();
      this.subOsc?.dispose();
      this.airOsc?.dispose();
      this.mainMix.dispose();
      this.subMix?.dispose();
      this.airMix?.dispose();
      this.preFilterBus.dispose();
      this.resonatorComb?.dispose();
      this.filter.dispose();
      this.envelope.dispose();
      this.ampModGain.dispose();
      this.distanceGain.dispose();
      this.panner.dispose();
      this.lfo.dispose();
      this.timbreLfo?.dispose();
    } catch {
      // Already disposed — ignore
    }
  }
}
