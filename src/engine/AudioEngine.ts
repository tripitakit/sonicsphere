import * as Tone from 'tone';
import type { WeatherFxBlend } from '../types.ts';
import { DEFAULT_WEATHER_FX_BLEND } from './WeatherZoneEngine.ts';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Fast tuning surface for runtime weather-FX response.
 * Keep edits here for listening tests.
 */
const WEATHER_AUDIO_LIMITS = {
  wetLevel: { min: 0.06, max: 0.3 },
  delayTimeSec: { min: 0.1, max: 0.82 },
  delayFeedback: { min: 0.08, max: 0.56 },
  delayWet: { min: 0.05, max: 0.5 },
  reverbRoomSize: { min: 0.2, max: 0.82 },
  bandpassMix: { min: 0, max: 0.72 },
  bandpassQ: { min: 0.8, max: 8.5 },
  bandpassSweepHz: { min: 0.12, max: 12 },
  bandpassSweepMinHz: { min: 220, max: 6400 },
  bandpassSweepMaxHz: { max: 8400, minGap: 120 },
  highpassHz: { min: 35, max: 320 },
  lowpassHz: { min: 2600, max: 11000 },
} as const;

const WEATHER_AUDIO_RESPONSE = {
  dryAttenuationByWet: 0.82,
  mainRampSec: 0.22,
  lfoRampSec: 0.18,
} as const;

const WEATHER_AUDIO_GUARD = {
  // Avoid scheduling automation every frame when deltas are tiny.
  minApplyIntervalSec: 1 / 36,
  // Force immediate updates when changes are significant.
  largeDelta: {
    wetLevel: 0.035,
    delayFeedback: 0.045,
    bandpassMix: 0.06,
  },
  // Ignore micro-deltas that are below perceptual threshold.
  minDelta: {
    wetLevel: 0.0018,
    delayTimeSec: 0.0025,
    delayFeedback: 0.002,
    delayWet: 0.002,
    reverbRoomSize: 0.002,
    highpassHz: 2,
    lowpassHz: 16,
    bandpassMix: 0.003,
    bandpassQ: 0.02,
    bandpassSweepHz: 0.02,
    sweepMinHz: 8,
    sweepMaxHz: 8,
  },
  // Slew-rate limit on LFO frequency range to avoid abrupt filter jumps.
  maxSweepStepHzPerApply: 180,
} as const;

export class AudioEngine {
  // Main input bus for all spatialized sources.
  readonly masterGain: Tone.Gain;

  private dryGain: Tone.Gain;
  private wetGain: Tone.Gain;
  private highpass: Tone.Filter;
  private lowpass: Tone.Filter;
  private bandpass: Tone.Filter;
  private bandpassDryGain: Tone.Gain;
  private bandpassWetGain: Tone.Gain;
  private delay: Tone.FeedbackDelay;
  private reverb: Tone.JCReverb;
  private bandpassLfo: Tone.LFO;
  private limiter: Tone.Limiter;
  private started = false;
  private lastAppliedBlend: WeatherFxBlend | null = null;
  private lastBlendApplyAt = Number.NEGATIVE_INFINITY;
  private currentSweepMinHz = DEFAULT_WEATHER_FX_BLEND.bandpassSweepMinHz;
  private currentSweepMaxHz = DEFAULT_WEATHER_FX_BLEND.bandpassSweepMaxHz;

