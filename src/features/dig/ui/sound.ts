/**
 * 小さな音。押した・打った・判定が通った・落ちた・何かを得た。WebAudio で
 * その場で作る（音の素材は持たない）。最初の操作まで鳴らさない。
 */
export class DigSound {
  private ctx: AudioContext | null = null;
  muted = false;

  private ensure(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    slide = 1,
    delay = 0,
  ): void {
    const c = this.ensure();
    if (!c) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  click(): void {
    this.tone(880, 0.04, 'square', 0.03);
  }
  hit(): void {
    this.tone(140, 0.14, 'triangle', 0.18, 0.4);
  }
  hurt(): void {
    this.tone(90, 0.22, 'sawtooth', 0.08, 0.5);
  }
  ok(): void {
    this.tone(660, 0.08, 'square', 0.05);
    this.tone(990, 0.12, 'square', 0.05, 1, 0.07);
  }
  fail(): void {
    this.tone(220, 0.18, 'square', 0.05, 0.7);
  }
  gain(): void {
    [523, 659, 784, 1047].forEach((f, i) => {
      this.tone(f, 0.16, 'triangle', 0.07, 1, i * 0.07);
    });
  }
  clue(): void {
    this.tone(1320, 0.06, 'sine', 0.06);
    this.tone(1760, 0.1, 'sine', 0.05, 1, 0.05);
  }
}
