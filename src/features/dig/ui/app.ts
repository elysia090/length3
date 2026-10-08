import { PACE } from '../content/balance';
import { cardName, cardTags, JOB_ARCH } from '../content/cardinfo';
import { IDLE, POSTURE, VITALS } from '../content/flavor';
import { sectionNo, sectionOf, useOf } from '../content/floors';
import type { Fx } from '../content/fx';
import { fxText } from '../content/fx';
import { lawsAt } from '../content/laws';
import { legendState } from '../content/legends';
import { defaultSheet, JOB_EPITHETS, JOB_ITEMS, ORIGINS, type Sheet } from '../content/origins';
import {
  allJobs,
  cardDef,
  epithetDef,
  foeDef,
  itemDef,
  jobDef,
  permDef,
  storyDef,
} from '../content/registry';
import { buildsOf } from '../content/sources';
import { nextTier, SURGES, tierOf } from '../content/surges';
import type { Basic, Cmd, Ev, RestAction } from '../core/events';
import type { Card, Goal, GoalSize, MapNode, World } from '../core/model';
import { fold } from '../core/reduce';
import { ARCH_NAME, type Archetype, TAG_NAME, type Tag } from '../core/tags';
import { clockOf, PHASE_NAME, phaseOf } from '../core/time';
import { getLang, setLang, tr } from '../i18n';
import { type Advice, advise, nodeLabel, type RouteKind, sourceLabel } from '../sim/advise';
import {
  bonusOf,
  canAccept,
  chainNext,
  incoming,
  leaveChance,
  resonance,
  shownIntent,
} from '../sim/encounter';
import { Game } from '../sim/game';
import { carryGoals, metric as goalMetric, goalText, REWARD_TEXT } from '../sim/goals';
import {
  foeHardness,
  hardnessLabel,
  MINERALS,
  nodeHardness,
  outmatched,
  youHardness,
} from '../sim/hardness';
import { misses } from '../sim/near';
import { maxHp, maxMind, stats } from '../sim/ops';
import {
  alterOptions,
  breathed,
  canChoose,
  cardPrice,
  curePrice,
  epPrice,
  isBridge,
  isHall,
  nodeOf,
  OUTCOME_NAME,
  permValue,
  priceOf,
  ROWS,
  reachable,
  restChance,
  storyChance,
  stratumName,
} from '../sim/run';
import { BADGE_NAME, badgesOf } from './badges';
import { button, type Child, fill, h, meter } from './dom';
import { HINTS, nextHint } from './hints';
import {
  bestSlot,
  cardEffect,
  delta,
  effectOf,
  say as sayDelta,
  withCard,
  withEpithet,
} from './preview';
import { loadProfile, loadRun, type Profile, saveProfile, saveRun } from './save';
import { DigSound } from './sound';
import type { TurnLine } from './state';
import { type RoomView, type Scene, Tower, type TowerView } from './tower';

/**
 * DIG の画面。底の見えない巨大な建物を、フロアごとに下りていく。
 *
 *   塔      斜めに見下ろしたフロアの積み重ね（本体）。部屋を押すと進む
 *   上帯    フロア・時刻・体力・精神・金・硬度・冠
 *   脇      いま起きていること（部屋の様子と三つの道／遭遇／出来事・拾う・食堂・古物商）
 *   手元    五つの枠のカード・所持品・刻んでいないエピテット・記憶
 *
 * 言葉は揃える：フロア・部屋・人物・硬度・カード・記憶・冠・エピテット・原型。
 */

type Screen = 'create' | 'play';

/** まだ地図のない建物（人物を決めているあいだ、下で待っている）。 */
const EMPTY: TowerView = {
  top: 1,
  floors: 9,
  rooms: [],
  edges: [],
  you: null,
  rival: null,
  routes: [],
  focus: null,
  enc: null,
};

const KIND_NAME: Record<MapNode['kind'], string> = {
  person: '人',
  danger: '危険',
  event: '出来事',
  rest: '食堂',
  shop: '古物商',
  boss: '最後の相手',
};

/** 素手の手が何をするか（触れると出る。効き目は四つの道にも映る）。 */
const BASIC_GLOSS: Record<Basic, string> = {
  press: '相手の体力を少し削る（信頼は 1 下がる）',
  brace: '守りと構えを得る（次の一撃と脅しを受け止める）',
  talk: '相手の信頼を少し得る',
  leave: 'この遭遇から抜ける（うまくいけば）',
  accept: '相手の申し出を受ける',
};

const BASIC_NAME: Record<Basic, string> = {
  press: '押す',
  brace: '構える',
  talk: '話す',
  leave: '立ち去る',
  accept: '応じる',
};

const clock = (hour: number) => `${String(clockOf(hour)).padStart(2, '0')}:00`;
const floorNo = (w: World, row: number) => (w.stratum - 1) * (ROWS + 1) + row + 1;

/**
 * 場所・人物・硬度の書き方は一つにそろえる（上帯・触れた札・部屋・遭遇・道の読み）。
 *   場所  B3・閉店間際の酒場     （B# は太字、・でつなぐ）
 *   人物  名前　硬度 5          （硬度は数字だけ。鉱物の名は触れると出る）
 */
const placeOf = (w: World, n: MapNode | undefined): Child[] =>
  n
    ? [
        h('b', {}, `B${floorNo(w, n.row)}`),
        `・${useOf(w.stratum, n.use)?.name ?? KIND_NAME[n.kind]}`,
      ]
    : [h('b', {}, `B${floorNo(w, 0)}`), `・${stratumName(w.stratum)}の上`];
/** 体と心の割合を、言葉の目盛り（満ちている・擦れている・傷んでいる・尽きかけ）に。 */
const band = (r: number): 0 | 1 | 2 | 3 => (r >= 0.75 ? 0 : r >= 0.45 ? 1 : r >= 0.2 ? 2 : 3);
const titled = (el: HTMLElement, text: string): HTMLElement => {
  el.title = tr(text);
  return el;
};

/** 共鳴の段（灯りの数で、決着のときに受け取るもの）。 */
const RES_STEPS: readonly [number, string][] = [
  [2, '金'],
  [3, '札の回数 +1'],
  [4, 'エピテット'],
  [6, '体と心が戻る'],
];

/** 小さな四角の並び（埋まった数 / 全部）。 */
const pipRow = (n: number, of: number, cls: string, fresh = false) =>
  h(
    'span',
    { class: `dig-pips dig-pips--${cls}`, 'aria-hidden': 'true' },
    Array.from({ length: of }, (_, i) =>
      h('i', { class: i < n ? (fresh && i === n - 1 ? 'is-on is-new' : 'is-on') : '' }),
    ),
  );

/** 文の一つを、決まった鍵で選ぶ（描き直しても揺れないように）。 */
const pickBy = <T>(list: readonly T[], key: string): T | undefined => {
  let x = 0;
  for (let i = 0; i < key.length; i++) x = (x * 31 + key.charCodeAt(i)) >>> 0;
  return list[x % Math.max(1, list.length)];
};

/** 区画の番号（一・二・三…）。 */
const KANJI = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
const sectNo = (n: number) => (n <= 10 ? (KANJI[n] ?? String(n)) : String(n));

/**
 * 区画の進み。九階で一つの区画で、九つ目が最後の相手。いまの階は琥珀、
 * 下りた階は塗り、最後の相手は菱形。区画の番号を頭に添える。
 */
const sectionGauge = (w: World, row: number) => {
  const first = floorNo(w, 0);
  const last = floorNo(w, ROWS);
  return h(
    'span',
    {
      class: 'dig-sect',
      title: `${sectNo(w.stratum)}の区画・${stratumName(w.stratum)}　B${first}〜B${last}（B${last} に最後の相手）`,
    },
    h('b', { class: 'dig-sect__no' }, `${sectNo(w.stratum)}区`),
    Array.from({ length: ROWS + 1 }, (_, i) =>
      h('i', {
        class: `dig-sect__c${i === ROWS ? ' is-boss' : ''}${i < row ? ' is-done' : ''}${i === row ? ' is-here' : ''}`,
      }),
    ),
  );
};

const whoOf = (n: MapNode) => (n.npc ? foeDef(n.npc).name : KIND_NAME[n.kind]);
const hardTag = (hard: number, you?: number) =>
  h(
    'span',
    {
      class: `dig-hard${you !== undefined && outmatched(hard, you) ? ' is-over' : ''}`,
      title: hardnessLabel(hard),
    },
    `硬度 ${hard}`,
  );
/** 回数の目盛り（残り＝塗り、使った分＝枠だけ）。文字ではなく四角で、字体に左右されない。 */
const pips = (c: Card) =>
  h(
    'span',
    { class: 'dig-card__uses', 'aria-label': `${Math.max(0, c.uses)}/${c.max}` },
    Array.from({ length: Math.max(c.max, c.uses) }, (_, i) =>
      h('i', { class: i < c.uses ? 'is-on' : '' }),
    ),
  );