  constructor() {
    this.masterGain = new Tone.Gain(0);

    this.dryGain = new Tone.Gain(0.9);
    this.wetGain = new Tone.Gain(DEFAULT_WEATHER_FX_BLEND.wetLevel);

    this.highpass = new Tone.Filter({
      type: 'highpass',
      frequency: DEFAULT_WEATHER_FX_BLEND.highpassHz,
      Q: 0.7,
    });
    this.lowpass = new Tone.Filter({
      type: 'lowpass',
      frequency: DEFAULT_WEATHER_FX_BLEND.lowpassHz,
      Q: 0.85,
    });
    this.bandpass = new Tone.Filter({
      type: 'bandpass',
      frequency: (DEFAULT_WEATHER_FX_BLEND.bandpassSweepMinHz + DEFAULT_WEATHER_FX_BLEND.bandpassSweepMaxHz) * 0.5,
      Q: DEFAULT_WEATHER_FX_BLEND.bandpassQ,
    });
    this.bandpassDryGain = new Tone.Gain(1 - DEFAULT_WEATHER_FX_BLEND.bandpassMix);
    this.bandpassWetGain = new Tone.Gain(DEFAULT_WEATHER_FX_BLEND.bandpassMix);

    this.delay = new Tone.FeedbackDelay(
      DEFAULT_WEATHER_FX_BLEND.delayTimeSec,
      DEFAULT_WEATHER_FX_BLEND.delayFeedback,
    );
    this.delay.wet.value = DEFAULT_WEATHER_FX_BLEND.delayWet;

    this.reverb = new Tone.JCReverb(DEFAULT_WEATHER_FX_BLEND.reverbRoomSize);

    this.bandpassLfo = new Tone.LFO({
      type: 'sine',
      frequency: DEFAULT_WEATHER_FX_BLEND.bandpassSweepHz,
      min: DEFAULT_WEATHER_FX_BLEND.bandpassSweepMinHz,
      max: DEFAULT_WEATHER_FX_BLEND.bandpassSweepMaxHz,
    });
    this.bandpassLfo.connect(this.bandpass.frequency);
    this.bandpassLfo.start();

    // Limiter catches any clipping before it reaches the speakers.
    // Threshold -3 dBFS gives headroom for HRTF + FX peaks.
    this.limiter = new Tone.Limiter(-3);

    // Dry path: preserve direct HRTF localization.
    this.masterGain.connect(this.dryGain);
    this.dryGain.connect(this.limiter);

    // Wet path: subtle atmospheric processing driven by weather zones.
    this.masterGain.connect(this.highpass);
    this.highpass.connect(this.lowpass);

    this.lowpass.connect(this.bandpassDryGain);
    this.bandpassDryGain.connect(this.delay);

    this.lowpass.connect(this.bandpass);
    this.bandpass.connect(this.bandpassWetGain);
    this.bandpassWetGain.connect(this.delay);

    this.delay.connect(this.reverb);
    this.reverb.connect(this.wetGain);
    this.wetGain.connect(this.limiter);

    this.limiter.connect(Tone.getDestination());
    this.applyWeatherBlend(DEFAULT_WEATHER_FX_BLEND);
  }

  async start(): Promise<void> {
    if (this.started) return;
    await Tone.start();
    this.masterGain.gain.rampTo(0.75, 3);
    this.started = true;
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.masterGain.gain.rampTo(0, 2);
    await new Promise<void>((resolve) => setTimeout(resolve, 2200));
    this.started = false;
  }

  isStarted(): boolean { return this.started; }

