import { clamp } from '../../shared/pixel/math';
import { Raster } from '../../shared/pixel/raster';
import { Player } from './audio';
import { sceneAt } from './choreo';
import { render } from './render';
import {
  comparison,
  formatLength,
  formatVolume,
  groupDigits,
  lengthOfLevel,
  unitCount,
  volumeOfLevel,
} from './scale';
import { beatAt, envelopeAt, silenceStart } from './timeline';

/** 横に並ぶ画素の目安。320 × 200 の時代の画面の細かさ。 */
const TARGET_COLUMNS = 320;
/** 再生前と一時停止中に見せる拍。最初の音の直前、シャベルが最初の 1 個を載せている。 */
const POSTER_BEAT = -1.2;

type State = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

function rgba(css: string, fallback: number): number {
  const m = /^#([0-9a-f]{6})$/i.exec(css.trim());
  if (!m) return fallback;
  const v = Number.parseInt(m[1] ?? '0', 16);
  // ImageData は RGBA のバイト列。リトルエンディアンの Uint32 では ABGR になる。
  return (0xff << 24) | ((v & 0xff) << 16) | (v & 0xff00) | ((v >> 16) & 0xff);
}

export function mountRobotTune(root: HTMLElement): void {
  const canvasEl = root.querySelector<HTMLCanvasElement>('canvas');
  const buttonEl = root.querySelector<HTMLButtonElement>('[data-toggle]');
  const volume = root.querySelector<HTMLInputElement>('[data-volume]');
  const caption = root.querySelector<HTMLElement>('[data-caption]');
  const count = root.querySelector<HTMLElement>('[data-count]');
  const src = root.dataset.src;
  const context = canvasEl?.getContext('2d');
  if (!canvasEl || !buttonEl || !context || !src) return;
  // 下の関数宣言は巻き上げられるので、絞り込んだ型を名前ごと固定しておく。
  const canvas: HTMLCanvasElement = canvasEl;
  const button: HTMLButtonElement = buttonEl;
  const ctx2d: CanvasRenderingContext2D = context;

  const player = new Player();
  const raster = new Raster();
  let image: ImageData | null = null;
  let out: Uint32Array | null = null;
  let state: State = 'idle';
  let progress = 0;
  let visible = true;
  let raf = 0;
  let lastCaption = -2;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  const style = getComputedStyle(root);
  const palette = new Uint32Array([
    0,
    rgba(style.getPropertyValue('--bg'), 0xfffaf9f9),
    rgba(style.getPropertyValue('--ink'), 0xff1e1915),
    rgba(style.getPropertyValue('--amber'), 0xff0c58ea),
  ]);

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const cssW = root.clientWidth;
    if (cssW <= 0) return;
    const aspect = cssW < 520 ? 1 : 16 / 10;
    const devW = cssW * dpr;
    const px = Math.max(1, Math.round(devW / TARGET_COLUMNS));
    const w = Math.floor(devW / px);
    const h = Math.round(w / aspect);
    if (w !== raster.w || h !== raster.h) {
      raster.resize(w, h);
      canvas.width = w;
      canvas.height = h;
      image = ctx2d.createImageData(w, h);
      out = new Uint32Array(image.data.buffer);
    }
    canvas.style.width = `${(w * px) / dpr}px`;
    canvas.style.height = `${(h * px) / dpr}px`;
    draw();
  }

  function setCaption(level: number) {
    if (level === lastCaption || !caption) return;
    lastCaption = level;
    if (level < 0) {
      caption.textContent = '音が鳴っているあいだだけ、箱に体積がある。';
      if (count) count.textContent = '';
      return;
    }
    const cmp = comparison(level);
    caption.textContent = `一辺 ${formatLength(lengthOfLevel(level))}、体積 ${formatVolume(
      volumeOfLevel(level),
    )}。${cmp ?? ''}`;
    if (count) count.textContent = `1 cm³ の立方体 ${groupDigits(unitCount(level, 1))} 個`;
  }

  function status(): string | null {
    if (state === 'idle') return '▶ PLAY';
    if (state === 'loading') return `LOADING ${Math.round(progress * 100)}%`;
    if (state === 'paused') return '‖ PAUSE';
    if (state === 'error') return 'NO SOUND';
    return null;
  }

  function draw() {
    if (!image || !out) return;
    const playing = state === 'playing';
    const pos = playing || state === 'paused' ? player.position() : 0;
    const frozenAt = playing ? silenceStart(pos) : null;
    const beat = playing || state === 'paused' ? beatAt(frozenAt ?? pos) : POSTER_BEAT;
    const scene = sceneAt(Math.max(POSTER_BEAT, beat));
    const env = playing ? envelopeAt(pos) : null;
    const gain = volume ? Number(volume.value) : 0.8;
    // 音が止まった所で体積も消える。動きを減らす設定のときは、
    // 面の点滅を避けて止まるだけにする。
    const silent = !playing || frozenAt !== null;
    const xray = silent && !(reduced.matches && playing);
    const pump = env ? 0.72 + 0.28 * clamp(env.low * 1.4) : 1;
    render(raster, {
      scene,
      xray,
      fill: clamp(gain * 1.15) * pump,
      scope: playing ? player.scope() : null,
      status: status(),
      still: reduced.matches,
    });
    raster.present(out, palette);
    ctx2d.putImageData(image, 0, 0);
    const idle = state === 'idle' || state === 'loading' || scene.phase === 'pre';
    setCaption(idle ? -1 : scene.completed);
  }

  function loop() {
    raf = 0;
    draw();
    if (visible && (state === 'playing' || state === 'loading')) raf = requestAnimationFrame(loop);
  }
  const kick = () => {
    if (!raf) raf = requestAnimationFrame(loop);
  };

  function setState(s: State) {
    state = s;
    root.dataset.state = s;
    const label = s === 'playing' ? '一時停止' : '再生（音が出ます）';
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(s === 'playing'));
    kick();
  }

  button.addEventListener('click', async () => {
    if (state === 'loading') return;
    if (state === 'playing') {
      await player.pause();
      setState('paused');
      draw();
      return;
    }
    if (state === 'paused') {
      await player.resume();
      setState('playing');
      return;
    }
    try {
      player.prepare();
      if (!player.loaded) {
        setState('loading');
        await player.load(src, (r) => {
          progress = r;
        });
      }
      await player.resume();
      player.start();
      setState('playing');
    } catch {
      setState('error');
      draw();
    }
  });

  volume?.addEventListener('input', () => {
    player.setVolume(Number(volume.value));
    if (state !== 'playing') draw();
  });

  new ResizeObserver(resize).observe(root);
  new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    if (visible) kick();
  }).observe(root);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) kick();
  });
  setState('idle');
  resize();
}