export function openDig(doc: Document, onClose: () => void): void {
  const profile: Profile = loadProfile();
  const sound = new DigSound();
  sound.muted = profile.muted;
  let game: Game | null = null;
  let screen: Screen = 'create';
  let focus: number | null = null;
  /** 押して見ている部屋（脇に詳しく出す）。 */
  let pinned: number | null = null;
  /** 見取り図に描く道（選んだ一本と、触れている一本だけ）。 */
  let routeSel: RouteKind | null = null;
  let routePeek: RouteKind | null = null;
  /** 案内を一覧でめくっているときの位置。 */
  let browse: number | null = null;
  let hintShown: string | null = null;
  /** 遭遇の外で押して開いたカード（触れられない端末でも中身を読める）。 */
  let opened: number | null = null;
  /** 遭遇中に触れている札（相手の四つの道に、効き目を先に映す）。 */
  let hoverSlot: number | null = null;
  /** 触れている素手の手（札と同じく、四つの道に先に映す）。 */
  let hoverAct: Basic | null = null;
  /** 触れている選択肢（押す前に、相手になれる札を白く見せる）。 */
  let hoverAim: typeof aim = null;
  /** 最後に体か心が戻った時刻（上の帯の計器を、少しのあいだ緑に）。 */
  let healAt = -9;
  /** 直前の手番（あなたが何をして、相手が何をしたか）。基本の一巡を見せる。 */
  let lastTurn: TurnLine[] = [];
  let advice: Advice | null = null;
  let adviceAt = -1;
  let log: string[] = [];
  /** 次に手元の枠を押したとき、何をするか。 */
  let aim:
    | { kind: 'inscribe'; ep: string }
    | { kind: 'rest'; action: RestAction }
    | { kind: 'buy'; id: string }
    | { kind: 'pick'; id: string }
    | { kind: 'alter'; slot: number; to: string }
    | null = null;
  const reward: { take?: string; help?: number } = {};
  const anim = {
    foeHitAt: -9,
    youHitAt: -9,
    end: null as 'fall' | 'glow' | null,
    endAt: -9,
    chain: 0,
    chainAt: -9,
  };
  /** 跳ねる数（遭遇の場面に、少しのあいだ浮かぶ）。 */
  let pops: Scene['pops'][number][] = [];
  const pop = (
    who: 'you' | 'foe',
    n: number,
    tone: 'ink' | 'amber' | 'blue' | 'green',
    at: number,
  ) => {
    if (!n) return;
    // 同じ瞬間に同じ側で跳ねる数は、少しずつずらす。
    const same = pops.filter((p) => p.who === who && at - p.at < 0.25).length;
    pops = [
      ...pops.filter((p) => at - p.at < 1.6),
      { who, text: n > 0 ? `+${n}` : `${n}`, tone, at: at + same * 0.18 },
    ];
  };
  let create = { job: 'watch', ...defaultSheet('watch'), name: '', depth: 0, daily: false };

  const t0 = performance.now();
  const now = () => (performance.now() - t0) / 1000;

  const dialog = h('dialog', { class: 'dig', 'aria-label': 'DIG' });
  const bar = h('header', { class: 'dig-bar' });
  const canvas = h('canvas', { class: 'dig-tower', 'aria-label': '塔の見取り図' });
  const tip = h('div', { class: 'dig-tip', hidden: true });
  // 案内の帯（天井の代わり）。名場面・いまの一文・ヒントを、一つずつ。
  const moment = h('p', { class: 'dig-guide__moment', hidden: true });
  const caption = h('p', { class: 'dig-guide__line' });
  const hintBox = h('div', { class: 'dig-guide__hint' });
  const guide = h('div', { class: 'dig-guide' }, moment, caption, hintBox);
  /** 寄る／見渡す（地図の右下の ＋ − 。ホイールでも）。いまの側は押せない。 */
  const zoomIn = h(
    'button',
    { type: 'button', class: 'dig-zoom__b', 'aria-label': '寄る', title: '寄る' },
    '+',
  );
  const zoomOut = h(
    'button',
    { type: 'button', class: 'dig-zoom__b', 'aria-label': '見渡す', title: '見渡す' },
    '−',
  );
  const zoomer = h('div', { class: 'dig-zoom' }, zoomIn, zoomOut);
  const view = h('div', { class: 'dig-view' }, guide, canvas, tip, zoomer);
  const side = h('aside', { class: 'dig-side' });
  const tray = h('footer', { class: 'dig-tray' });
  const live = h('p', { class: 'dig-live', 'aria-live': 'polite' });
  const main = h('main', { class: 'dig-main' }, view, side);
  const app = h('div', { class: 'dig-app' }, bar, main, tray, live);
  dialog.append(app);
  doc.body.append(dialog);
  dialog.showModal();
  // 開いた直後は、どの印にも焦点を置かない（左上の小さな印に輪が出ないように）。
  dialog.tabIndex = -1;
  dialog.focus();
  const tower = new Tower(canvas);

  // ─── 開け閉め ───────────────────────────────────────────────

  let raf = 0;
  function close(): void {
    cancelAnimationFrame(raf);
    if (game && !game.world.ending) saveRun(game.save());
    saveProfile(profile);
    doc.removeEventListener('keydown', onKey, true);
    dialog.close();
    dialog.remove();
    onClose();
  }
  dialog.addEventListener('cancel', (ev) => {
    ev.preventDefault();
    if (aim) {
      aim = null;
      render();
      return;
    }
    close();
  });

  // ─── 指す ───────────────────────────────────────────────────

  /**
   * 演出のあいだ見せている世界。手番は決めた瞬間に最後まで進むが、画面は
   * 札が当たるまで一手前の姿、当たってから相手が返すまではこちらの一手ぶん
   * だけ進んだ姿を見せる（決まる順に、目で追えるように）。
   */
  let staged: World | null = null;
  let heldView: TowerView | null = null;
  let busy = false;

  function send(cmd: Cmd): boolean {
    if (!game || busy) return false;
    lastInput = now();
    // 動いたら近景に戻る（次の一手が、すぐ目の前に見えるように）。
    if (cmd.c === 'move' && tower.overview) setOverview(false);
    const w0 = game.world;
    const before = w0.enc ? shownIntent(w0)?.label : undefined;
    const turn =
      w0.enc?.who === 'you' &&
      w0.enc.phase === 'act' &&
      (cmd.c === 'card' || cmd.c === 'act') &&
      !still();
    const pre = turn ? structuredClone(w0) : null;
    const preView = turn ? towerView(w0) : null;
    const evs = game.dispatch(cmd);
    if (cmd.c === 'card' || cmd.c === 'act') lastTurn = summarize(cmd, evs, before);
    else if (cmd.c === 'move' || cmd.c === 'close') lastTurn = [];
    hoverSlot = null;
    hoverAct = null;
    if (!evs.length) {
      sound.fail();
      return false;
    }
    if (hintShown) seeHint(hintShown);
    aim = null;
    hoverAim = null;
    if (cmd.c === 'claim') {
      reward.take = undefined;
      reward.help = undefined;
    }
    if (pre && preView) {
      play(cmd, evs, pre, preView);
      return true;
    }
    react(evs);
    settle();
    return true;
  }

  /** 手番を閉じる（地力の伸び・保存・終わり・描き直し）。 */
  function settle(): void {
    if (!game) return;
    const w = game.world;
    rise(w);
    if (w.ending) finishRun(w);
    else saveRun(game.save());
    render();
  }

  /**
   * 手番の段取り。打った札から手札が一枚ずつ跳ねて波になり、波が端まで届くと
   * 手札が全部いっしょに跳ねる。その瞬間にこちらの一手の結果が出て、計器も
   * そろって沈む。相手の返しは半拍おいてから。
   */
  function play(cmd: Cmd, evs: readonly Ev[], pre: World, preView: TowerView): void {
    busy = true;
    staged = pre;
    heldView = preView;
    const at = evs.findIndex((e) => e.type === 'act');
    const mine = at < 0 ? evs : evs.slice(0, at);
    const theirs = at < 0 ? [] : evs.slice(at);
    const chained = mine.some((e) => e.type === 'enc.st' && e.key === 'chain' && e.n > 0);
    const chain = chained ? streak + 1 : 0;
    const flight = cmd.c === 'card' ? waveHand(cmd.slot) : 0;
    window.setTimeout(() => {
      heldView = null;
      staged = fold(mine, pre);
      react(mine);
      // 計器は、こちらの一手が何であれ札といっしょに沈む（削ったときだけ連鎖の深さで）。
      kick(mine.some((e) => e.type === 'foe' && e.n < 0) ? chain : 0, 1);
      const done = () => {
        staged = null;
        busy = false;
        settle();
      };
      // 一斉の跳ねは描き直したあとの札に（描き直すと動きが消えるので）。
      if (!theirs.length) {
        done();
        allHop();
        return;
      }
      render();
      allHop();
      window.setTimeout(() => {
        staged = null;
        react(theirs);
        if (
          theirs.some(
            (e) => e.type === 'vital' && e.who === 'you' && ((e.hp ?? 0) < 0 || (e.mind ?? 0) < 0),
          )
        )
          kick(0, -1);
        done();
      }, 480);
    }, flight || 140);
  }

  const handCards = () => [...tray.querySelectorAll<HTMLElement>('.dig-hand > .dig-card')];
  const hop = (el: HTMLElement, lift: number, ms: number, delay = 0) =>
    el.animate(
      [
        { transform: 'translateY(0)', easing: 'cubic-bezier(.2,.8,.3,1)' },
        { transform: `translateY(${-lift}px)`, offset: 0.45, easing: 'cubic-bezier(.7,0,1,.6)' },
        { transform: 'translateY(0)' },
      ],
      // 足し合わせる（身を乗り出している札は、乗り出したところから跳ねる）。
      { duration: ms, delay, composite: 'add' },
    );

  /**
   * 札を打つ。打った札から両隣へ、手札が一枚ずつ少しだけ（4px）跳ねて波になる。
   * 波が端まで届いたところが当たり（当たりの瞬間の一斉の跳ねは allHop）。
   * 当たるまでのミリ秒を返す。
   */
  function waveHand(slot: number): number {
    const cards = handCards();
    if (!cards.length) return 0;
    const step = 40;
    const ms = 140;
    let far = 0;
    cards.forEach((el, i) => {
      const d = Math.abs(i - slot);
      far = Math.max(far, d);
      hop(el, 4, ms, d * step);
    });
    return far * step + ms;
  }

  /** 当たりの瞬間、手札が全部いっしょに少しだけ跳ねる。 */
  function allHop(): void {
    if (still()) return;
    for (const el of handCards()) hop(el, 8, 180);
  }

  /**
   * 計器ごと揺らす（一度だけ、全部いっしょに）。dir 1 はこちらの一撃の衝撃で
   * 沈む（連鎖が続くほど深く、それでも 3px まで）。-1 は受けた一撃で横にずれる。
   */
  let kickTimer = 0;
  function kick(chain: number, dir: 1 | -1): void {
    if (still()) return;
    const k = 1 + Math.min(chain, 2);
    app.style.setProperty('--kick-x', dir > 0 ? '0px' : '-2px');
    app.style.setProperty('--kick-y', dir > 0 ? `${k}px` : '0px');
    app.classList.remove('is-kick');
    void app.offsetWidth;
    app.classList.add('is-kick');
    window.clearTimeout(kickTimer);
    kickTimer = window.setTimeout(() => app.classList.remove('is-kick'), 600);
  }

  function react(evs: readonly Ev[]): void {
    const t = now();
    for (const ev of evs) {
      switch (ev.type) {
        case 'foe':
          if ((ev.field === 'hp' || ev.field === 'resolve') && ev.n < 0 && ev.by === 'you') {
            anim.foeHitAt = t;
            sound.hit();
            // 当たった瞬間を、ほんの少しだけ止める（重い手ほど長く）。
            stop(0.04 + Math.min(0.05, -ev.n / 200));
          }
          if (ev.field === 'hp' || ev.field === 'resolve') pop('foe', ev.n, 'ink', t);
          else if (ev.field === 'trust' || ev.field === 'guard') pop('foe', ev.n, 'blue', t);
          break;
        case 'vital':
          if (ev.who === 'you' && ((ev.hp ?? 0) < 0 || (ev.mind ?? 0) < 0) && game?.world.enc) {
            anim.youHitAt = t;
            sound.hurt();
          }
          if (ev.who === 'you' && game?.world.enc) {
            // 戻った分は緑。
            pop('you', ev.hp ?? 0, (ev.hp ?? 0) > 0 ? 'green' : 'ink', t);
            pop('you', ev.mind ?? 0, (ev.mind ?? 0) > 0 ? 'green' : 'ink', t);
          }
          if (ev.who === 'you' && ((ev.hp ?? 0) > 0 || (ev.mind ?? 0) > 0)) {
            healAt = t;
            window.setTimeout(() => renderBar(), 1300);
          }
          break;
        case 'enc.you':
          if (ev.n > 0) pop('you', ev.n, 'amber', t);
          break;
        case 'enc.close':
          cut(false);
          break;
        case 'enc.start':
          if (ev.who === 'you') {
            cut(false);
            anim.end = null;
            anim.endAt = -9;
            streak = 0;
            anim.chain = 0;
            anim.chainAt = -9;
            lit = 0;
            spoils = { list: [], at: -9 };
            spoilsPlayed = false;
            mutterTurn = -1;
          }
          break;
        case 'enc.end':
          anim.end = ['beaten', 'broken'].includes(ev.outcome)
            ? 'fall'
            : ev.outcome === 'trusted' || ev.outcome === 'uncovered'
              ? 'glow'
              : null;
          anim.endAt = t;
          if (ev.outcome !== 'left') cut(true);
          if (anim.end) sound.ok();
          else sound.fail();
          // 決着の絵を見せてから、受け取りへ（二度押しをなくす）。
          window.setTimeout(() => {
            if (game?.world.enc?.phase === 'over' && game.world.enc.who === 'you')
              send({ c: 'close' });
          }, 1100);
          break;
        case 'clue':
          if (ev.shown) sound.clue();
          break;
        case 'title':
        case 'perm':
          sound.gain();
          break;
        case 'enc.st':
          if (ev.key === 'chain') {
            streak = Math.max(0, streak + ev.n);
            bestStreak = Math.max(bestStreak, streak);
            anim.chain = streak;
            // 連鎖のイベントは札を使う前に出るので、誰の遭遇かで見分ける。
            if (ev.n > 0 && (game?.world.enc?.who ?? 'you') === 'you') showCombo(streak);
          } else if (ev.key.startsWith('r:') && ev.n > 0 && game?.world.enc?.who === 'you') {
            lit++;
            litAt = t;
            sound.resonate(lit);
          }
          break;
        case 'card.set':
          if (ev.who === 'you' && ev.card) {
            newAt.set(ev.slot, t);
            sound.gain();
          }
          break;
        case 'card.ep':
          // エピテットを刻んだ札も、入ったばかりの札と同じく光らせる。
          if (ev.who === 'you' && ev.on && !game?.world.enc) {
            newAt.set(ev.slot, t);
            sound.gain();
          }
          break;
        case 'coins':
          if (ev.who === 'you' && ev.n > 0) {
            coinGain = { n: ev.n + (t - coinGain.at < 0.5 ? coinGain.n : 0), at: t };
            window.setTimeout(() => renderBar(), 1500);
          }
          break;
        case 'found':
          foundNow = true;
          break;
        case 'goal.done':
          sound.ok();
          sound.gain();
          break;
        case 'goal.set':
          goalAt = { size: ev.goal.size, t };
          break;
        case 'grew':
          if (ev.who === 'you' && (ev.n ?? 1) > 0) {
            sound.gain();
            showCaption(`${ev.stat} が伸びた`);
          }
          break;
        case 'note': {
          // 重みで出し分ける：0 読み上げだけ、1 帯に一瞬、2 記録にも、3 名場面。
          const lv = ev.level ?? 1;
          // 拾い物は、小さく鳴る（運がよかった、という合図）。
          if (ev.text.startsWith('拾い物')) sound.clue();
          // 決着の見返りは、帯ではなく受け取りの画面に一つずつ並べる。
          if (ev.text.startsWith('手に入れた：')) {
            spoils = { list: ev.text.slice('手に入れた：'.length).split('、'), at: t };
            log = [...log.slice(-30), ev.text];
            break;
          }
          live.textContent = tr(ev.text);
          if (lv >= 2) log = [...log.slice(-30), ev.text];
          if (lv === 3) showMoment(ev.text);
          else if (lv >= 1) showCaption(ev.text);
          break;
        }
        case 'say':
          live.textContent = tr(ev.text);
          // 会心と隠し効果は、帯の一言ではなく、場面の上で。
          if (ev.who === 'voice' && ev.text === '会心。') {
            crit();
            break;
          }
          if (ev.who === 'voice' && foundNow && ev.text.startsWith('隠し効果：')) {
            foundNow = false;
            sound.gain();
            showMoment(ev.text);
            break;
          }
          showCaption(ev.who === 'foe' ? `「${ev.text}」` : ev.text);
          break;
        default:
          break;
      }
    }
  }

  let captionTimer = 0;
  function showCaption(text: string): void {
    caption.textContent = tr(text);
    caption.classList.add('is-on');
    window.clearTimeout(captionTimer);
    captionTimer = window.setTimeout(() => caption.classList.remove('is-on'), 2600);
  }

  /** 連鎖の続き・共鳴の灯りの数（画面の側で数える。演出のため）。 */
  let streak = 0;
  let lit = 0;
  let litAt = -9;
  /** 新しく入った札の枠・増えた金・見つけた隠し効果・決着の見返り（演出のため）。 */
  const newAt = new Map<number, number>();
  let coinGain = { n: 0, at: -9 };
  let foundNow = false;
  let spoils: { list: string[]; at: number } = { list: [], at: -9 };
  let hardSeen = 0;
  let spoilsPlayed = false;
  let bestBefore = 0;
  let bestStreak = 0;
  /** 新しく入った札の演出は、入った直後の一度の描画だけ（描き直しで繰り返さない）。 */
  function fresh(slot: number): boolean {
    const t = newAt.get(slot);
    if (t === undefined) return false;
    newAt.delete(slot);
    return now() - t < 1.6;
  }
  /** 連鎖：場面の中で、あなたが踏み込み、続けた数だけ波が広がる（字は出さない）。 */
  function showCombo(n: number): void {
    anim.chainAt = now();
    sound.chain(n);
    if (!still()) tower.punch(0.03 + 0.025 * Math.min(n, 3), now());
    stop(0.05 + 0.025 * Math.min(n, 3));
  }

  /** 会心：いちばん強い止めと寄り。 */
  function crit(): void {
    sound.chain(3);
    if (!still()) tower.punch(0.1, now());
    stop(0.12);
  }

  /** 止め（ヒットストップ）。s 秒だけ、場面の絵を止める。 */
  let freezeUntil = 0;
  const still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function stop(s: number): void {
    if (still()) return;
    freezeUntil = Math.max(freezeUntil, now() + s);
  }

  /** 決着：灯りが二人のところまで絞られ（アイリス）、ゆっくり寄って止まる。 */
  function cut(on: boolean): void {
    tower.settle(on && !still() ? 0.1 : 0, now());
  }
  /** 地力（硬度）が上がったら、名場面に（鉱物の名が一つ硬いものへ）。 */
  let hardAt = -9;
  function rise(w: World): void {
    const hd = youHardness(w);
    if (hardSeen && hd > hardSeen && !w.ending) {
      hardAt = now();
      sound.gain();
      showMoment(
        `硬度が ${hd} に上がった ── ${MINERALS[hardSeen] ?? ''}から${MINERALS[hd] ?? ''}へ`,
      );
    }
    hardSeen = hd;
  }

  /** いちばん新しく置かれた目標（少しのあいだ光らせる）。 */
  let goalAt: { size: GoalSize | null; t: number } = { size: null, t: -9 };

  const moments: string[] = [];
  let momentBusy = false;
  function showMoment(text: string): void {
    moments.push(text);
    if (momentBusy) return;
    const next = () => {
      const m = moments.shift();
      if (!m) {
        momentBusy = false;
        moment.hidden = true;
        return;
      }
      momentBusy = true;
      moment.textContent = tr(m);
      moment.hidden = false;
      window.setTimeout(next, 3400);
    };
    next();
  }

  /** 案内の帯のヒント（いま関係する、まだ見ていない一つ。一覧もめくれる）。 */
  function renderGuide(): void {
    hintBox.replaceChildren();
    if (browse !== null) {
      const i = browse;
      const hnt = HINTS[i];
      if (!hnt) return;
      fill(hintBox, [
        h('b', {}, `${hnt.title}（${i + 1}/${HINTS.length}）`),
        h('span', {}, hnt.text),
        h(
          'span',
          { class: 'dig-guide__nav' },
          button(
            '‹',
            () => {
              browse = (i - 1 + HINTS.length) % HINTS.length;
              renderGuide();
            },
            { 'aria-label': '前の案内' },
          ),
          button(
            '›',
            () => {
              browse = (i + 1) % HINTS.length;
              renderGuide();
            },
            { 'aria-label': '次の案内' },
          ),
          button('閉じる', () => {
            browse = null;
            renderGuide();
            renderBar();
          }),
        ),
      ]);
      return;
    }
    const w = game?.world;
    const hnt = w && screen === 'play' ? nextHint(w, profile.hints) : null;
    hintShown = hnt?.id ?? null;
    fill(hintBox, [
      hnt ? h('b', {}, hnt.title) : null,
      hnt ? h('span', {}, hnt.text) : null,
      hnt
        ? h(
            'span',
            { class: 'dig-guide__nav' },
            button('わかった', () => seeHint(hnt.id)),
          )
        : null,
    ]);
  }

  /** 案内を一覧でめくる（上の帯の「案内」から）。 */
  function toggleGuide(): void {
    browse = browse === null ? 0 : null;
    renderGuide();
    renderBar();
  }

  function seeHint(id: string): void {
    if (!profile.hints.includes(id)) profile.hints.push(id);
    saveProfile(profile);
    renderGuide();
  }

  function finishRun(w: World): void {
    saveRun(null);
    const e = w.ending;
    if (!e) return;
    bestBefore = profile.best;
    profile.runs++;
    if (e.won) {
      profile.wins++;
      profile.depth = Math.max(profile.depth, Math.min(8, w.depth + 1));
    }
    profile.best = Math.max(profile.best, e.score);
    for (const [npc, m] of Object.entries(w.minds))
      if (m.met > 0)
        profile.remembered[npc] = {
          violent: m.violent,
          kind: m.kind,
          nosy: m.nosy,
          grudge: m.grudge,
          trust: m.trust,
        };
    profile.found = [...new Set([...profile.found, ...w.found])];
    for (const c of w.you.cards)
      if (c && (c.marks.ch ?? 0) >= 3 && !profile.legends.includes(c.id))
        profile.legends.push(c.id);
    profile.carry = w.you.perms.find((p) => p !== 'promise' && !permDef(p)?.bad) ?? null;
    profile.goals = carryGoals(w);
    saveProfile(profile);
  }

  function begin(seed?: number): void {
    const daily = create.daily
      ? Number(new Date().toISOString().slice(0, 10).replaceAll('-', ''))
      : undefined;
    const s = seed ?? daily ?? Math.floor(Math.random() * 2 ** 31);
    const sheet: Sheet = {
      origin: create.origin,
      ep: create.ep,
      item: create.item,
      name: create.name.trim() || undefined,
    };
    hardSeen = 0;
    bestStreak = 0;
    game = Game.start(s, create.job, create.depth, {
      carry: profile.carry ?? undefined,
      goals: profile.goals,
      remembered: profile.remembered,
      sheet,
    });
    screen = 'play';
    log = [];
    advice = null;
    adviceAt = -1;
    react(game.events);
    saveRun(game.save());
    render();
  }

  // ─── 塔の見え方 ─────────────────────────────────────────────

  function towerView(w: World): TowerView {
    const you = youHardness(w);
    const rooms: RoomView[] = w.map.map((n) => {
      const hard = n.npc ? nodeHardness(w, n) : null;
      return {
        id: n.id,
        floor: n.row,
        col: n.col,
        cols: w.map.filter((m) => m.row === n.row && (m.tower ?? 0) === (n.tower ?? 0)).length,
        tower: n.tower ?? 0,
        kind: n.kind,
        person: !!n.npc,
        hard,
        over: hard !== null && outmatched(hard, you),
        visited: n.visited && n.id !== w.pos,
        reachable: false,
        eps: n.eps.length,
        stage: !!n.stage?.length,
        rivalWas: !!n.rival,
      };
    });
    const next = new Set(reachable(w).map((n) => n.id));
    for (const r of rooms) {
      r.reachable = next.has(r.id);
      // 細かい印（硬度・見せ場・エピテット）は、行ける部屋と、見ている部屋と、最後の相手だけ。
      const near = r.reachable || r.id === focus || r.id === pinned || r.kind === 'boss';
      if (!near) {
        r.hard = null;
        r.over = false;
        r.eps = 0;
        r.stage = false;
      }
    }
    const edges = w.map.flatMap((n) => n.next.map((m) => [n.id, m] as const));
    const routes = advice
      ? [...advice.win, ...advice.play].map((r) => ({
          kind: r.kind,
          path: r.path,
          mark:
            r.kind === 'almost' && r.hint
              ? r.path.find((id) => r.hint?.startsWith(nodeLabel(nodeOf(w, id) as MapNode)))
              : undefined,
        }))
      : [];
    const rv = w.rival;
    return {
      top: floorNo(w, 0),
      floors: ROWS + 1,
      rooms,
      edges,
      you: w.pos,
      rival:
        !rv.down && rv.stratum === w.stratum && rv.node !== null && w.enc?.foe.id !== 'rival'
          ? rv.node
          : null,
      routes: w.enc || w.pending ? [] : routes.filter((r) => r.kind === (routePeek ?? routeSel)),
      focus,
      enc:
        w.enc && w.enc.who === 'you' && w.pos !== null
          ? { room: w.pos, ...anim, scene: sceneOf(w) }
          : null,
    };
  }

  /** 向き合った場面の計器（体・心・守り・信頼・手がかり・予告）。 */
  function sceneOf(w: World): Scene | null {
    const e = w.enc;
    if (!e) return null;
    const s = stats(w, 'you');
    const f = e.foe;
    const i = shownIntent(w);
    return {
      you: {
        hp: w.you.hp,
        maxHp: maxHp(s),
        mind: w.you.mind,
        maxMind: maxMind(s),
        guard: e.guard,
        calm: e.calm,
      },
      loss: e.phase === 'act' ? incoming(w) : { hp: 0, mind: 0 },
      foe: {
        hp: f.hp,
        maxHp: f.maxHp,
        will: f.resolve,
        maxWill: f.maxResolve,
        trust: f.trust,
        need: f.need,
        guard: f.guard,
        hostility: f.hostility,
        clues: f.clues.length,
        shown: f.clues.filter((c) => c.shown && !c.false).length,
        boss: e.tier === 'boss',
      },
      intent: i && e.phase === 'act' ? { kind: i.kind, power: i.power ?? null } : null,
      stage: e.stage.length > 0,
      resonance: resonance(w).length,
      stall: e.turn > PACE.stall,
      pops,
    };
  }

  let last = performance.now();
  function frame(): void {
    const t = performance.now();
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    if (screen === 'create' || !game) tower.draw(EMPTY, now(), dt);
    else if (screen === 'play') {
      const w = game.world;
      if (!w.enc && !w.pending && !w.ending && adviceAt !== w.seq) {
        adviceAt = w.seq;
        advice = advise(w);
        render();
      }
      // 止め（ヒットストップ）のあいだは、絵を描き替えない。
      if (now() >= freezeUntil) tower.draw(heldView ?? towerView(staged ?? w), now(), dt);
      idle(w);
    }
    raf = requestAnimationFrame(frame);
  }

  /**
   * 手を止めているあいだの小さな文。向き合っているなら相手のつぶやき（手番に一度）、
   * 地図の上なら建物の小ネタ（ときどき）。記録には残らない。
   */
  let lastInput = now();
  let mutterTurn = -1;
  let idleAt = -99;
  function idle(w: World): void {
    const t = now();
    if (t - lastInput < 14 || caption.classList.contains('is-on')) return;
    const e = w.enc;
    if (e && e.who === 'you' && e.phase === 'act') {
      if (mutterTurn === e.turn) return;
      mutterTurn = e.turn;
      const text = pickBy(foeDef(e.foe.id).lines.mutter ?? [], `${e.foe.id}:${e.turn}:${w.seq}`);
      if (text) showCaption(`「${text}」`);
      return;
    }
    if (w.enc || w.pending || w.ending || t - idleAt < 32 || t - lastInput < 22) return;
    idleAt = t;
    const use = nodeOf(w, w.pos)?.use;
    const pool = IDLE.filter(
      (x) =>
        (!x.section || x.section === sectionNo(w.stratum)) &&
        (!x.use || (!!use && x.use.includes(use))),
    );
    const text = pool[Math.floor(Math.random() * pool.length)]?.text;
    if (text) showCaption(text);
  }
  raf = requestAnimationFrame(frame);

  canvas.addEventListener('pointermove', (ev) => {
    const id = tower.pick(ev.clientX, ev.clientY);
    showTip(id, ev.clientX, ev.clientY);
    if (id !== focus) {
      focus = id;
      render();
    }
  });
  canvas.addEventListener('pointerleave', () => {
    focus = null;
    render();
  });
  /** 見渡す（引く）／近景に戻す。ホイールの向きでも切り替わる。 */
  function setOverview(on: boolean): void {
    tower.overview = on;
    zoomIn.disabled = !on;
    zoomOut.disabled = on;
  }
  zoomIn.addEventListener('click', () => setOverview(false));
  zoomOut.addEventListener('click', () => setOverview(true));
  setOverview(false);
  canvas.addEventListener(
    'wheel',
    (ev) => {
      if (Math.abs(ev.deltaY) < 4 || game?.world.enc) return;
      ev.preventDefault();
      setOverview(ev.deltaY > 0);
    },
    { passive: false },
  );

  canvas.addEventListener('click', (ev) => {
    const id = tower.pick(ev.clientX, ev.clientY);
    if (id === null || !game) return;
    // エピテットを選んでいるなら、先の部屋に刻む。
    if (aim?.kind === 'inscribe') {
      const n = nodeOf(game.world, id);
      if (n && nodeInkable(game.world, aim.ep, n)) {
        const ep = aim.ep;
        aim = null;
        send({ c: 'inscribe', ep, node: id });
        return;
      }
    }
    if (reachable(game.world).some((n) => n.id === id)) {
      sound.click();
      send({ c: 'move', node: id });
    } else {
      pinned = pinned === id ? null : id;
      render();
    }
  });

  /** そこへの行き方（廊下・渡り廊下・階段）と、かかる時間。どの画面でも同じ言い方で。 */
  function way(w: World, n: MapNode): { name: string; verb: string; hours: number } {
    const place = n.eps.reduce((a, e) => a + (epithetDef(e)?.place?.time ?? 0), 0);
    if (w.pos !== null && isBridge(w, n)) {
      const to = n.tower ? sectionOf(w.stratum).wing.name : '本棟';
      return { name: '渡り廊下', verb: `渡り廊下で${to}へ`, hours: Math.max(0, 2 + place) };
    }
    if (isHall(w, n)) return { name: '廊下', verb: '廊下を歩く', hours: Math.max(0, 1 + place) };
    return { name: '階段', verb: '下りる', hours: Math.max(0, 1 + place) };
  }

  /** 部屋に触れたときの小さな札（名前・人物・硬度・かかる時間）。 */
  function showTip(id: number | null, x: number, y: number): void {
    const w = game?.world;
    const n = w && id !== null ? nodeOf(w, id) : undefined;
    if (!w || !n || screen !== 'play') {
      tip.hidden = true;
      return;
    }
    const hard = n.npc ? nodeHardness(w, n) : null;
    const over = hard !== null && outmatched(hard, youHardness(w));
    const can = reachable(w).some((m) => m.id === n.id);
    tip.replaceChildren();
    fill(tip, [
      h('span', {}, ...placeOf(w, n)),
      h(
        'span',
        {},
        whoOf(n),
        hard !== null ? '　' : '',
        hard !== null ? hardTag(hard, youHardness(w)) : null,
        over ? h('span', { class: 'dig-warn' }, ' 歯が立たない') : null,
      ),
      aim?.kind === 'inscribe' && nodeInkable(w, aim.ep, n)
        ? h(
            'span',
            { class: 'dig-amber' },
            `押すと刻む：${(n.npc ? epithetDef(aim.ep)?.foe : epithetDef(aim.ep)?.place)?.text ?? ''}`,
          )
        : can
          ? h('span', { class: 'dig-amber' }, `押すと${way(w, n).verb}（${way(w, n).hours} 時間）`)
          : null,
    ]);
    const r = view.getBoundingClientRect();
    tip.style.left = `${Math.min(r.width - 200, x - r.left + 14)}px`;
    tip.style.top = `${Math.max(0, y - r.top - 10)}px`;
    tip.hidden = false;
  }

  /** キーボードで、行ける部屋を選ぶ（← →）。 */
  function cycle(dir: 1 | -1): void {
    if (!game) return;
    const list = reachable(game.world).sort((a, b) => a.col - b.col);
    if (!list.length) return;
    const i = list.findIndex((n) => n.id === focus);
    const next = list[(i + dir + list.length) % list.length];
    focus = next ? next.id : null;
    render();
  }

  // ─── 上帯 ───────────────────────────────────────────────────

  function renderBar(): void {
    bar.replaceChildren();
    const items: Child[] = [h('span', { class: 'dig-logo' }, 'DIG')];
    if (game && screen === 'play') {
      const w = staged ?? game.world;
      const s = stats(w, 'you');
      const row = nodeOf(w, w.pos)?.row ?? -1;
      const hard = youHardness(w);
      items.push(
        h('span', { class: 'dig-where' }, ...placeOf(w, row >= 0 ? nodeOf(w, w.pos) : undefined)),
        sectionGauge(w, row),
        // 時刻と、いまが夜か朝か（数えなくていい。夜は、また来る）。
        h(
          'span',
          { class: `dig-clock is-${phaseOf(w.hour)}` },
          `${PHASE_NAME[phaseOf(w.hour)]} ${clock(w.hour)}`,
        ),
        // 触れると、具合を言葉で（数ではなく）。
        titled(
          meter(w.you.hp, maxHp(s), `hp${now() - healAt < 1.2 ? ' is-healed' : ''}`, '体力', {
            shield: w.enc?.guard,
            loss: w.enc?.phase === 'act' ? incoming(w).hp : 0,
          }),
          VITALS.body[band(w.you.hp / maxHp(s))],
        ),
        titled(
          meter(w.you.mind, maxMind(s), `mind${now() - healAt < 1.2 ? ' is-healed' : ''}`, '精神', {
            shield: w.enc?.calm,
            loss: w.enc?.phase === 'act' ? incoming(w).mind : 0,
          }),
          VITALS.mind[band(w.you.mind / maxMind(s))],
        ),
        h(
          'span',
          { class: `dig-coins${now() - coinGain.at < 1.4 ? ' is-up' : ''}` },
          `金 ${w.you.coins}`,
          now() - coinGain.at < 1.4 ? h('i', { class: 'dig-coins__up' }, `+${coinGain.n}`) : null,
        ),
        now() - hardAt < 2.5 ? h('span', { class: 'is-risen' }, hardTag(hard)) : hardTag(hard),
        w.you.titles.length
          ? h(
              'span',
              { class: 'dig-titles' },
              w.you.titles.map((id) => `《${epithetDef(id)?.name ?? id}》`).join(''),
            )
          : null,
      );
    }
    items.push(
      h('span', { class: 'dig-bar__end' }),
      button('？', toggleGuide, {
        'aria-pressed': browse !== null ? 'true' : 'false',
        class: `dig-icon${browse !== null ? ' is-chosen' : ''}`,
        'aria-label': '案内',
        title: '案内',
      }),
      button(
        '♪',
        () => {
          sound.muted = !sound.muted;
          profile.muted = sound.muted;
          saveProfile(profile);
          renderBar();
        },
        {
          class: `dig-icon${sound.muted ? ' is-muted' : ''}`,
          'aria-pressed': sound.muted ? 'false' : 'true',
          'aria-label': sound.muted ? '音を出す' : '音を消す',
          title: sound.muted ? '音を出す' : '音を消す',
        },
      ),
      button(
        getLang() === 'en' ? 'JA' : 'EN',
        () => {
          const next = getLang() === 'en' ? 'ja' : 'en';
          profile.lang = next;
          saveProfile(profile);
          void setLang(next).then(() => {
            dialog.lang = next;
            renderBar();
            render();
          });
        },
        {
          class: 'dig-icon',
          lang: getLang() === 'en' ? 'ja' : 'en',
          'aria-label': getLang() === 'en' ? '日本語' : 'English',
          title: getLang() === 'en' ? '日本語' : 'English',
        },
      ),
      button('×', close, { class: 'dig-icon', 'aria-label': '閉じる', title: '閉じる' }),
    );
    fill(bar, items);
  }

  // ─── 脇 ─────────────────────────────────────────────────────

  function renderSide(): void {
    side.replaceChildren();
    if (!game) return;
    const sw = staged ?? game.world;
    renderPanel(sw);
    const goals = goalsPanel(sw);
    if (goals) fill(side, [goals]);
    // 出来事の記録は、どの画面でも同じ場所に畳んでおく（開けば読める）。
    if (log.length)
      fill(side, [
        h(
          'details',
          { class: 'dig-log' },
          h('summary', {}, `記録（${log.length}）`),
          h(
            'ol',
            {},
            log
              .slice(-12)
              .reverse()
              .map((l) => h('li', {}, l)),
          ),
        ),
      ]);
  }

  function renderPanel(w: World): void {
    if (w.ending) {
      fill(side, [endPanel(w)]);
      return;
    }
    if (w.enc) {
      fill(side, [encounterPanel(w)]);
      return;
    }
    const p = w.pending;
    if (p?.kind === 'story') {
      fill(side, [storyPanel(w)]);
      return;
    }
    if (p?.kind === 'told') {
      fill(side, [toldPanel(w)]);
      return;
    }
    if (p?.kind === 'reward') {
      fill(side, [rewardPanel(w)]);
      return;
    }
    if (p?.kind === 'rest') {
      fill(side, [restPanel(w)]);
      return;
    }
    if (p?.kind === 'summit') {
      fill(side, [summitPanel(w)]);
      return;
    }
    if (p?.kind === 'shop') {
      fill(side, [shopPanel(w)]);
      return;
    }
    fill(side, [mapPanel(w)]);
  }

  /** 目標（小・中・大）。遭遇のあいだは出さない（いまの相手に目を向けるように）。 */
  function goalsPanel(w: World): HTMLElement | null {
    if (w.enc || w.ending || !w.goals.length) return null;
    const SIZE: Record<GoalSize, string> = {
      S: '小さな目標',
      M: '中くらいの目標',
      L: '大きな目標',
    };
    const rows = (['L', 'M', 'S'] as const)
      .map((size) => w.goals.find((g) => g.size === size))
      .filter((g): g is Goal => !!g)
      .map((g) => {
        const got = Math.max(0, Math.min(g.need, goalMetric(w, g.kind) - g.base));
        const fresh = goalAt.size === g.size && now() - goalAt.t < 2.4;
        return h(
          'li',
          {
            class: `dig-goal dig-goal--${g.size}${fresh ? ' is-fresh' : ''}`,
            title: `届くと：${REWARD_TEXT[g.size]}`,
          },
          // 大きさは字ではなく、印の大きさで（上から大・中・小）。
          h('i', { class: 'dig-goal__size', role: 'img', 'aria-label': SIZE[g.size] }),
          h('span', { class: 'dig-goal__text' }, goalText(g)),
          h(
            'span',
            { class: 'dig-goal__bar', role: 'img', 'aria-label': `${got}/${g.need}` },
            h('i', { style: `width:${Math.round((got / g.need) * 100)}%` }),
          ),
        );
      });
    return h('section', { class: 'dig-sec dig-goals' }, h('h3', {}, '目標'), h('ol', {}, rows));
  }

  const section = (title: string, ...kids: (Child | readonly Child[])[]) =>
    h('section', { class: 'dig-sec' }, h('h3', {}, title), ...kids);

  function roomInfo(w: World, n: MapNode): HTMLElement {
    const you = youHardness(w);
    const hard = n.npc ? nodeHardness(w, n) : null;
    const def = n.npc ? foeDef(n.npc) : null;
    return h(
      'div',
      { class: 'dig-room' },
      h('p', { class: 'dig-place' }, ...placeOf(w, n)),
      h(
        'p',
        { class: 'dig-room__name' },
        whoOf(n),
        hard !== null ? '　' : '',
        hard !== null ? hardTag(hard, you) : null,
      ),
      n.tower
        ? h(
            'p',
            { class: 'dig-quiet' },
            `${sectionOf(w.stratum).wing.name}の部屋。本棟では会わない顔と、珍しい棚。`,
          )
        : null,
      h('p', { class: 'dig-quiet' }, `${way(w, n).name}で ${way(w, n).hours} 時間`),
      def ? h('p', { class: 'dig-quiet' }, def.desc) : null,
      hard !== null && outmatched(hard, you)
        ? h(
            'p',
            { class: 'dig-warn' },
            `正面からは歯が立たない（あなたは硬度 ${you}）。退いて、出直せる。`,
          )
        : null,
      n.stage?.length
        ? h(
            'p',
            { class: 'dig-amber' },
            `見せ場［${n.stage.map((t) => TAG_NAME[t]).join('・')}］── 合うカードが強く、相手も手強い`,
          )
        : null,
      ...n.eps.map((e) => {
        const d = epithetDef(e);
        const facet = n.npc ? d?.foe?.text : d?.place?.text;
        return h(
          'p',
          { class: 'dig-ep' },
          `《${d?.name ?? e}》`,
          facet ? ` ${facet}` : '',
          d ? h('span', { class: 'dig-quiet' }, ` ${d.gloss}`) : null,
        );
      }),
      n.rival
        ? h(
            'p',
            { class: 'dig-quiet' },
            `もう一人が先に寄った（${OUTCOME_NAME[n.rival as keyof typeof OUTCOME_NAME] ?? n.rival}）`,
          )
        : null,
    );
  }

  function mapPanel(w: World): HTMLElement {
    const next = reachable(w);
    const sel = pinned !== null ? nodeOf(w, pinned) : undefined;
    const kids: (Child | readonly Child[])[] = [];
    if (sel) {
      const can = next.some((n) => n.id === sel.id);
      kids.push(
        section(
          '部屋',
          roomInfo(w, sel),
          can
            ? button(`${way(w, sel).verb}`, () => send({ c: 'move', node: sel.id }), {
                class: 'dig-go',
              })
            : null,
          button('閉じる', () => {
            pinned = null;
            render();
          }),
        ),
      );
    } else if (!advice)
      // 道の読みが出ているあいだは、部屋の一覧は出さない（見取り図と道の読みで足りる）。
      kids.push(
        section(
          '行ける部屋',
          next.map((n) => {
            const hard = n.npc ? nodeHardness(w, n) : null;
            return h(
              'button',
              { type: 'button', onclick: () => send({ c: 'move', node: n.id }) },
              `${way(w, n).name} → ${whoOf(n)}`,
              hard !== null ? '　' : '',
              hard !== null ? hardTag(hard, youHardness(w)) : null,
              n.stage?.length ? '　見せ場' : '',
            );
          }),
        ),
      );
    if (advice) {
      const all = [...advice.win, ...advice.play];
      const short: Record<RouteKind, string> = {
        safe: '安定',
        chain: '高連鎖',
        almost: 'あと一つ',
      };
      const metric = (r: (typeof all)[number]) =>
        r.kind === 'safe'
          ? r.survive < 0.95
            ? `抜ける ${Math.round(r.survive * 100)}%`
            : `体力 ${Math.round(r.hpEnd * 100)}% で着く`
          : r.kind === 'chain'
            ? `噛み合い ${r.links.length}`
            : '';
      const chosen = all.find((r) => r.kind === routeSel);
      kids.push(
        section(
          '道の読み',
          h(
            'div',
            { class: 'dig-chips' },
            all.map((r) =>
              h(
                'button',
                {
                  type: 'button',
                  class: `dig-chip dig-chip--${r.kind}${routeSel === r.kind ? ' is-on' : ''}`,
                  'aria-pressed': routeSel === r.kind ? 'true' : 'false',
                  title: `${r.aim === 'win' ? '勝つ道' : '面白い道'}：${r.label}`,
                  onclick: () => {
                    routeSel = routeSel === r.kind ? null : r.kind;
                    render();
                  },
                  onmouseenter: () => {
                    routePeek = r.kind;
                  },
                  onmouseleave: () => {
                    routePeek = null;
                  },
                },
                h('b', {}, short[r.kind]),
                h('span', {}, metric(r)),
                firstStep(w, r.path[0]),
              ),
            ),
          ),
          chosen
            ? h(
                'div',
                { class: `dig-route dig-route--${chosen.kind}` },
                h('p', {}, chosen.text),
                chosen.warn.length ? h('p', { class: 'dig-warn' }, chosen.warn.join('。')) : null,
                chosen.hint ? h('p', { class: 'dig-amber' }, chosen.hint) : null,
                chosen.path[0] !== undefined
                  ? button(
                      stepLabel(w, chosen.path[0]),
                      () => send({ c: 'move', node: chosen.path[0] as number }),
                      { class: 'dig-go' },
                    )
                  : null,
              )
            : null,
        ),
      );
    }
    kids.push(
      section(
        'その場で',
        h(
          'div',
          { class: 'dig-row' },
          act('一服', '全ての札の回数 +1・1 時間（この階で一度）', () => send({ c: 'breather' }), {
            disabled: breathed(w),
            title: '少しだけ体と心が戻る。1 時間たつ。',
          }),
          // 抜けたあとは、いつでもここで灯りを置ける（どこまで下りたかを持ち帰る）。
          w.flags.cleared
            ? act(
                '灯りを置く',
                `B${floorNo(w, Math.max(0, nodeOf(w, w.pos)?.row ?? 0))}までを持ち帰る`,
                () => send({ c: 'onward', go: false }),
              )
            : null,
          w.you.items.map((id, i) =>
            act(
              itemDef(id)?.name ?? id,
              itemDef(id)?.text ?? '',
              () => send({ c: 'item', index: i }),
              {
                title: itemDef(id)?.text,
              },
            ),
          ),
        ),
      ),
    );
    return h('div', {}, ...kids);
  }

  /**
   * 噛み合いの見える化。連鎖（続け打ち）と共鳴（構成の灯り）を、いつも同じ場所に
   * 四角の列で出す。次に何が起きるかを一言で。
   */
  function flowRows(w: World): HTMLElement {
    const srcs = resonance(w);
    const n = srcs.length;
    const step = RES_STEPS.find(([k]) => k > n);
    const fresh = now() - litAt < 1.2;
    return h(
      'p',
      { class: 'dig-flow' },
      h(
        'span',
        {
          class: `dig-flow__g${n ? ' is-on' : ''}`,
          title: [
            '共鳴：札・記憶・構成・エピテットが働くたびに一つ灯り、決着で受け取る',
            ...RES_STEPS.map(([k, v]) => `${k}　${v}`),
            n
              ? `灯っている：${srcs
                  .map((x) => sourceLabel(x) ?? '')
                  .filter(Boolean)
                  .join('・')}`
              : '',
          ]
            .filter(Boolean)
            .join('\n'),
        },
        h('b', {}, '共鳴'),
        pipRow(Math.min(n, 6), 6, 'res', fresh),
        step ? h('span', { class: 'dig-flow__x' }, `→ ${step[1]}`) : null,
      ),
    );
  }

  /**
   * いまこの札を使ったら、何がいくつ動くか（世界の写しで実際に使ってみた数）。
   * その下に、効き目一つ一つに足される点の内訳（連鎖・見せ場・弱いタグ…）。
   */
  function outcome(w: World, slot: number, c: Card): HTMLElement {
    const x = cardEffect(w, slot);
    const b = bonusOf(w, c);
    const chip = (text: string, cls = '') => h('i', { class: `dig-out${cls}` }, text);
    const sign = (n: number) => (n > 0 ? `+${n}` : `−${-n}`);
    const list: HTMLElement[] = [];
    // この一手で決着がつくなら、それがいちばん先（倒せる・折れる・打ち解ける・暴ける）。
    const END: Record<string, string> = {
      beaten: '倒せる',
      broken: '折れる',
      trusted: '打ち解ける',
      uncovered: '暴ける',
    };
    if (x.ends && END[x.ends]) list.push(chip(END[x.ends] ?? '', ' is-end'));
    if (x.hp) list.push(chip(`体力 ${sign(x.hp)}`));
    if (x.resolve) list.push(chip(`意志 ${sign(x.resolve)}`));
    if (x.trust) list.push(chip(`信頼 ${sign(x.trust)}`, ' is-blue'));
    if (x.clues) list.push(chip(`手がかり +${x.clues}`, ' is-blue'));
    if (x.guard) list.push(chip(`守り +${x.guard}`, ' is-you'));
    if (x.calm) list.push(chip(`構え +${x.calm}`, ' is-you'));
    if (x.youHp)
      list.push(chip(`あなたの体力 ${sign(x.youHp)}`, x.youHp > 0 ? ' is-heal' : ' is-cost'));
    if (x.youMind)
      list.push(chip(`あなたの精神 ${sign(x.youMind)}`, x.youMind > 0 ? ' is-heal' : ' is-cost'));
    return h(
      'span',
      { class: 'dig-card__out' },
      h('span', { class: 'dig-outs' }, list.length ? list : chip('動かない', ' is-none')),
      // 点が足されるのは体力・意志・信頼を動かす札だけ（守るだけの札には出さない）。
      b.parts.length && (x.hp || x.resolve || x.trust)
        ? h(
            'span',
            { class: 'dig-why' },
            b.parts.map((p) =>
              h(
                'i',
                {
                  class: `dig-why__p${p.text.startsWith('連鎖') ? ' is-chain' : ''}${p.n < 0 ? ' is-minus' : ''}`,
                },
                p.text,
              ),
            ),
          )
        : null,
    );
  }

  /** エピテットの効き方を、刻む先ごとに（札・人・場所・出来事・記憶）。 */
  function facetLines(ep: string): string {
    const d = epithetDef(ep);
    if (!d) return '';
    return [
      d.gloss,
      d.card ? `札：${d.card.text}` : '',
      d.foe ? `人：${d.foe.text}` : '',
      d.place ? `場所：${d.place.text}` : '',
      d.story ? `出来事：${d.story.text}` : '',
      d.memory ? `記憶：${d.memory.text}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  /** その部屋に、そのエピテットを刻めるか（先の部屋、二つまで）。 */
  function nodeInkable(w: World, ep: string, n: MapNode): boolean {
    const d = epithetDef(ep);
    const here = nodeOf(w, w.pos)?.row ?? -1;
    return (
      !w.enc &&
      !w.pending &&
      !n.visited &&
      n.row > here &&
      !!(n.npc ? d?.foe : d?.place) &&
      n.eps.length < 2 &&
      !n.eps.includes(ep)
    );
  }

  /** 拾い物の印（運がよかったぶん。失うものはない、という合図）。 */
  const luckyTag = () =>
    h(
      'i',
      { class: 'dig-lucky', title: '拾い物：運がよかったぶん。選んでも、何も失わない' },
      '拾い物',
    );

  /** 札の目当ての印（読まずに分かる）。癒すは緑。 */
  /**
   * 札の目当ての印（読まずに分かる）。癒すは緑。遭遇の最中は、覚えておかなくて
   * いいように、いま効く条件も印にする：直前の札とタグが重なれば「連鎖」、
   * 見せ場のタグに合えば「見せ場」（どちらも強くなる）。
   */
  function badges(
    list: readonly Fx[],
    tags: readonly Tag[] | null = null,
    w?: World,
  ): HTMLElement | null {
    const bs = badgesOf(list);
    const e = w?.enc;
    const n = tags && w ? chainNext(w, tags) : 0;
    const chain = n > 0;
    const stage = !!tags && !!e && e.stage.some((t) => tags.includes(t));
    if (!bs.length && !chain && !stage) return null;
    return h(
      'span',
      { class: 'dig-badges' },
      chain ? h('i', { class: 'dig-badge dig-badge--boost dig-badge--chain' }, '連鎖') : null,
      stage ? h('i', { class: 'dig-badge dig-badge--boost' }, '見せ場') : null,
      bs.map((b) => h('i', { class: `dig-badge dig-badge--${b}` }, BADGE_NAME[b])),
    );
  }

  /** 文の中の「体力 +n」「精神 +n」（戻る分）を緑に。 */
  function heals(text: string): Child[] {
    const parts = text.split(/((?:体力|精神) \+[0-9A-Za-z+.×]+)/);
    return parts.map((p, i) => (i % 2 ? h('span', { class: 'dig-heal' }, p) : p));
  }

  /** 名前と、押すと何が起きるか（一行）の二段の釦。結果が読める選択肢はこれでそろえる。 */
  function act(
    name: string,
    effect: string,
    on: () => void,
    attrs: Record<string, string | boolean | undefined | ((ev: Event) => void)> = {},
  ): HTMLButtonElement {
    return h(
      'button',
      { type: 'button', ...attrs, class: `dig-act ${attrs.class ?? ''}`.trim(), onclick: on },
      h('span', { class: 'dig-act__name' }, name),
      effect ? h('span', { class: 'dig-act__fx' }, ...heals(effect)) : null,
    );
  }

  /**
   * 底の手前を抜けた。ここが挑戦の山場：抜けたことはもう決まっていて、あとは
   * 灯りを置くか、構成がどこまで持つか、さらに下りて確かめるか。
   */
  function summitPanel(w: World): HTMLElement {
    const p = w.pending;
    if (p?.kind !== 'summit') return h('div');
    const next = w.stratum + 1;
    const deep = w.stratum > 3;
    return h(
      'div',
      { class: 'dig-summit' },
      h(
        'div',
        { class: 'dig-result' },
        h('b', { class: 'dig-result__stamp is-in' }, deep ? `B${floorNo(w, 8)}` : '抜けた'),
        h('span', { class: 'dig-result__who' }, OUTCOME_NAME[p.outcome]),
      ),
      act(
        '灯りを置く',
        deep ? 'ここまでを持ち帰る' : '挑戦を終える',
        () => send({ c: 'onward', go: false }),
        {
          class: 'dig-go',
        },
      ),
      act('さらに下りる', `${stratumName(next)}・掟は重なり、相手は一段手強い`, () =>
        send({ c: 'onward', go: true }),
      ),
    );
  }

  /** その道の最初の一歩（行き方と、そこにいる人・ある物）。 */
  function stepLabel(w: World, id: number): string {
    const n = nodeOf(w, id);
    if (!n) return '進む';
    const hard = n.npc ? nodeHardness(w, n) : null;
    return `${way(w, n).verb}：${whoOf(n)}${hard !== null ? `　硬度 ${hard}` : ''}`;
  }

  function firstStep(w: World, id: number | undefined): HTMLElement | null {
    if (id === undefined) return null;
    const n = nodeOf(w, id);
    if (!n) return null;
    return h('span', { class: 'dig-chip__step' }, `${way(w, n).name} → ${whoOf(n)}`);
  }

  function lackText(l: { tag?: string; arch?: string; perm?: string; card?: string }): string {
    if (l.tag) return `［${TAG_NAME[l.tag as keyof typeof TAG_NAME]}］が 1 つ`;
    if (l.arch) return `〈${ARCH_NAME[l.arch as Archetype]}〉が 1 つ`;
    if (l.perm) return `記憶《${permDef(l.perm)?.name ?? l.perm}》`;
    if (l.card) return `『${cardDef(l.card).name}』`;
    return '何か';
  }

  /**
   * 一つの手番を二行に。相手の手（act）より前があなたの番、後が相手の番。
   * 何をして、相手の四つの道（とあなた）がどう動いたか。
   */
  function summarize(cmd: Cmd, evs: readonly Ev[], theirMove?: string): TurnLine[] {
    const mine: string[] = [];
    const theirs: string[] = [];
    let what = cmd.c === 'act' ? BASIC_NAME[cmd.a] : '';
    let side = mine;
    let end: string | null = null;
    let chained = 0;
    const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);
    for (const ev of evs) {
      if (ev.type === 'card.use' && ev.who === 'you') what = `『${cardDef(ev.card).name}』`;
      else if (ev.type === 'enc.st' && ev.key === 'chain' && ev.n > 0 && side === mine)
        chained = streak + ev.n;
      else if (ev.type === 'act') side = theirs;
      else if (ev.type === 'turn') break;
      else if (ev.type === 'enc.end') end = OUTCOME_NAME[ev.outcome];
      else if (ev.type === 'foe' && ev.n) {
        const name = {
          hp: '体力',
          resolve: '意志',
          trust: '信頼',
          guard: '守り',
          hostility: '敵意',
        }[ev.field as 'hp'];
        if (name) side.push(`${side === mine ? '相手の' : ''}${name} ${sign(ev.n)}`);
      } else if (ev.type === 'clue' && ev.shown && !ev.false) side.push('手がかり +1');
      else if (ev.type === 'vital' && ev.who === 'you') {
        if (ev.hp) side.push(`体力 ${sign(ev.hp)}`);
        if (ev.mind) side.push(`精神 ${sign(ev.mind)}`);
      } else if (ev.type === 'enc.you' && ev.n > 0)
        side.push(`${ev.field === 'guard' ? '守り' : '構え'} +${ev.n}`);
    }
    if (chained) what += chained >= 2 ? `　連鎖 ${chained}` : '　連鎖';
    const out: TurnLine[] = [{ who: 'you', what: what || '……', effects: mine }];
    if (end) out.push({ who: 'end', what: end, effects: [] });
    else if (theirs.length || theirMove)
      out.push({ who: 'foe', what: theirMove ?? '……', effects: theirs });
    return out;
  }

  function encounterPanel(w: World): HTMLElement {
    const e = w.enc;
    if (!e) return h('div');
    const f = e.foe;
    const def = foeDef(f.id);
    const hard = foeHardness(f);
    const you = youHardness(w);
    const intent = shownIntent(w);
    const shown = f.clues.filter((c) => c.shown && !c.false).length;
    // 触れている札の効き目（相手の番の前まで）。四つの道の棒の先に、点滅で映す。
    const eff =
      e.phase !== 'act'
        ? null
        : hoverSlot !== null && w.you.cards[hoverSlot]
          ? cardEffect(w, hoverSlot)
          : hoverAct
            ? effectOf(w, { c: 'act', a: hoverAct })
            : null;
    // 四つの決着の道。どれか一つを尽くせば終わる（これが遭遇の目当て）。
    const way = (verb: string, el: HTMLElement) =>
      h('div', { class: 'dig-way' }, h('span', { class: 'dig-way__verb' }, verb), el);
    const ways = [
      way(
        '倒す',
        meter(f.hp, f.maxHp, 'foe-hp', '体力', { shield: f.guard, loss: eff ? -eff.hp : 0 }),
      ),
      way(
        '折る',
        meter(f.resolve, f.maxResolve, 'foe-will', '意志', { loss: eff ? -eff.resolve : 0 }),
      ),
      f.need < 50
        ? way('打ち解ける', meter(f.trust, f.need, 'foe-trust', '信頼', { gain: eff?.trust ?? 0 }))
        : way('打ち解ける', h('span', { class: 'dig-quiet' }, '言葉は通じない')),
      f.clues.length
        ? way(
            '暴く',
            meter(shown, f.clues.length, 'foe-clue', '手がかり', { gain: eff?.clues ?? 0 }),
          )
        : null,
    ];
    const kids: (Child | readonly Child[])[] = [
      h('p', { class: 'dig-room__name', title: def.desc }, f.name, '　', hardTag(hard, you)),
      // 一巡：前の手番（あなた → 相手）と、相手の次の手。
      lastTurn.length
        ? h(
            'div',
            { class: 'dig-turn' },
            lastTurn.map((l) =>
              h(
                'p',
                { class: `dig-turn__line is-${l.who}` },
                h('b', {}, l.who === 'you' ? 'あなた' : l.who === 'foe' ? '相手' : '決着'),
                ' ',
                l.what,
                l.effects.length
                  ? h(
                      'span',
                      { class: 'dig-turn__fx' },
                      ' → ',
                      l.effects.flatMap((x, i) => [i ? '・' : '', ...heals(x)]),
                    )
                  : '',
              ),
            ),
          )
        : null,
      // 次の手。身ぶりの一文は、触れたときだけ。
      intent && e.phase === 'act'
        ? h(
            'p',
            {
              class: 'dig-intent',
              title: pickBy(POSTURE[intent.kind] ?? [], `${f.id}:${e.turn}`) ?? '',
            },
            h('span', { class: 'dig-intent__k' }, '次の手'),
            h('b', {}, intent.label),
            intent.power ? h('span', { class: 'dig-intent__n' }, String(intent.power)) : null,
          )
        : null,
      // 四つの道は、戦闘（倒す・折る）と交渉（打ち解ける・暴く）の二つに分かれる。
      h(
        'div',
        { class: 'dig-ways' },
        h('span', { class: 'dig-ways__k' }, '戦闘'),
        ways[0],
        ways[1],
        h('span', { class: 'dig-ways__k' }, '交渉'),
        ways[2],
        ways[3],
      ),
      e.phase === 'act' ? flowRows(w) : null,
      // 覚えておかなくていいものは出さない。敵意は荒れているときだけ（信頼が伸びにくく、
      // 手が重くなる）。見せ場のタグは札の印に出るので、ここでは名前だけ。
      h(
        'p',
        { class: 'dig-quiet dig-enc__aside' },
        f.hostility >= 7 ? h('span', { class: 'dig-warn' }, '荒れている') : '',
        e.stage.length ? `${f.hostility >= 7 ? '・' : ''}見せ場` : '',
        f.eps.length ? `・${f.eps.map((x) => `《${epithetDef(x)?.name ?? x}》`).join('')}` : '',
        // 区画の掟（名前だけ。中身は触れると）。
        lawsAt(w.stratum).map((l) =>
          h('span', { class: 'dig-law', title: l.text }, `掟《${l.name}》`),
        ),
      ),
    ];
    if (e.phase === 'over' && e.outcome) {
      // 結末は一巡の行（決着 倒した）に出ているので、ここは受け取る釦だけ。
      kids.push(button('決着を受け取る', () => send({ c: 'close' }), { class: 'dig-go' }));
    } else {
      // 札を使わない手（素手）。札が主役なので、小さく下に。
      const lc = leaveChance(w);
      const basics: Basic[] = ['press', 'brace', 'talk', 'leave'];
      if (canAccept(w)) basics.push('accept');
      kids.push(
        h(
          'div',
          { class: 'dig-bare' },
          h('span', { class: 'dig-bare__label' }, '素手で'),
          basics.map((a, i) =>
            button(
              `${BASIC_NAME[a]}${a === 'leave' ? ` ${lc}%` : ''}`,
              () => send({ c: 'act', a }),
              {
                class: 'dig-bare__act',
                title: `${BASIC_GLOSS[a]}（${'QWERT'[i]}）`,
                onmouseenter: () => {
                  if (hoverAct === a) return;
                  hoverAct = a;
                  renderSide();
                },
                onmouseleave: () => {
                  if (hoverAct !== a) return;
                  hoverAct = null;
                  renderSide();
                },
              },
            ),
          ),
        ),
      );
    }
    // 人となりの一文は、向き合った最初だけ（二手目からは名前に触れれば読める）。
    if (e.turn <= 1 && !lastTurn.length)
      kids.push(h('p', { class: 'dig-quiet dig-enc__desc' }, def.desc));
    return h('div', { class: 'dig-enc' }, ...kids);
  }

  function storyPanel(w: World): HTMLElement {
    const p = w.pending;
    if (p?.kind !== 'story') return h('div');
    const def = storyDef(p.id);
    if (!def) return h('div');
    return section(
      def.title,
      h('p', {}, def.text),
      p.eps.length
        ? h(
            'p',
            { class: 'dig-ep' },
            p.eps
              .map((e) => `《${epithetDef(e)?.name ?? e}》${epithetDef(e)?.story?.text ?? ''}`)
              .join(' '),
          )
        : null,
      // 手元のエピテットのうち、出来事に効くものは、この出来事に刻める（二つまで）。
      p.eps.length < 2
        ? h(
            'p',
            { class: 'dig-row dig-ink' },
            [...new Set(w.you.epithets)]
              .filter((ep) => !!epithetDef(ep)?.story && !p.eps.includes(ep))
              .map((ep) =>
                button(
                  `＋《${epithetDef(ep)?.name ?? ep}》 ${epithetDef(ep)?.story?.text ?? ''}`,
                  () => send({ c: 'inscribe', ep, story: true }),
                  {
                    class: 'dig-pill dig-pill--ep',
                    title: '刻むと、この出来事の判定と実りが変わる',
                  },
                ),
              ),
          )
        : null,
      def.options.map((o, i) =>
        button(
          `${o.label}${o.stat ? `（${o.stat} ${storyChance(w, o.stat, o.diff ?? 0)}%）` : ''}`,
          () => send({ c: 'choose', option: i }),
          { disabled: !canChoose(w, i) },
        ),
      ),
      // 拾い物：妙な選択肢が一つ増えている（選べば必ず何か得る。失うものはない）。
      p.odd
        ? h(
            'button',
            {
              type: 'button',
              class: 'dig-odd is-lucky',
              onclick: () => send({ c: 'choose', option: def.options.length }),
            },
            luckyTag(),
            '黙って、灯りを落として待つ',
          )
        : null,
    );
  }

  function toldPanel(w: World): HTMLElement {
    const p = w.pending;
    if (p?.kind !== 'told') return h('div');
    return section(
      storyDef(p.id)?.title ?? '',
      h('p', {}, p.text),
      p.chance !== undefined
        ? h('p', { class: 'dig-quiet' }, `判定 ${p.roll} / ${p.chance}%`)
        : null,
      button('先へ', () => send({ c: 'ack' }), { class: 'dig-go' }),
    );
  }

  function rewardPanel(w: World): HTMLElement {
    const p = w.pending;
    if (p?.kind !== 'reward') return h('div');
    // 決着の判と、受け取ったものを一つずつ（少しずつ遅れて現れ、音も一つずつ上がる）。
    const fresh = now() - spoils.at < 1 && !spoilsPlayed;
    const kids: (Child | readonly Child[])[] = [
      h(
        'div',
        { class: `dig-result dig-result--${p.outcome}` },
        h('span', { class: 'dig-result__who' }, foeDef(p.npc).name),
        h('b', { class: `dig-result__stamp${fresh ? ' is-in' : ''}` }, OUTCOME_NAME[p.outcome]),
      ),
      spoils.list.length
        ? h(
            'ul',
            { class: 'dig-spoils' },
            spoils.list.map((x, i) =>
              h(
                'li',
                {
                  class: `dig-spoil${fresh ? ' is-in' : ''}${/^(金|エピテット《|共鳴)/.test(x) ? ' is-key' : ''}`,
                  style: `animation-delay:${0.35 + i * 0.16}s`,
                },
                x,
              ),
            ),
          )
        : null,
    ];
    if (fresh && !spoilsPlayed) {
      spoilsPlayed = true;
      spoils.list.forEach((_, i) => {
        window.setTimeout(() => sound.resonate(i * 2), 350 + i * 160);
      });
    }
    if (p.take.length)
      kids.push(
        h('p', { class: 'dig-label' }, '持ち帰る記憶（一つ）'),
        p.take.map((id) =>
          button(
            `${reward.take === id ? '● ' : '○ '}${permDef(id)?.name ?? id}`,
            () => {
              reward.take = reward.take === id ? undefined : id;
              render();
            },
            { title: permDef(id)?.text },
          ),
        ),
      );
    if (p.help)
      kids.push(
        h('p', { class: 'dig-label', title: '頼ると借りができる' }, '頼って戻す札（一枚）'),
        w.you.cards.map((c, i) =>
          c && c.uses < c.max
            ? button(`${reward.help === i ? '● ' : '○ '}${cardName(c)}`, () => {
                reward.help = reward.help === i ? undefined : i;
                render();
              })
            : null,
        ),
      );
    if (p.cards.length)
      kids.push(
        h('p', { class: 'dig-label', title: '拾うと、そのまま決着を受け取る' }, '拾う札（一枚）'),
        [...p.cards, ...(p.lucky ? [p.lucky] : [])].map((id) =>
          cardOffer(
            id,
            () => pickCard(w, id),
            'pick',
            aim?.kind === 'pick' && aim.id === id,
            undefined,
            id === p.lucky,
          ),
        ),
      );
    kids.push(
      button(
        p.cards.length ? '拾わずに進む' : '受け取る',
        () => send({ c: 'claim', take: reward.take, help: reward.help }),
        { class: 'dig-go' },
      ),
    );
    return section('決着', ...kids);
  }

  /**
   * 選ぶ → 手元の札が白く（押せる）／灰色に（押せない）なる → 札を押して実行。
   * 同じ選択肢をもう一度押すと、やめる。拾う・買う・刻む・満たす・捨てる・
   * 変質させる、どれも同じ手順。
   */
  function choose(next: NonNullable<typeof aim>): void {
    hoverAim = null;
    aim = sameAim(aim, next) ? null : next;
    render();
  }

  function sameAim(a: typeof aim, b: typeof aim): boolean {
    return !!a && !!b && JSON.stringify(a) === JSON.stringify(b);
  }

  function pickCard(_w: World, id: string): void {
    choose({ kind: 'pick', id });
  }

  /** 拾う札・買う札。押すか、枠へ落とす。決める前に、構成がどう変わるかを一行で。 */
  function cardOffer(
    id: string,
    on: () => void,
    source: 'pick' | 'buy' | null = null,
    picked = false,
    price?: string,
    /** 拾い物（運がよかったぶんの、余分な一枚）。 */
    lucky = false,
  ): HTMLElement {
    const d = cardDef(id);
    const w = game?.world;
    const hint = w
      ? (() => {
          const slot = bestSlot(w.you, id);
          const after = withCard(w.you, slot, id);
          return sayDelta(delta(w.you, after), after);
        })()
      : '';
    return h(
      'button',
      {
        type: 'button',
        class: `dig-offer${picked ? ' is-chosen' : ''}${lucky ? ' is-lucky' : ''}`,
        'aria-pressed': picked ? 'true' : undefined,
        disabled: !source && !picked,
        onclick: on,
        draggable: source ? 'true' : undefined,
        ondragstart: (ev: Event) => {
          if (source) (ev as DragEvent).dataTransfer?.setData('text/plain', `${source}:${id}`);
        },
      },
      h(
        'span',
        { class: 'dig-offer__head' },
        lucky ? luckyTag() : null,
        h('b', {}, d.name),
        price ? h('span', { class: 'dig-price' }, price) : null,
      ),
      d.legend ? h('span', { class: 'dig-offer__lead' }, `主役『${d.legend}』`) : null,
      h(
        'span',
        { class: 'dig-quiet' },
        ` ${d.uses} 回 ［${d.tags.map((t) => TAG_NAME[t]).join('・')}］${(d.arch ?? []).map((a) => `〈${ARCH_NAME[a]}〉`).join('')}`,
      ),
      badges(d.ready),
      h('span', { class: 'dig-offer__fx' }, heals(fxText(d.ready))),
      d.sig ? h('span', { class: 'dig-offer__sig' }, d.sig) : null,
      hint ? h('span', { class: 'dig-offer__next' }, hint) : null,
    );
  }

  function restPanel(w: World): HTMLElement {
    const p = w.pending;
    if (p?.kind !== 'rest') return h('div');
    const kids: (Child | readonly Child[])[] = [];
    if (!p.used)
      kids.push(
        act(
          '休む',
          `体力 +${Math.round(PACE.rest * 100)}%・精神 +${Math.round(PACE.rest * 100)}%・全ての札の回数 +1・1 時間`,
          () => send({ c: 'rest', action: 'rest' }),
        ),
        act(
          'ひと晩ここで',
          '体力 +60%・精神 +60%・選んだ一枚の回数が満ちる・2 時間・次の出来事を逃す',
          () => choose({ kind: 'rest', action: 'full' }),
          chosen({ kind: 'rest', action: 'full' }),
        ),
        act(
          `考えを整える（INT ${restChance(w, 'tune-int')}%）`,
          '成功：［視線・公開情報・私的情報］の札の回数 +1／失敗：精神 −3',
          () => send({ c: 'rest', action: 'tune-int' }),
        ),
        act(
          `気を落ち着ける（WIL ${restChance(w, 'tune-wil')}%）`,
          '成功：［記憶・信頼・身体］の札の回数 +1／失敗：精神 −3',
          () => send({ c: 'rest', action: 'tune-wil' }),
        ),
        act(
          '一枚捨てる',
          '選んだ一枚を手放し、残りの札の回数がすべて満ちる',
          () => choose({ kind: 'rest', action: 'discard' }),
          chosen({ kind: 'rest', action: 'discard' }),
        ),
      );
    else kids.push(h('p', { class: 'dig-quiet' }, 'もう休んだ。'));
    // 気まぐれ：店主が賭けを持ちかけてくる（休んだあとでも、一度だけ）。
    if (p.bet)
      kids.push(
        act(
          '店主と賭ける',
          '負けのない賭け。表なら金 +10、裏ならコーヒーを一杯（精神 +5）',
          () => send({ c: 'rest', action: 'bet' }),
          { class: 'is-lucky' },
        ),
      );
    if (!p.altered)
      w.you.cards.forEach((c, slot) => {
        if (!c) return;
        for (const o of alterOptions(w.you, slot))
          kids.push(
            button(
              `『${cardDef(c.id).name}』→『${cardDef(o.to).name}』（${o.need}）`,
              () => choose({ kind: 'alter', slot, to: o.to }),
              {
                ...chosen({ kind: 'alter', slot, to: o.to }),
                disabled: !o.ready,
                title: fxText(cardDef(o.to).ready),
              },
            ),
          );
      });
    kids.push(button('出る', () => send({ c: 'depart' }), { class: 'dig-go' }));
    return section('食堂', ...kids);
  }

  function shopPanel(w: World): HTMLElement {
    const p = w.pending;
    if (p?.kind !== 'shop') return h('div');
    const kids: (Child | readonly Child[])[] = [];
    for (const id of p.cards) {
      const sold = p.sold.includes(id);
      // 拾い物：半値の掘り出し物（元の値段を添えて）。
      const full = cardPrice(w, id);
      const cost = p.bargain === id ? Math.ceil(full / 2) : full;
      kids.push(
        cardOffer(
          id,
          () => {
            if (!sold && w.you.coins >= cost) choose({ kind: 'buy', id });
          },
          sold || w.you.coins < cost ? null : 'buy',
          aim?.kind === 'buy' && aim.id === id,
          sold ? '売約' : p.bargain === id ? `金 ${cost}（${full}）` : `金 ${cost}`,
          p.bargain === id && !sold,
        ),
      );
    }
    for (const id of p.items) {
      const sold = p.sold.includes(id);
      const ep = id.startsWith('ep:') ? epithetDef(id.slice(3)) : undefined;
      const it = ep ? undefined : itemDef(id);
      const price = ep ? epPrice(w, id.slice(3)) : priceOf(w, it?.price ?? 99);
      kids.push(
        act(
          `${ep ? `エピテット《${ep.name}》` : it?.name}　金 ${price}${sold ? '（売約）' : ''}`,
          ep ? `札に貼ると：${ep.card?.text ?? ep.gloss}` : (it?.text ?? ''),
          () => send({ c: 'buy', id }),
          { disabled: sold || w.you.coins < price },
        ),
      );
    }
    for (const perm of w.you.perms) {
      const d = permDef(perm);
      if (!d) continue;
      if (d.bad)
        kids.push(
          button(`《${d.name}》を手放す（金 ${curePrice(w)}）`, () => send({ c: 'cure', perm })),
        );
      else if (perm !== 'promise' && permValue(w.you, perm) > 0)
        kids.push(
          button(`記憶《${d.name}》を売る（金 ${permValue(w.you, perm)}）`, () =>
            send({ c: 'sell', perm }),
          ),
        );
    }
    kids.push(button('出る', () => send({ c: 'depart' }), { class: 'dig-go' }));
    return section('古物商', ...kids);
  }

  // ─── 終わり ─────────────────────────────────────────────────

  function persona(w: World): string {
    const arch: Record<string, number> = {};
    for (const c of w.you.cards)
      for (const a of c ? (cardDef(c.id).arch ?? []) : []) arch[a] = (arch[a] ?? 0) + 1;
    const top = Object.entries(arch).sort((a, b) => b[1] - a[1])[0]?.[0] as Archetype | undefined;
    const outcomes: Record<string, number> = {};
    for (const m of Object.values(w.minds))
      for (const [k, v] of Object.entries(m.outcomes)) outcomes[k] = (outcomes[k] ?? 0) + (v ?? 0);
    const memory = w.you.perms.find((p) => p !== 'promise' && !permDef(p)?.bad);
    return [
      jobDef(w.you.job)?.name,
      top ? ARCH_NAME[top] : null,
      ...w.you.titles.map((id) => epithetDef(id)?.name),
      memory ? permDef(memory)?.name : null,
      `${outcomes.trusted ?? 0} 人と打ち解けた`,
      `${(outcomes.left ?? 0) + (outcomes.fled ?? 0)} 件 未解決`,
    ]
      .filter(Boolean)
      .join(' / ');
  }

  function otherJobs(w: World): string[] {
    const out: string[] = [];
    for (const j of allJobs()) {
      if (j.id === w.you.job) continue;
      const a = JOB_ARCH[j.id];
      const hit = misses(w).find((m) => m.lack.arch === a);
      if (hit) out.push(`${j.name}なら、${hit.name}が成立していた`);
    }
    return out.slice(0, 3);
  }

  const tally = (k: string, v: string) =>
    h('div', { class: 'dig-tally__item' }, h('dt', {}, k), h('dd', {}, v));

  /** 点の数え上げ（一度だけ。描き直しでは最後の値のまま）。 */
  let counted = '';
  function countUp(n: number, key: string): HTMLElement {
    const el = h('b', { class: 'dig-score__n' }, String(counted === key ? n : 0));
    if (counted === key) return el;
    counted = key;
    const t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / 1200);
      el.textContent = String(Math.round(n * (1 - (1 - k) ** 3)));
      if (k < 1) requestAnimationFrame(step);
      else {
        sound.ok();
        if (n > bestBefore && bestBefore > 0) sound.gain();
      }
    };
    requestAnimationFrame(step);
    return el;
  }

  function endPanel(w: World): HTMLElement {
    const e = w.ending;
    if (!e) return h('div');
    const near = misses(w).slice(0, 3);
    return section(
      e.title,
      h('p', { class: 'dig-persona' }, persona(w)),
      h('p', {}, e.text),
      // 点は数え上げて、記録を越えたら判を押す。挑戦の中身は四つの数で。
      h(
        'div',
        { class: 'dig-score' },
        countUp(e.score, `${w.seed}:${e.score}`),
        e.score > bestBefore && bestBefore > 0
          ? h('b', { class: 'dig-score__best' }, '新記録')
          : h('span', { class: 'dig-quiet' }, `最高 ${profile.best}`),
      ),
      h(
        'dl',
        { class: 'dig-tally' },
        tally('到達', `B${floorNo(w, Math.max(0, nodeOf(w, w.pos)?.row ?? 0))}`),
        tally(
          '決着',
          `${['beaten', 'broken', 'trusted', 'uncovered'].reduce((a, k) => a + (w.you.deeds[k] ?? 0), 0)} 人`,
        ),
        tally('目標', `${['S', 'M', 'L'].reduce((a, k) => a + (w.flags[`goal:${k}`] ?? 0), 0)} 個`),
        tally('最長の連鎖', bestStreak ? `${bestStreak}` : '―'),
      ),
      h('p', { class: 'dig-quiet' }, `挑戦 ${profile.runs}　踏破 ${profile.wins}`),
      near.length
        ? h(
            'p',
            {},
            '見つけていない噛み合わせ：',
            near.map((m) => `${m.name}（あと${lackText(m.lack)}）`).join('、'),
          )
        : null,
      otherJobs(w).map((t) => h('p', { class: 'dig-quiet' }, t)),
      button(
        'もう一度',
        () => {
          game = null;
          screen = 'create';
          render();
        },
        { class: 'dig-go' },
      ),
      button('同じ夜をもう一度', () => begin(w.seed)),
    );
  }

  // ─── 手元 ───────────────────────────────────────────────────

  function renderTray(): void {
    tray.replaceChildren();
    if (!game || screen !== 'play') return;
    const w = staged ?? game.world;
    const builds = buildsOf(w.you);
    const slots = w.you.cards.map((c, slot) => {
      const onClick = () => clickSlot(w, slot);
      const drop = {
        ondragover: (ev: Event) => ev.preventDefault(),
        ondrop: (ev: Event) => {
          ev.preventDefault();
          dropOn(w, slot, (ev as DragEvent).dataTransfer?.getData('text/plain') ?? '');
        },
      };
      const peek = aimPreview(w, slot);
      if (!c)
        return h(
          'button',
          {
            type: 'button',
            class: `dig-card is-empty ${cardState(w, slot)}`,
            onclick: onClick,
            ...drop,
          },
          h('span', {}, aim && cardState(w, slot) === 'is-live' ? 'ここへ' : '空き'),
        );
      const d = cardDef(c.id);
      const spent = c.uses <= 0;
      const ls = legendState(w.you, c.id);
      const ch = ls?.legend.chapters[ls.chapter];
      // 続ければ連鎖になる札は、手の中で少しだけ身を乗り出す（字は出さない）。
      const leans =
        w.enc?.phase === 'act' &&
        w.enc.who === 'you' &&
        bonusOf(w, c).parts.some((p) => p.text.startsWith('連鎖'));
      return h(
        'button',
        {
          type: 'button',
          class: `dig-card ${cardState(w, slot)}${spent ? ' is-spent' : ''}${d.legend ? ' is-lead' : ''}${opened === slot ? ' is-open' : ''}${fresh(slot) ? ' is-new' : ''}${leans ? ' is-lean' : ''}`,
          onclick: onClick,
          ...drop,
          onmouseenter: () => {
            if (w.enc?.phase !== 'act' || hoverSlot === slot) return;
            hoverSlot = slot;
            renderSide();
          },
          onmouseleave: () => {
            if (hoverSlot !== slot) return;
            hoverSlot = null;
            renderSide();
          },
          title: [d.sig, d.flavor].filter(Boolean).join('\n'),
          'aria-label': `${slot + 1}　${cardName(c, spent)}`,
        },
        h(
          'span',
          { class: 'dig-card__head' },
          h('b', { class: 'dig-card__name' }, cardName(c, spent)),
          h('span', { class: 'dig-card__key' }, String(slot + 1)),
        ),
        pips(c),
        // 向き合っているあいだは、いま使ったら動く数そのものと、足される点の内訳を。
        w.enc?.phase === 'act' && w.enc.who === 'you'
          ? outcome(w, slot, c)
          : badges(spent ? d.spent : d.ready, null, w),
        peek ? h('span', { class: 'dig-card__next' }, peek) : null,
        h(
          'span',
          { class: 'dig-card__tags' },
          cardTags(c)
            .map((t) => `［${TAG_NAME[t]}］`)
            .join(''),
          (d.arch ?? []).map((a) => `〈${ARCH_NAME[a]}〉`).join(''),
        ),
        h(
          'span',
          { class: 'dig-card__fx' },
          heals(spent ? `${d.spentName}：${fxText(d.spent)}` : fxText(d.ready)),
        ),
        ls && ch
          ? h(
              'span',
              { class: 'dig-card__legend' },
              `第${'一二三'[ls.chapter]}章 ${ch.name}`,
              h('span', { class: 'dig-card__progress' }, `${ls.progress}/${ch.count}`),
            )
          : ls
            ? h('span', { class: 'dig-card__legend' }, `『${ls.legend.title}』完`)
            : null,
      );
    });
    const buildLine = builds.map((b) => {
      const t = tierOf(w.you, b.id);
      const s = SURGES[b.id];
      const nt = nextTier(w.you, b.id);
      return h(
        'span',
        {
          class: `dig-build${t ? ' is-surge' : ''}`,
          title: [b.text, t && s ? (t === 2 ? s.peakText : s.text) : '', nt ?? '']
            .filter(Boolean)
            .join('\n'),
        },
        `《${b.name}》${t === 2 ? ' 極み' : t === 1 ? ' 暴走' : ''}`,
      );
    });
    fill(tray, [
      h('div', { class: 'dig-hand' }, slots),
      h(
        'div',
        { class: 'dig-held' },
        aim
          ? h(
              'p',
              { class: 'dig-amber' },
              aimText(),
              ' ',
              button('やめる', () => {
                aim = null;
                render();
              }),
            )
          : null,
        h(
          'div',
          { class: 'dig-pills' },
          buildLine.length
            ? h(
                'span',
                { class: 'dig-pills__group' },
                h('span', { class: 'dig-pills__label' }, '構成'),
                buildLine,
              )
            : null,
          // エピテットは種類ごとに一つ（同じものは ×n）。刻む先は札・記憶・先の部屋・出来事、
          // 向き合っているあいだは相手（人に効くものだけ、遭遇に一度）。
          w.you.epithets.length ? epithetRow(w) : null,
          w.you.perms.length
            ? h(
                'span',
                { class: 'dig-pills__group' },
                h('span', { class: 'dig-pills__label' }, '記憶'),
                w.you.perms.map((p) => {
                  // 刻むエピテットを選んでいるあいだは、刻める記憶が押せる。
                  const a = aim;
                  const d = a?.kind === 'inscribe' ? epithetDef(a.ep) : undefined;
                  const list = w.you.permEps[p] ?? [];
                  const ok =
                    !!a &&
                    a.kind === 'inscribe' &&
                    !!d?.memory &&
                    list.length < 2 &&
                    !list.includes(a.ep);
                  const eps = list.map((e) => `《${epithetDef(e)?.name ?? e}》`).join('');
                  return ok && a?.kind === 'inscribe'
                    ? h(
                        'button',
                        {
                          type: 'button',
                          class: 'dig-mem is-live',
                          title: `${permDef(p)?.text ?? ''}\n刻むと：${d?.memory?.text ?? ''}`,
                          onclick: () => {
                            aim = null;
                            send({ c: 'inscribe', ep: a.ep, perm: p });
                          },
                        },
                        `${eps}${permDef(p)?.name ?? p}`,
                      )
                    : h(
                        'span',
                        {
                          class: `dig-mem${permDef(p)?.bad ? ' is-bad' : ''}`,
                          title: permDef(p)?.text,
                        },
                        `${eps}${permDef(p)?.name ?? p}`,
                      );
                }),
              )
            : null,
        ),
      ),
    ]);
  }

  /** 手元のエピテットの列。地図の上では刻む先を選び、向き合っているあいだは相手に刻む。 */
  function epithetRow(w: World): HTMLElement | null {
    const e = w.enc;
    const fight = !!e && e.phase === 'act' && e.who === 'you';
    if (e && !fight) return null;
    const kinds = [...new Set(w.you.epithets)].filter((ep) => !fight || !!epithetDef(ep)?.foe);
    if (!kinds.length) return null;
    const inked = !!e?.st.inked;
    const nodes = w.map;
    return h(
      'span',
      { class: 'dig-pills__group dig-pills__group--ep' },
      h('span', { class: 'dig-pills__label' }, fight ? '相手に刻む' : 'エピテット'),
      kinds.map((ep) => {
        const n = w.you.epithets.filter((x) => x === ep).length;
        const d = epithetDef(ep);
        const can = fight
          ? !inked && !!e && !e.foe.eps.includes(ep) && e.foe.eps.length < 3
          : w.you.cards.some((_, i) => aimOk(w, { kind: 'inscribe', ep }, i)) ||
            (!!d?.memory && w.you.perms.length > 0) ||
            nodes.some((m) => nodeInkable(w, ep, m)) ||
            (w.pending?.kind === 'story' && !!d?.story);
        return h(
          'button',
          {
            type: 'button',
            onclick: () => {
              if (fight) send({ c: 'inscribe', ep, foe: true });
              else choose({ kind: 'inscribe', ep });
            },
            ...(fight ? {} : chosen({ kind: 'inscribe', ep })),
            class: `dig-pill dig-pill--ep${sameAim(aim, { kind: 'inscribe', ep }) ? ' is-chosen' : ''}${
              !fight && !profile.hints.includes('epithet') ? ' is-fresh' : ''
            }`,
            // 触れると、貼れる札が白く浮く（押す前に、どこへ貼れるか分かる）。
            onmouseenter: () => {
              if (fight || aim || sameAim(hoverAim, { kind: 'inscribe', ep })) return;
              hoverAim = { kind: 'inscribe', ep };
              renderTray();
            },
            onmouseleave: () => {
              if (!hoverAim) return;
              hoverAim = null;
              renderTray();
            },
            disabled: !can,
            title: fight
              ? `${d?.foe?.text ?? ''}\n（いまの相手に刻む。遭遇に一度、手番は使わない）`
              : facetLines(ep),
            draggable: fight ? undefined : 'true',
            ondragstart: (ev: Event) =>
              (ev as DragEvent).dataTransfer?.setData('text/plain', `ep:${ep}`),
          },
          h('i', { class: 'dig-pill__plus', 'aria-hidden': 'true' }, '＋'),
          `《${d?.name ?? ep}》`,
          fight ? h('i', { class: 'dig-pill__n' }, d?.foe?.text ?? '') : null,
          !fight && n > 1 ? h('i', { class: 'dig-pill__n' }, `×${n}`) : null,
        );
      }),
    );
  }

  function aimText(): string {
    if (!aim) return '';
    if (aim.kind === 'inscribe')
      return `《${epithetDef(aim.ep)?.name}》を刻む先を選ぶ（白い札・記憶・地図の先の部屋）`;
    if (aim.kind === 'buy') return `『${cardDef(aim.id).name}』を入れる枠を選ぶ`;
    if (aim.kind === 'pick')
      return game?.world.you.cards.some((c) => !c)
        ? `『${cardDef(aim.id).name}』を入れる枠を選ぶ`
        : `『${cardDef(aim.id).name}』と入れ替える枠を選ぶ`;
    if (aim.kind === 'alter') return `白いカードを押すと『${cardDef(aim.to).name}』に変わる`;
    return aim.action === 'full' ? 'ひと晩かけて満たすカードを選ぶ' : '捨てるカードを選ぶ';
  }

  /** 選んでいる選択肢のボタンは、押されたままに見せる。 */
  function chosen(a: NonNullable<typeof aim>): Record<string, string | undefined> {
    const on = sameAim(aim, a);
    return { class: on ? 'is-chosen' : undefined, 'aria-pressed': on ? 'true' : 'false' };
  }

  /** その枠が、選んでいる選択肢の相手になれるか。 */
  function aimOk(w: World, a: NonNullable<typeof aim>, slot: number): boolean {
    const c = w.you.cards[slot];
    switch (a.kind) {
      case 'inscribe': {
        const d = epithetDef(a.ep);
        return !!c && !!d?.card && c.eps.length < 2 && !c.eps.includes(a.ep);
      }
      case 'rest':
        return !!c;
      case 'alter':
        return slot === a.slot;
      default:
        // 拾う・買う：空き枠があるあいだは、空き枠だけ（うっかり入れ替えない）。
        return w.you.cards.some((x) => !x) ? !c : true;
    }
  }

  /**
   * 札の見え方。何かを選んでいる間（選択肢・遭遇）だけ、押せる札は白く浮き
   * （is-live）、押せない札は薄く沈む（is-off）。何も選んでいないときは、
   * ふつうの札のまま（地図の上では、読むだけ）。
   */
  function cardState(w: World, slot: number): '' | 'is-live' | 'is-off' {
    const a = aim ?? hoverAim;
    if (a) return aimOk(w, a, slot) ? 'is-live' : 'is-off';
    if (w.enc?.phase === 'act' && w.enc.who === 'you')
      return w.you.cards[slot] ? 'is-live' : 'is-off';
    return '';
  }

  /** 狙っている一手を、その枠でしたら構成がどう変わるか。 */
  function aimPreview(w: World, slot: number): string {
    if (!aim) return '';
    const card = w.you.cards[slot];
    if (aim.kind === 'inscribe')
      return card ? sayDelta(delta(w.you, withEpithet(w.you, slot, aim.ep))) : '';
    if (aim.kind === 'buy' || aim.kind === 'pick')
      return sayDelta(delta(w.you, withCard(w.you, slot, aim.id)));
    if (aim.kind === 'rest' && aim.action === 'discard' && card) {
      const cards = [...w.you.cards];
      cards[slot] = null;
      return sayDelta(delta(w.you, { ...w.you, cards }));
    }
    return '';
  }

  /** 枠へ落とされたもの（エピテット・拾う札・買う札）。 */
  function dropOn(w: World, slot: number, data: string): void {
    const [kind, id] = data.split(':');
    if (!id) return;
    if (kind === 'ep' && w.you.cards[slot]) send({ c: 'inscribe', ep: id, slot });
    else if (kind === 'pick')
      send({ c: 'claim', take: reward.take, help: reward.help, card: id, slot });
    else if (kind === 'buy') send({ c: 'buy', id, slot });
  }

  function clickSlot(w: World, slot: number): void {
    // 灰色の札は、押しても何も起きない（狙っている最中は、中身も開かない）。
    if (aim && !aimOk(w, aim, slot)) return;
    if (aim?.kind === 'alter') {
      send({ c: 'alter', slot, to: aim.to });
      return;
    }
    if (aim?.kind === 'inscribe') {
      send({ c: 'inscribe', ep: aim.ep, slot });
      return;
    }
    if (aim?.kind === 'rest') {
      send({ c: 'rest', action: aim.action, slot });
      return;
    }
    if (aim?.kind === 'buy') {
      send({ c: 'buy', id: aim.id, slot });
      return;
    }
    if (aim?.kind === 'pick')
      return void send({ c: 'claim', take: reward.take, help: reward.help, card: aim.id, slot });
    if (w.enc?.phase === 'act' && w.you.cards[slot]) {
      send({ c: 'card', slot });
      return;
    }
    // 遭遇の外では、押すと中身が開く（触れられない端末でも読める）。
    opened = opened === slot ? null : slot;
    render();
  }

  // ─── 人物を決める ───────────────────────────────────────────

  function renderCreate(): void {
    side.replaceChildren();
    tray.replaceChildren();
    const j = jobDef(create.job);
    const saved = loadRun();
    const pick = <T extends string>(
      label: string,
      list: readonly T[],
      cur: string,
      name: (id: T) => string,
      text: (id: T) => string,
      set: (id: T) => void,
    ) =>
      h(
        'fieldset',
        { class: 'dig-pick' },
        h('legend', {}, label),
        list.map((id) =>
          h(
            'button',
            {
              type: 'button',
              class: id === cur ? 'is-on' : '',
              'aria-pressed': id === cur ? 'true' : 'false',
              onclick: () => {
                set(id);
                render();
              },
            },
            h('b', {}, name(id)),
            h('span', {}, text(id)),
          ),
        ),
      );
    fill(side, [
      section(
        '人物を決める',
        h(
          'p',
          { class: 'dig-quiet' },
          '底の見えない建物を下りる。九階で一つの区画、三つ目の区画の底（B27）を抜ければ、ひとまず抜けた。手札とエピテットと記憶で、その周回の生き方が変わる。向き合った相手とは、殴り合うか、話をつけるか、退くか。疲れたら休む。',
        ),
        saved
          ? button(
              '続きから',
              () => {
                const g = Game.load(saved);
                hardSeen = 0;
                if (g) {
                  game = g;
                  screen = 'play';
                  render();
                } else saveRun(null);
              },
              { class: 'dig-go' },
            )
          : null,
        pick(
          '職',
          allJobs().map((x) => x.id),
          create.job,
          (id) => jobDef(id)?.name ?? id,
          (id) => `〈${ARCH_NAME[JOB_ARCH[id] as Archetype] ?? ''}〉`,
          (id) => {
            create = { ...create, job: id, ...defaultSheet(id) };
          },
        ),
        j ? h('p', {}, j.text) : null,
        j
          ? h(
              'p',
              { class: 'dig-quiet' },
              Object.entries(j.innate)
                .map(([k, v]) => `${k} ${v}`)
                .join('　'),
              '　初めのカード：',
              j.cards
                .slice(0, 3)
                .map((id) => `『${cardDef(id).name}』`)
                .join(''),
            )
          : null,
        pick(
          '経歴（最初の記憶）',
          ORIGINS[create.job] ?? [],
          create.origin,
          (id) => permDef(id)?.name ?? id,
          (id) => permDef(id)?.text ?? '',
          (id) => {
            create.origin = id;
          },
        ),
        pick(
          'エピテット（手元に一つ）',
          JOB_EPITHETS[create.job] ?? [],
          create.ep,
          (id) => `《${epithetDef(id)?.name ?? id}》`,
          (id) => epithetDef(id)?.card?.text ?? '',
          (id) => {
            create.ep = id;
          },
        ),
        pick(
          '所持品',
          JOB_ITEMS[create.job] ?? [],
          create.item,
          (id) => itemDef(id)?.name ?? id,
          (id) => itemDef(id)?.text ?? '',
          (id) => {
            create.item = id;
          },
        ),
        h(
          'label',
          { class: 'dig-field' },
          '名前 ',
          h('input', {
            type: 'text',
            value: create.name,
            maxlength: 12,
            placeholder: 'あなた',
            oninput: (ev: Event) => {
              create.name = (ev.target as HTMLInputElement).value;
            },
          }),
        ),
        h(
          'label',
          { class: 'dig-field' },
          '難度 ',
          h(
            'select',
            {
              onchange: (ev: Event) => {
                create.depth = Number((ev.target as HTMLSelectElement).value);
              },
            },
            Array.from({ length: profile.depth + 1 }, (_, d) =>
              h('option', { value: d, selected: d === create.depth }, String(d)),
            ),
          ),
        ),
        h(
          'label',
          { class: 'dig-field' },
          h('input', {
            type: 'checkbox',
            checked: create.daily,
            onchange: (ev: Event) => {
              create.daily = (ev.target as HTMLInputElement).checked;
            },
          }),
          ' 今日の夜（全員同じ地図）',
        ),
        button('このまま始める', () => begin(), { class: 'dig-go' }),
        profile.carry
          ? h(
              'p',
              { class: 'dig-quiet' },
              `前の夜から持ち越す記憶：《${permDef(profile.carry)?.name ?? profile.carry}》`,
            )
          : null,
      ),
    ]);
  }

  // ─── 全体 ───────────────────────────────────────────────────

  function render(): void {
    renderBar();
    renderGuide();
    dialog.classList.toggle('is-create', screen === 'create');
    dialog.classList.toggle('dig-enc-on', !!game?.world.enc);
    if (screen === 'create') {
      renderCreate();
      return;
    }
    renderSide();
    renderTray();
  }

  function onKey(ev: KeyboardEvent): void {
    if (!game || screen !== 'play' || ev.target instanceof HTMLInputElement) return;
    const w = game.world;
    const n = Number(ev.key);
    if (aim) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        aim = null;
        render();
      } else if (n >= 1 && n <= 5) {
        ev.preventDefault();
        clickSlot(w, n - 1);
      }
      return;
    }
    if (w.enc?.phase === 'act') {
      if (n >= 1 && n <= 5) {
        ev.preventDefault();
        send({ c: 'card', slot: n - 1 });
        return;
      }
      const map: Record<string, Basic> = {
        q: 'press',
        w: 'brace',
        e: 'talk',
        r: 'leave',
        t: 'accept',
      };
      const a = map[ev.key.toLowerCase()];
      if (a) {
        ev.preventDefault();
        send({ c: 'act', a });
      }
    } else if (w.enc?.phase === 'over' && ev.key === 'Enter') {
      ev.preventDefault();
      send({ c: 'close' });
    } else if (!w.enc && !w.pending) {
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
        ev.preventDefault();
        cycle(ev.key === 'ArrowRight' ? 1 : -1);
      } else if (ev.key === 'Enter' && focus !== null && reachable(w).some((n) => n.id === focus)) {
        ev.preventDefault();
        send({ c: 'move', node: focus });
      }
    }
  }
  doc.addEventListener('keydown', onKey, true);

  const saved = loadRun();
  if (saved) {
    const g = Game.load(saved);
    hardSeen = 0;
    if (g) {
      game = g;
      screen = 'play';
    } else saveRun(null);
  }
  const first = profile.lang ?? (doc.documentElement.lang.startsWith('en') ? 'en' : 'ja');
  dialog.lang = first;
  void setLang(first).then(render);
}
