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
    src.start(this.startAt, this.offset);
    this.source = src;
  }

  /** 今スピーカーから出ている音の、イントロ頭からの通算秒。 */
  position(): number {
    const ctx = this.ctx;
    if (!ctx) return 0;
    let now = ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
    if (ctx.state === 'running' && typeof ctx.getOutputTimestamp === 'function') {
      const ts = ctx.getOutputTimestamp();
      if (ts.contextTime && ts.performanceTime) {
        now = ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
      }
    }
    return now - this.startAt;
  }

  get playing(): boolean {
    return this.source !== null && this.ctx?.state === 'running';
  }

  async pause(): Promise<void> {
    await this.ctx?.suspend();
  }

  async resume(): Promise<void> {
    await this.ctx?.resume();
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
