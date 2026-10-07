/**
 * 整列のときに鳴る音塊。半音より狭い間隔で 9 本の声を重ね、ゆっくり
 * 立ち上げて、ゆっくり消す（リゲティの合唱の、ごく小さな模型）。
 * 触れたときにだけ鳴る。録音は使わない。
 */
let ctx: AudioContext | null = null;

export function cluster(): void {
  try {
    if (!ctx) {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new Ctx();
    }
    void ctx.resume();
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(0.16, t + 0.9);
    out.gain.setValueAtTime(0.16, t + 2.2);
    out.gain.exponentialRampToValueAtTime(0.0001, t + 4.2);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(600, t);
    lp.frequency.linearRampToValueAtTime(2400, t + 2.4);
    out.connect(lp);
    lp.connect(ctx.destination);
    for (let i = 0; i < 9; i++) {
      const o = ctx.createOscillator();
      o.type = i % 3 === 0 ? 'triangle' : 'sine';
      // 220 Hz から 3/4 半音ずつ。
      o.frequency.value = 220 * 2 ** ((i * 0.75) / 12);
      o.detune.setValueAtTime((Math.random() - 0.5) * 18, t);
      const g = ctx.createGain();
      g.gain.value = 1 / 9;
      o.connect(g);
      g.connect(out);
      o.start(t + i * 0.05);
      o.stop(t + 4.4);
    }
  } catch {
    // 音が出せない環境では、絵だけが整列する。
  }
}
