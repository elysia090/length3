import { INTRO_ONSET_SEC, LOOP_END_SEC, LOOP_START_SEC } from './timeline';

/**
 * イントロを 1 回鳴らしてから、ループを継ぎ目なしで回し続ける。
 *
 * <audio loop> はファイルの頭まで戻るので使えない。1 本のバッファを
 * AudioBufferSourceNode に載せ、loopStart / loopEnd をループの頭と尻に置く。
 *
 * MP3 は復号すると頭に数十 ms の詰め物が付くことがあり、付くかどうかは
 * ブラウザで違う。元の音源は 0.45 s の完全な無音から始まるので、復号した
 * バッファで最初に音が立つ位置を測り、ずれをそのまま全体のオフセットにする。
 */
export class Player {
  ctx: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private gain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private scopeData: Float32Array<ArrayBuffer> | null = null;
  private startAt = 0;
  private offset = 0;
  /** なめらかにした再生位置と、それを測った画面の時刻（ms）。 */
  private clock = 0;
  private clockAt = -1;
  private volume = 0.8;

  /** クリックの中で呼ぶ。AudioContext はユーザー操作の中でしか鳴らせない。 */
  prepare(): AudioContext {
    if (!this.ctx) {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx({ latencyHint: 'interactive' });
      this.gain = this.ctx.createGain();
      this.gain.gain.value = this.volume;
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.gain.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  async load(url: string, onProgress: (ratio: number) => void): Promise<void> {
    const ctx = this.prepare();
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`audio ${res.status}`);
    const total = Number(res.headers.get('content-length')) || 0;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      if (total) onProgress(got / total);
    }
    const bytes = new Uint8Array(got);
    let at = 0;
    for (const c of chunks) {
      bytes.set(c, at);
      at += c.length;
    }
    this.buffer = await ctx.decodeAudioData(bytes.buffer);
    this.offset = measureOffset(this.buffer);
  }

  get loaded(): boolean {
    return this.buffer !== null;
  }

  start(): void {
    const ctx = this.ctx;
    if (!ctx || !this.buffer || !this.gain) return;
    this.source?.stop();
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    src.loop = true;
    src.loopStart = LOOP_START_SEC + this.offset;
    src.loopEnd = LOOP_END_SEC + this.offset;
    src.connect(this.gain);
    this.startAt = ctx.currentTime + 0.06;
    this.clockAt = -1;
    src.start(this.startAt, this.offset);
    this.source = src;
  }

  /**
   * 今スピーカーから出ている音の、イントロ頭からの通算秒。
   *
   * 音の時計（currentTime / getOutputTimestamp）は描画のフレームより粗い
   * 刻みで進み、フレームごとに数 ms 前後する。そのまま絵に渡すとガタつく
   * ので、画面の時計で進めた予測に、音の時計とのずれを少しずつ足して寄せる。
   * 逆戻りはさせない。大きくずれたとき（復帰・シーク）だけ一気に合わせる。
   */
  position(): number {
    const ctx = this.ctx;
    if (!ctx) return 0;
    const perf = performance.now();
    let now = ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
    if (ctx.state === 'running' && typeof ctx.getOutputTimestamp === 'function') {
      const ts = ctx.getOutputTimestamp();
      if (ts.contextTime && ts.performanceTime) {
        now = ts.contextTime + (perf - ts.performanceTime) / 1000;
      }
    }
    const raw = now - this.startAt;
    if (ctx.state !== 'running' || this.clockAt < 0) {
      this.clock = raw;
      this.clockAt = perf;
      return raw;
    }
    const predicted = this.clock + (perf - this.clockAt) / 1000;
    const drift = raw - predicted;
    const next = Math.abs(drift) > 0.06 ? raw : predicted + drift * 0.08;
    this.clock = Math.max(this.clock, next);
    this.clockAt = perf;
    return this.clock;
  }

  get playing(): boolean {
    return this.source !== null && this.ctx?.state === 'running';
  }

  async pause(): Promise<void> {
    await this.ctx?.suspend();
    this.clockAt = -1;
  }

  async resume(): Promise<void> {
    await this.ctx?.resume();
    this.clockAt = -1;
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.gain && this.ctx) this.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  scope(): Float32Array | null {
    if (!this.analyser || !this.playing) return null;
    if (!this.scopeData) this.scopeData = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(this.scopeData);
    return this.scopeData;
  }
}

function measureOffset(buffer: AudioBuffer): number {
  const data = buffer.getChannelData(0);
  const limit = Math.min(data.length, Math.floor(buffer.sampleRate * 1.5));
  for (let i = 0; i < limit; i++) {
    if (Math.abs(data[i] ?? 0) > 0.01) {
      const d = i / buffer.sampleRate - INTRO_ONSET_SEC;
      return Math.min(0.2, Math.max(0, d));
    }
  }
  return 0;
}