  applyWeatherBlend(blend: WeatherFxBlend): void {
    const target: WeatherFxBlend = {
      wetLevel: clamp(
        finiteOr(blend.wetLevel, DEFAULT_WEATHER_FX_BLEND.wetLevel),
        WEATHER_AUDIO_LIMITS.wetLevel.min,
        WEATHER_AUDIO_LIMITS.wetLevel.max,
      ),
      delayTimeSec: clamp(
        finiteOr(blend.delayTimeSec, DEFAULT_WEATHER_FX_BLEND.delayTimeSec),
        WEATHER_AUDIO_LIMITS.delayTimeSec.min,
        WEATHER_AUDIO_LIMITS.delayTimeSec.max,
      ),
      delayFeedback: clamp(
        finiteOr(blend.delayFeedback, DEFAULT_WEATHER_FX_BLEND.delayFeedback),
        WEATHER_AUDIO_LIMITS.delayFeedback.min,
        WEATHER_AUDIO_LIMITS.delayFeedback.max,
      ),
      delayWet: clamp(
        finiteOr(blend.delayWet, DEFAULT_WEATHER_FX_BLEND.delayWet),
        WEATHER_AUDIO_LIMITS.delayWet.min,
        WEATHER_AUDIO_LIMITS.delayWet.max,
      ),
      reverbRoomSize: clamp(
        finiteOr(blend.reverbRoomSize, DEFAULT_WEATHER_FX_BLEND.reverbRoomSize),
        WEATHER_AUDIO_LIMITS.reverbRoomSize.min,
        WEATHER_AUDIO_LIMITS.reverbRoomSize.max,
      ),
      highpassHz: clamp(
        finiteOr(blend.highpassHz, DEFAULT_WEATHER_FX_BLEND.highpassHz),
        WEATHER_AUDIO_LIMITS.highpassHz.min,
        WEATHER_AUDIO_LIMITS.highpassHz.max,
      ),
      lowpassHz: clamp(
        finiteOr(blend.lowpassHz, DEFAULT_WEATHER_FX_BLEND.lowpassHz),
        WEATHER_AUDIO_LIMITS.lowpassHz.min,
        WEATHER_AUDIO_LIMITS.lowpassHz.max,
      ),
      bandpassMix: clamp(
        finiteOr(blend.bandpassMix, DEFAULT_WEATHER_FX_BLEND.bandpassMix),
        WEATHER_AUDIO_LIMITS.bandpassMix.min,
        WEATHER_AUDIO_LIMITS.bandpassMix.max,
      ),
      bandpassQ: clamp(
        finiteOr(blend.bandpassQ, DEFAULT_WEATHER_FX_BLEND.bandpassQ),
        WEATHER_AUDIO_LIMITS.bandpassQ.min,
        WEATHER_AUDIO_LIMITS.bandpassQ.max,
      ),
      bandpassSweepHz: clamp(
        finiteOr(blend.bandpassSweepHz, DEFAULT_WEATHER_FX_BLEND.bandpassSweepHz),
        WEATHER_AUDIO_LIMITS.bandpassSweepHz.min,
        WEATHER_AUDIO_LIMITS.bandpassSweepHz.max,
      ),
      bandpassSweepMinHz: clamp(
        finiteOr(blend.bandpassSweepMinHz, this.currentSweepMinHz),
        WEATHER_AUDIO_LIMITS.bandpassSweepMinHz.min,
        WEATHER_AUDIO_LIMITS.bandpassSweepMinHz.max,
      ),
      bandpassSweepMaxHz: finiteOr(blend.bandpassSweepMaxHz, this.currentSweepMaxHz),
    };
    target.bandpassSweepMaxHz = clamp(
      target.bandpassSweepMaxHz,
      target.bandpassSweepMinHz + WEATHER_AUDIO_LIMITS.bandpassSweepMaxHz.minGap,
      WEATHER_AUDIO_LIMITS.bandpassSweepMaxHz.max,
    );

    const now = Tone.now();
    if (!this.shouldApplyBlend(target, now)) return;

    const wetLevel = target.wetLevel;
    const dryLevel = clamp(
      1 - wetLevel * WEATHER_AUDIO_RESPONSE.dryAttenuationByWet,
      0.72,
      1,
    );
    const bandpassMix = target.bandpassMix;

    const sweepStep = WEATHER_AUDIO_GUARD.maxSweepStepHzPerApply;
    const sweepDeltaMin = clamp(target.bandpassSweepMinHz - this.currentSweepMinHz, -sweepStep, sweepStep);
    const sweepDeltaMax = clamp(target.bandpassSweepMaxHz - this.currentSweepMaxHz, -sweepStep, sweepStep);
    const nextSweepMin = this.currentSweepMinHz + sweepDeltaMin;
    let nextSweepMax = this.currentSweepMaxHz + sweepDeltaMax;
    nextSweepMax = Math.max(nextSweepMin + WEATHER_AUDIO_LIMITS.bandpassSweepMaxHz.minGap, nextSweepMax);
    nextSweepMax = Math.min(nextSweepMax, WEATHER_AUDIO_LIMITS.bandpassSweepMaxHz.max);
    this.currentSweepMinHz = nextSweepMin;
    this.currentSweepMaxHz = nextSweepMax;

    const ramp = WEATHER_AUDIO_RESPONSE.mainRampSec;

    this.dryGain.gain.rampTo(dryLevel, ramp);
    this.wetGain.gain.rampTo(wetLevel, ramp);

    this.highpass.frequency.rampTo(target.highpassHz, ramp);
    this.lowpass.frequency.rampTo(target.lowpassHz, ramp);

    this.delay.delayTime.rampTo(target.delayTimeSec, ramp);
    this.delay.feedback.rampTo(target.delayFeedback, ramp);
    this.delay.wet.rampTo(target.delayWet, ramp);
    this.reverb.roomSize.rampTo(target.reverbRoomSize, ramp * 1.3);

    this.bandpassDryGain.gain.rampTo(1 - bandpassMix, ramp);
    this.bandpassWetGain.gain.rampTo(bandpassMix, ramp);
    this.bandpass.Q.rampTo(target.bandpassQ, ramp);
    this.bandpassLfo.frequency.rampTo(target.bandpassSweepHz, WEATHER_AUDIO_RESPONSE.lfoRampSec);
    this.bandpassLfo.min = this.currentSweepMinHz;
    this.bandpassLfo.max = this.currentSweepMaxHz;

    this.lastAppliedBlend = {
      ...target,
      bandpassSweepMinHz: this.currentSweepMinHz,
      bandpassSweepMaxHz: this.currentSweepMaxHz,
    };
    this.lastBlendApplyAt = now;
  }

