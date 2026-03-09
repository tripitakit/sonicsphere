import * as Tone from 'tone';
import type { SoundArchetype, SourceVariation } from '../types.ts';

/**
 * Tone.js signal chain for a single sound source.
 *
 * Drone stack (pitch-stable, no frequency modulation):
 * mainOsc + subOsc + airOsc → filter → envelope → ampModGain → distanceGain → Panner3D → masterGain
 * ampLfo (slow)              → ampModGain.gain
 * timbreLfo (very slow)      → filter.frequency
 */
export class SourceSynth {
  private mainOsc:      Tone.Oscillator;
  private subOsc:       Tone.Oscillator;
  private airOsc:       Tone.Oscillator;
  private mainMix:      Tone.Gain;
  private subMix:       Tone.Gain;
  private airMix:       Tone.Gain;
  private filter:       Tone.Filter;
  private envelope:     Tone.AmplitudeEnvelope;
  private ampModGain:   Tone.Gain;
  private distanceGain: Tone.Gain;
  private panner:       Tone.Panner3D;
  private lfo:          Tone.LFO;
  private timbreLfo:    Tone.LFO;
  private releaseSeconds: number;
  private active = false;
  private disposeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly archetype: SoundArchetype,
    variation: SourceVariation,
    masterGain: Tone.Gain,
  ) {
    const isRhythmic = archetype.mode === 'rhythmic';

    // Apply per-source variation: detune via frequency multiplier, shifted filter, varied LFO rate
    const detuneMult   = Math.pow(2, variation.detuneCents / 1200);
    const tunedFreq    = Math.max(16, archetype.frequency * detuneMult);
    const tunedFilter  = archetype.filter.freq * variation.filterFreqMult;
    const tunedLfoRate = archetype.lfoRate * variation.lfoRateMult;

    this.mainOsc = new Tone.Oscillator(tunedFreq, archetype.waveform);
    this.subOsc = new Tone.Oscillator(tunedFreq * 0.5, 'sine');
    this.airOsc = new Tone.Oscillator(
      tunedFreq * 1.5,
      archetype.waveform === 'sine' ? 'triangle' : 'sawtooth',
    );

    // Rich drone blend: stable body + low sub + bright texture partial
    this.mainMix = new Tone.Gain(0.58);
    this.subMix  = new Tone.Gain(0.26);
    this.airMix  = new Tone.Gain(0.19);

    this.filter = new Tone.Filter({
      type:      archetype.filter.type,
      frequency: tunedFilter,
      Q:         archetype.filter.Q,
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
      panningModel:  'HRTF',
      distanceModel: 'linear',
      rolloffFactor: 1,
      refDistance:   1,
      maxDistance:   10000,
      positionX:     0,
      positionY:     0,
      positionZ:     -1,
    });

    const depthNorm = Math.min(1, archetype.lfoDepth / 140);
    const ampDepth = isRhythmic
      ? 0.58 + depthNorm * 0.38
      : 0.12 + depthNorm * 0.45;
    this.lfo = new Tone.LFO({
      frequency: isRhythmic
        ? Math.min(18, Math.max(0.25, tunedLfoRate))
        : Math.min(0.35, Math.max(0.02, tunedLfoRate * 0.12)),
      min: 1 - ampDepth,
      max: 1,
    });
    this.timbreLfo = new Tone.LFO({
      frequency: isRhythmic
        ? Math.min(2.4, Math.max(0.06, tunedLfoRate * 0.22))
        : Math.max(0.01, tunedLfoRate * 0.054),
      min: Math.max(40, tunedFilter * 0.58),
      max: Math.max(80, tunedFilter * 1.42),
    });

    // Wire signal chain
    this.mainOsc.connect(this.mainMix);
    this.subOsc.connect(this.subMix);
    this.airOsc.connect(this.airMix);
    this.mainMix.connect(this.filter);
    this.subMix.connect(this.filter);
    this.airMix.connect(this.filter);
    this.filter.connect(this.envelope);
    this.envelope.connect(this.ampModGain);
    this.ampModGain.connect(this.distanceGain);
    this.distanceGain.connect(this.panner);
    this.panner.connect(masterGain);

    // Wire slow modulators (amplitude + timbre only; pitch remains fixed)
    this.lfo.connect(this.ampModGain.gain);
    this.timbreLfo.connect(this.filter.frequency);
  }

  start(): void {
    if (this.active) return;
    // Cancel any pending disposal (re-entered range before old timer fired)
    if (this.disposeTimer !== null) {
      clearTimeout(this.disposeTimer);
      this.disposeTimer = null;
    }
    this.mainOsc.start();
    this.subOsc.start();
    this.airOsc.start();
    this.lfo.start();
    this.timbreLfo.start();
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
    this.distanceGain.gain.rampTo(gain, 0.05);
  }

  /** Source position in player-local frame for Panner3D. */
  setPosition(x: number, y: number, z: number): void {
    this.panner.positionX.value = x;
    this.panner.positionY.value = y;
    this.panner.positionZ.value = z;
  }

  isActive(): boolean { return this.active; }

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
    // Small delay to let the gain ramp settle before hard-killing nodes
    setTimeout(() => this.disposeNodes(), 200);
  }

  private disposeNodes(): void {
    try {
      this.mainOsc.stop();
      this.subOsc.stop();
      this.airOsc.stop();
      this.lfo.stop();
      this.timbreLfo.stop();

      this.mainOsc.dispose();
      this.subOsc.dispose();
      this.airOsc.dispose();
      this.mainMix.dispose();
      this.subMix.dispose();
      this.airMix.dispose();
      this.filter.dispose();
      this.envelope.dispose();
      this.ampModGain.dispose();
      this.distanceGain.dispose();
      this.panner.dispose();
      this.lfo.dispose();
      this.timbreLfo.dispose();
    } catch {
      // Already disposed — ignore
    }
  }
}
