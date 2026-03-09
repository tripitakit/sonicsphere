import * as Tone from 'tone';

export class AudioEngine {
  readonly masterGain: Tone.Gain;
  private limiter: Tone.Limiter;
  private started = false;

  constructor() {
    this.masterGain = new Tone.Gain(0);
    // Limiter catches any clipping before it reaches the speakers.
    // Threshold -3 dBFS gives headroom for HRTF convolution peaks.
    this.limiter = new Tone.Limiter(-3);
    this.masterGain.connect(this.limiter);
    this.limiter.connect(Tone.getDestination());
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

  dispose(): void {
    this.masterGain.dispose();
    this.limiter.dispose();
  }
}