  private shouldApplyBlend(next: WeatherFxBlend, now: number): boolean {
    const prev = this.lastAppliedBlend;
    if (!prev) return true;

    const deltaWet = Math.abs(next.wetLevel - prev.wetLevel);
    const deltaDelayFeedback = Math.abs(next.delayFeedback - prev.delayFeedback);
    const deltaBandpassMix = Math.abs(next.bandpassMix - prev.bandpassMix);
    const deltaDelayTime = Math.abs(next.delayTimeSec - prev.delayTimeSec);
    const deltaDelayWet = Math.abs(next.delayWet - prev.delayWet);
    const deltaReverb = Math.abs(next.reverbRoomSize - prev.reverbRoomSize);
    const deltaHighpass = Math.abs(next.highpassHz - prev.highpassHz);
    const deltaLowpass = Math.abs(next.lowpassHz - prev.lowpassHz);
    const deltaBandpassQ = Math.abs(next.bandpassQ - prev.bandpassQ);
    const deltaSweepHz = Math.abs(next.bandpassSweepHz - prev.bandpassSweepHz);
    const deltaSweepMin = Math.abs(next.bandpassSweepMinHz - prev.bandpassSweepMinHz);
    const deltaSweepMax = Math.abs(next.bandpassSweepMaxHz - prev.bandpassSweepMaxHz);

    const largeDelta =
      deltaWet >= WEATHER_AUDIO_GUARD.largeDelta.wetLevel ||
      deltaDelayFeedback >= WEATHER_AUDIO_GUARD.largeDelta.delayFeedback ||
      deltaBandpassMix >= WEATHER_AUDIO_GUARD.largeDelta.bandpassMix;

    if (largeDelta) return true;
    if ((now - this.lastBlendApplyAt) < WEATHER_AUDIO_GUARD.minApplyIntervalSec) return false;

    return (
      deltaWet >= WEATHER_AUDIO_GUARD.minDelta.wetLevel ||
      deltaDelayTime >= WEATHER_AUDIO_GUARD.minDelta.delayTimeSec ||
      deltaDelayFeedback >= WEATHER_AUDIO_GUARD.minDelta.delayFeedback ||
      deltaDelayWet >= WEATHER_AUDIO_GUARD.minDelta.delayWet ||
      deltaReverb >= WEATHER_AUDIO_GUARD.minDelta.reverbRoomSize ||
      deltaHighpass >= WEATHER_AUDIO_GUARD.minDelta.highpassHz ||
      deltaLowpass >= WEATHER_AUDIO_GUARD.minDelta.lowpassHz ||
      deltaBandpassMix >= WEATHER_AUDIO_GUARD.minDelta.bandpassMix ||
      deltaBandpassQ >= WEATHER_AUDIO_GUARD.minDelta.bandpassQ ||
      deltaSweepHz >= WEATHER_AUDIO_GUARD.minDelta.bandpassSweepHz ||
      deltaSweepMin >= WEATHER_AUDIO_GUARD.minDelta.sweepMinHz ||
      deltaSweepMax >= WEATHER_AUDIO_GUARD.minDelta.sweepMaxHz
    );
  }

  dispose(): void {
    this.masterGain.dispose();
    this.dryGain.dispose();
    this.wetGain.dispose();
    this.highpass.dispose();
    this.lowpass.dispose();
    this.bandpass.dispose();
    this.bandpassDryGain.dispose();
    this.bandpassWetGain.dispose();
    this.delay.dispose();
    this.reverb.dispose();
    this.bandpassLfo.dispose();
    this.limiter.dispose();
  }
}
