/**
 * 射撃場の音。録音は使わず、全部 Web Audio で合成する。
 *
 * 銃声は白色雑音を低域通過で絞った破裂と、70 Hz の胴鳴りと、高域の
 * 割れの三つ重ね。そこに射撃場の土手から返ってくる遅延（0.11 s、
 * 帰還 0.28、低域通過）を足す。金属の音は正弦波を数本、減衰で鳴らす。
 */
export class RangeSound {
  ctx: AudioContext | null = null;
  out: GainNode | null = null;
  echo: GainNode | null = null;
  noise: AudioBuffer | null = null;
  muted = false;

  /** ユーザーの操作の中で一度呼ぶ。 */
  wake(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const out = ctx.createGain();
    out.gain.value = 0.7;
    out.connect(ctx.destination);
    // 土手の反響。
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.11;
    const fb = ctx.createGain();
    fb.gain.value = 0.28;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    const echo = ctx.createGain();
    echo.gain.value = 0.5;
    echo.connect(delay);
    delay.connect(lp);
    lp.connect(fb);
    fb.connect(delay);
    lp.connect(out);
    const len = ctx.sampleRate;
    const noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.ctx = ctx;
    this.out = out;
    this.echo = echo;
    this.noise = noise;
  }

  /** 射撃場を出るときに音の回路ごと手放す。 */
  shut(): void {
    void this.ctx?.close();
    this.ctx = null;
  }

  private env(start: number, peak: number, decay: number, wet = false): GainNode | null {
    const { ctx, out, echo } = this;
    if (!ctx || !out || this.muted) return null;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(peak, start + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, start + decay);
    g.connect(out);
    if (wet && echo) g.connect(echo);
    return g;
  }

  private burst(
    freq: number,
    q: number,
    peak: number,
    decay: number,
    type: BiquadFilterType,
    wet = false,
    at = 0,
  ) {
    const { ctx, noise } = this;
    if (!ctx || !noise) return;
    const t = ctx.currentTime + at;
    const g = this.env(t, peak, decay, wet);
    if (!g) return;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    src.connect(f);
    f.connect(g);
    src.start(t, Math.random() * 0.5);
    src.stop(t + decay + 0.05);
  }

  private tone(
    freq: number,
    peak: number,
    decay: number,
    type: OscillatorType = 'sine',
    at = 0,
    glide = 0,
  ) {
    const { ctx } = this;
    if (!ctx) return;
    const t = ctx.currentTime + at;
    const g = this.env(t, peak, decay);
    if (!g) return;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * glide), t + decay);
    o.connect(g);
    o.start(t);
    o.stop(t + decay + 0.05);
  }

  shot(): void {
    this.burst(2600, 0.5, 1.0, 0.32, 'lowpass', true);
    this.burst(6000, 0.8, 0.35, 0.05, 'highpass', true);
    this.tone(90, 0.9, 0.16, 'sine', 0, 0.45);
  }

  dry(): void {
    this.tone(1900, 0.25, 0.012, 'square');
    this.burst(4200, 4, 0.2, 0.02, 'bandpass');
  }

  /** シリンダーが 1 室ぶん送られる。 */
  index(): void {
    this.tone(3200, 0.08, 0.008, 'square');
  }

  open(): void {
    this.burst(1300, 3, 0.4, 0.04, 'bandpass');
    this.tone(2600, 0.1, 0.02, 'square', 0.01);
  }

  /** シリンダーが枠に収まる音。 */
  latch(): void {
    this.burst(700, 2, 0.7, 0.06, 'bandpass');
    this.tone(180, 0.4, 0.06, 'sine');
  }

  eject(): void {
    this.burst(900, 1, 0.3, 0.08, 'bandpass');
  }

  insert(): void {
    this.tone(2400, 0.14, 0.03, 'triangle');
    this.tone(3700, 0.08, 0.02, 'sine', 0.004);
  }

  /** 薬莢が床で鳴る。 */
  tinkle(): void {
    const n = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      this.tone(3800 + Math.random() * 2600, 0.07, 0.18, 'sine', i * (0.04 + Math.random() * 0.05));
    }
  }

  ding(): void {
    for (const [f, a] of [
      [930, 0.35],
      [1410, 0.22],
      [2090, 0.12],
    ] as const) {
      this.tone(f * (0.98 + Math.random() * 0.04), a, 0.9);
    }
  }

  shatter(): void {
    this.burst(3500, 0.7, 0.5, 0.3, 'highpass');
    for (let i = 0; i < 4; i++)
      this.tone(5000 + Math.random() * 3000, 0.05, 0.12, 'sine', 0.02 + i * 0.03);
  }

  thud(): void {
    this.burst(400, 1, 0.3, 0.12, 'lowpass');
  }
}
