import { AFTER } from '../content/after';
import { PACE } from '../content/balance';
import { cardName, cardTags, JOB_ARCH } from '../content/cardinfo';
import { epTier } from '../content/epithets';
import { IDLE, VITALS } from '../content/flavor';
import { DIFFICULTY, sectionNo } from '../content/floors';
import { fxText } from '../content/fx';
import { gearOf } from '../content/gear';
import { legendState } from '../content/legends';
import { orderOf } from '../content/orders';
import { defaultSheet, JOB_EPITHETS, JOB_ITEMS, ORIGINS, type Sheet } from '../content/origins';
import { quirkDef } from '../content/quirks';
import {
  allJobs,
  cardDef,
  epithetDef,
  foeDef,
  itemDef,
  jobDef,
  permDef,
} from '../content/registry';
import { buildsOf } from '../content/sources';
import { nextTier, SURGES, tierOf } from '../content/surges';
import { CHEER, READY, SETTLED } from '../content/voices';
import type { Basic, Cmd, Ev, RestAction } from '../core/events';
import type { Card, Goal, GoalSize, MapNode, World } from '../core/model';
import { fold } from '../core/reduce';
import { ARCH_NAME, type Archetype, TAG_NAME } from '../core/tags';
import { PHASE_NAME, phaseOf } from '../core/time';
import { getLang, setLang, tr } from '../i18n';
import {
  type Advice,
  advise,
  preview,
  type Route,
  type RouteKind,
  sourceLabel,
} from '../sim/advise';
import { bonusOf, incoming, resonance, shownIntent } from '../sim/encounter';
import { Game } from '../sim/game';
import { carryGoals, metric as goalMetric, goalText, REWARD_TEXT } from '../sim/goals';
import { foeHardness, MINERALS, nodeHardness, outmatched, youHardness } from '../sim/hardness';
import { misses } from '../sim/near';
import { epUses, itemRoom, maxHp, maxMind, stats } from '../sim/ops';
import {
  deckCap,
  deckRoom,
  deckSize,
  nodeOf,
  OUTCOME_NAME,
  ROWS,
  reachable,
  START_BACK,
  stratumName,
} from '../sim/run';
import { type SpotAction, spotActions } from '../sim/spot';
import { badges, epChip, heals, luckyTag, outcome, pips, previewCard } from './cards';
import { button, type Child, fill, h, meter, pressable, retranslate } from './dom';
import { armDetail, type EncView, encounterPanel } from './encounter';
import { HINTS, nextHint } from './hints';
import { hoverTips } from './hovertip';
import {
  act,
  countCoins,
  hardTag,
  placeOf,
  roomInfo,
  section,
  statusPanel,
  tally,
  titled,
} from './parts';
import { cardEps, gearRows, restPanel, shopPanel, storyPanel, toldPanel } from './places';
import { cardEffect, clearEffects, delta, say as sayDelta, withEpithet } from './preview';
import {
  foeInkable,
  inkRow,
  inOrder,
  markRow,
  nodeInkable,
  pairOrder,
  routeFacts,
  spotFits,
  spotGear,
} from './route';
import { loadProfile, loadRun, type Profile, saveProfile, saveRun } from './save';
import { DigSound } from './sound';
import type { TurnLine } from './state';
import { type RoomView, type Scene, Tower, type TowerView } from './tower';
import type { Ui } from './ui';
import {
  BASIC_NAME,
  band,
  clock,
  dryCount,
  facetLines,
  firstStep,
  floorNo,
  lackText,
  otherJobs,
  persona,
  pickBy,
  SPOT_ORDER,
  SPOT_VERB,
  stepLabel,
  voiceOf,
  way,
  whoOf,
} from './words';

/**
 * DIG の画面。底の見えない巨大な建物を、フロアごとに下りていく。
 *
 *   塔      斜めに見下ろしたフロアの積み重ね（本体）。部屋を押すと進む
 *   上帯    フロア・時刻・体力・精神・金・硬度（ここには、それ以上足さない）
 *   脇      いま起きていること（三つの道 → その場で → 進む／遭遇／出来事・拾う・
 *          食堂・古物商）。その下に目標、状況（階の癖・余韻・冠）、ヒント
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

/** 裏で値を動かした規則（出どころ・一文・何番目のイベントの前か）。 */
type Why = { src: string; text: string; at: number };

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
  /** 選んでいる道。'walk' は自分の脚で（推奨を切る手動）。 */
  let routeSel: RouteKind | 'walk' | null = null;
  let routePeek: RouteKind | null = null;
  /** 案内を一覧でめくっているときの位置。 */
  let browse: number | null = null;
  let hintShown: string | null = null;
  /** 遭遇の外で押して開いたカード（触れられない端末でも中身を読める）。 */
  let opened: number | null = null;
  let hoverSlot: number | null = null;
  /** 狭い画面で、一度押して構えた札（もう一度押すと切る）。 */
  let armedSlot: number | null = null;
  /** 札を二度押しで切る端末（狭い画面か、指で触る端末）。一度目は構えて中身を読む。 */
  const narrow = () =>
    window.matchMedia('(max-width: 52rem), (hover: none) and (pointer: coarse)').matches;
  /** 触れている札以外の手（札と同じく、四つの道に先に映す）。 */
  let hoverAct: Basic | null = null;
  /** 触れている選択肢（押す前に、相手になれる札を白く見せる）。 */
  let hoverAim: typeof aim = null;
  /** 最後に体か心が戻った時刻（上の帯の計器を、少しのあいだ緑に）。 */
  let healAt = -9;
  /** 最後に相手へエピテットを刻んだ時刻（名の冠を押す演出）。 */
  let inkAt = -9;
  /** 直前の手番（あなたが何をして、相手が何をしたか）。基本の一巡を見せる。 */
  let lastTurn: TurnLine[] = [];
  let advice: Advice | null = null;
  let adviceAt = -1;
  let log: string[] = [];
  /** 次に手元の枠を押したとき、何をするか。 */
  let aim:
    | { kind: 'inscribe'; ep: string }
    | { kind: 'rest'; action: RestAction }
    | { kind: 'alter'; slot: number; to: string }
    | null = null;
  const reward: { take?: string; help?: number } = {};
  /** 手持ちがいっぱいのときに拾おうとしている札（手放す札を選んでいる）。 */
  /** 受け取りで選んでいる一枚（作品の札か道具）と、手放す一枚（uid）。 */
  let pickId: string | null = null;
  let dropUid: number | null = null;
  /** 人物を決める画面で、初めの手札を開いているか。 */
  let handOpen = false;
  /** 左の欄を、地図ではなく手札の一覧にしているか（向き合っていないとき）。 */
  let deckOpen = false;
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
  // 裏で効いたもの（エピテット・記憶・構成・掟…）。案内と同じ帯に、一つずつ打たれる。
  const whyLine = h('p', { class: 'dig-guide__why', hidden: true });
  const guide = h('div', { class: 'dig-guide' }, moment, whyLine, caption, hintBox);
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
  // 人物を決める画面で「手札を見る」を押すと、地図の場所が手札の画面に替わる。
  const handView = h('div', { class: 'dig-handview', hidden: true });
  // 人物を決める画面のヒント。地図の欄の下端に重なり、右の欄の「この夜に入る」と同じ段に並ぶ。
  const createHint = h('div', { class: 'dig-create-hint', hidden: true });
  // 整える：地図の場所に、手持ちの札を全部広げる（剥がす・刻み直す）。
  const deckView = h('div', { class: 'dig-handview dig-deckview', hidden: true });
  // 左の欄の切り替え（地図 ⇄ 手札）。向き合っていないときは、いつでも。
  const viewSwitch = h('div', {
    class: 'dig-switch',
    role: 'group',
    'aria-label': '左の欄',
    hidden: true,
  });
  const view = h(
    'div',
    { class: 'dig-view' },
    guide,
    canvas,
    tip,
    zoomer,
    handView,
    deckView,
    viewSwitch,
    createHint,
  );
  // 寄せ引きの釦は、ヒントの地の上に出す（ヒントの高さは幅で変わる）。
  new ResizeObserver(() =>
    view.style.setProperty('--dig-hint-h', `${createHint.offsetHeight}px`),
  ).observe(createHint);
  const side = h('aside', { class: 'dig-side' });
  const tray = h('footer', { class: 'dig-tray' });
  const live = h('p', { class: 'dig-live', 'aria-live': 'polite' });
  const main = h('main', { class: 'dig-main' }, view, side);
  // 狭い画面だけ：地図の下の切り替え（札 ⇄ 情報）と、受け取りの下端の「前へ・次へ」。
  const paneSwitch = h('div', { class: 'dig-panes', role: 'tablist', hidden: true });
  // 狭い画面の遭遇：上帯（あなた）のすぐ下に、相手の段（名前・次の手・四つの道の棒）。
  const foeBar = h('div', { class: 'dig-foebar', hidden: true });
  const stepNav = h('nav', { class: 'dig-stepnav', hidden: true });
  const app = h('div', { class: 'dig-app' }, bar, foeBar, main, paneSwitch, tray, stepNav, live);
  dialog.append(app);
  // 触れたときの説明は、どこでも同じ枠で（ブラウザの title の代わり）。
  const tips = hoverTips(dialog);
  // 外へ出した欄が、操作と描き直しを頼む窓口。
  const ui: Ui = { send, render, caption: (text) => showCaption(text) };
  /** 向き合う欄が読む、画面の持ち物（触れている札・構えた札・前の手番・灯った時刻）。 */
  const encView = (): EncView => ({
    hoverSlot,
    armedSlot,
    hoverAct,
    lastTurn,
    inkAt,
    litAt,
    now,
    point: (a) => {
      hoverAct = a;
      renderSide();
    },
  });
  doc.body.append(dialog);
  dialog.showModal();
  // 開いた直後は、どの印にも焦点を置かない（左上の小さな印に輪が出ないように）。
  dialog.tabIndex = -1;
  dialog.focus();
  const tower = new Tower(canvas);

  // ─── 開け閉め ───────────────────────────────────────────────

  let raf = 0;
  /** 閉じたあとは、残った予約（目押しの後追いなど）から何も送らない。 */
  let closed = false;
  function close(): void {
    closed = true;
    cancelAnimationFrame(raf);
    cancelAnimationFrame(gaugeRaf);
    clearTimeout(gaugeTimer);
    gauge = null;
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
    if (!game || busy || closed) return false;
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
    const why: Why[] = [];
    const played = cmd.c === 'card' ? (w0.you.cards[cmd.slot] ?? undefined) : undefined;
    const evs = game.dispatch(cmd, why);
    if (cmd.c === 'card' || cmd.c === 'act') lastTurn = summarize(cmd, evs, before);
    else if (cmd.c === 'move' || cmd.c === 'close') lastTurn = [];
    hoverSlot = null;
    hoverAct = null;
    armedSlot = null;
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
      play(cmd, evs, pre, preView, why, played);
      return true;
    }
    react(evs);
    showWhy(why, played);
    settle();
    return true;
  }

  /**
   * 裏で効いたものを、案内の帯に一つずつ打つ。打った札のエピテットと、値を
   * 実際に動かした規則（記憶・構成・連携・原型・掟・職・場所と人に刻んだもの）。
   * 土台の規則と版の調整は出さない。同じ一文は一度だけ、多くても五つ。
   */
  let whyTimer = 0;
  function showWhy(list: readonly Why[], card?: Card | null): void {
    const out: string[] = [];
    for (const e of card?.eps ?? []) {
      const d = epithetDef(e);
      const head = d?.card?.text.split('。')[0];
      if (d && head) out.push(`《${d.name}》${head}`);
    }
    for (const x of list) {
      if (/^(rule|v\d|depth\d)/.test(x.src)) continue;
      const [kind, id] = x.src.split(':');
      const label = kind === 'job' ? (jobDef(id ?? '')?.name ?? null) : sourceLabel(x.src);
      const bare = label?.replace(/[《》〈〉『』]/g, '') ?? '';
      // 出どころ（太字）と中身を分けて持つ。帯では「出どころ　中身」の一行に。
      const text = label && !x.text.includes(bare) ? `${label}\t${x.text}` : x.text;
      if (!out.includes(text)) out.push(text);
    }
    if (!out.length) return;
    whyLine.replaceChildren(
      ...out.slice(0, 5).map((t, i) => {
        const [src, body] = t.includes('\t') ? t.split('\t') : ['', t];
        return h(
          'span',
          { class: 'dig-why-chip', style: `animation-delay:${i * 90}ms` },
          src ? h('b', {}, src) : null,
          body ?? '',
        );
      }),
    );
    whyLine.hidden = false;
    // 打たれるたびに、小さく鳴る（タイプライタの一打）。
    out.slice(0, 5).forEach((_, i) => {
      window.setTimeout(() => sound.tick(i), 72 + i * 90);
    });
    window.clearTimeout(whyTimer);
    whyTimer = window.setTimeout(
      () => {
        whyLine.hidden = true;
      },
      3200 + out.length * 90,
    );
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
  function play(
    cmd: Cmd,
    evs: readonly Ev[],
    pre: World,
    preView: TowerView,
    why: readonly Why[],
    played?: Card | null,
  ): void {
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
      // 当たりと同時に、こちらの一手で裏に効いたものを帯へ。
      showWhy(
        why.filter((x) => at < 0 || x.at <= at),
        played,
      );
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
        // 相手の返しで効いたもの（掟や、相手に刻んだもの）。
        const late = why.filter((x) => at >= 0 && x.at > at);
        if (late.length) showWhy(late);
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
            if (ev.why === 'picked' || ev.why === 'bought') {
              joined = { name: cardDef(ev.card.id).name, at: t };
              window.setTimeout(() => renderDeck(), 2500);
            }
          }
          break;
        case 'deck.swap':
          // 尽きた札の入れ替えは、黙って消さない：枠に「〜と入れ替え」を残して差し込む。
          if (ev.who === 'you') {
            newAt.set(ev.slot, t);
            swapAt.set(ev.slot, { t, out: ev.out ? cardDef(ev.out).name : '' });
            sound.gain();
            window.setTimeout(() => renderTray(), SWAP_MS + 60);
          }
          break;
        case 'pending':
          // 受け取りの段取りは、ここから数える（判・品・札が順に）。
          if (ev.p?.kind === 'reward') {
            rewardAt = t;
            pickId = null;
            dropUid = null;
          }
          break;
        case 'deck.add':
          // 後ろへ入った札も、手元の帯に一度だけ知らせる（黙って増えない）。
          if (ev.who === 'you') {
            joined = { name: cardDef(ev.card.id).name, at: t };
            window.setTimeout(() => render(), 2500);
          }
          break;
        case 'deck.deal':
          // 遭遇の初めに配り直した五枚は、左から一枚ずつ差し込む。
          if (ev.who === 'you') dealAt = t;
          break;
        case 'foe.ep':
          // 相手に刻んだ：名に冠が押され、計器ごと一度だけ沈む。
          inkAt = t;
          sound.gain();
          kick(1, 1);
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
          // 目標に届いたら、一言添えて大袈裟に。
          const cheer =
            ev.text.startsWith('目標に届いた') && game ? voiceOf(CHEER, game.world, ev.text) : '';
          if (lv === 3) showMoment(ev.text);
          else if (cheer) showCaption(`${ev.text}　${cheer}`);
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
  let bestBefore = 0;
  let bestStreak = 0;
  /** 入れ替わった枠（何と入れ替わったかを、しばらく札の上に残す）。 */
  const SWAP_MS = 2400;
  const swapAt = new Map<number, { t: number; out: string }>();
  const swapped = (slot: number): string | null => {
    const s = swapAt.get(slot);
    if (!s) return null;
    if ((now() - s.t) * 1000 > SWAP_MS) {
      swapAt.delete(slot);
      return null;
    }
    return s.out;
  };
  /** 後ろへ入ったばかりの札（手元の帯に、しばらく知らせる）。 */
  let joined = { name: '', at: -9 };
  /** 配り直した瞬間（一度の描画だけ、左から順に差し込む）。 */
  let dealAt = -9;
  function dealt(): boolean {
    const t = dealAt;
    dealAt = -9;
    return now() - t < 1.2;
  }
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
    streak = 0;
    // 前の挑戦の予測は使わない（同じ種でも人物が違えば別の局面）。
    clearEffects();
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
        ink: aim?.kind === 'inscribe' && nodeInkable(w, aim.ep, n),
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
          // 地図の印：道の先へ刻む部屋。
          mark: r.mark?.node,
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
  /**
   * 塔の描き替えは、こまの支配項（三角形の塗りと、点の書き出し）。カメラも人も止まって
   * いるあいだは三十こまに間引き、画面を描き直したとき（操作や触れた部屋が替わったとき）は
   * すぐに描く。
   */
  let lastDraw = 0;
  let drawNow = true;
  function frame(): void {
    const t = performance.now();
    const due = drawNow || tower.moving || t - lastDraw >= 33;
    const dt = Math.min(0.1, (t - (due ? lastDraw || last : last)) / 1000);
    last = t;
    if (screen === 'create' || !game) {
      if (due) {
        tower.draw(EMPTY, now(), dt);
        lastDraw = t;
        drawNow = false;
      }
    } else if (screen === 'play') {
      const w = game.world;
      if (!w.enc && !w.pending && !w.ending && adviceAt !== w.seq) {
        adviceAt = w.seq;
        advice = advise(w);
        render();
      }
      // 止め（ヒットストップ）のあいだは、絵を描き替えない。
      if (due && now() >= freezeUntil) {
        tower.draw(heldView ?? towerView(staged ?? w), now(), dt);
        lastDraw = t;
        drawNow = false;
      }
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
      quirkDef(n.quirk)
        ? h('span', { class: 'dig-quiet' }, `階の癖：${quirkDef(n.quirk)?.text}`)
        : null,
      n.npc && (w.flags[`wound:${n.npc}`] ?? 0) > 0
        ? h(
            'span',
            { class: 'dig-wound' },
            `前の傷 体力と意志 −${Math.round((w.flags[`wound:${n.npc}`] ?? 0) / 2)}%`,
          )
        : null,
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
            retranslate(dialog);
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

  /** 相手の段（狭い画面の遭遇）。構えた札・触れている札の効き目を、棒の先に点滅で。 */
  function renderFoeBar(): void {
    foeBar.replaceChildren();
    const w = game && screen === 'play' ? (staged ?? game.world) : null;
    const e = w?.enc;
    foeBar.hidden = !w || !e;
    if (!w || !e) return;
    const f = e.foe;
    const intent = shownIntent(w);
    const sel = armedSlot ?? hoverSlot;
    const eff = e.phase === 'act' && sel !== null && w.you.cards[sel] ? cardEffect(w, sel) : null;
    const shown = f.clues.filter((c) => c.shown && !c.false).length;
    const way = (verb: string, el: HTMLElement) =>
      h('div', { class: 'dig-foebar__way' }, h('span', { class: 'dig-foebar__verb' }, verb), el);
    fill(foeBar, [
      h(
        'p',
        { class: 'dig-foebar__head' },
        h('b', { class: 'dig-foebar__name' }, f.name),
        hardTag(foeHardness(f), youHardness(w)),
        intent && e.phase === 'act'
          ? h(
              'span',
              { class: 'dig-foebar__intent' },
              '次の手 ',
              h('b', {}, intent.label),
              intent.power ? h('i', {}, String(intent.power)) : null,
            )
          : null,
      ),
      h(
        'div',
        { class: 'dig-foebar__ways' },
        way(
          '倒す',
          meter(f.hp, f.maxHp, 'foe-hp', '体力', { shield: f.guard, loss: eff ? -eff.hp : 0 }),
        ),
        way(
          '折る',
          meter(f.resolve, f.maxResolve, 'foe-will', '意志', { loss: eff ? -eff.resolve : 0 }),
        ),
        f.need < 50
          ? way(
              '打ち解ける',
              meter(f.trust, f.need, 'foe-trust', '信頼', { gain: eff?.trust ?? 0 }),
            )
          : way('打ち解ける', h('span', { class: 'dig-quiet' }, '通じない')),
        f.clues.length
          ? way(
              '暴く',
              meter(shown, f.clues.length, 'foe-clue', '手がかり', { gain: eff?.clues ?? 0 }),
            )
          : null,
      ),
    ]);
  }

  function renderSide(): void {
    renderFoeBar();
    const spots = spotSpots();
    side.replaceChildren();
    if (!game) {
      guide.append(hintBox);
      return;
    }
    const sw = staged ?? game.world;
    // 刻む先を選んでいるあいだ（地図の上で）：何を選んでいるかと、やめる。
    if (aim && !sw.enc)
      fill(side, [
        h(
          'p',
          { class: 'dig-amber dig-aimbar' },
          aimText(),
          ' ',
          button('やめる', () => {
            aim = null;
            render();
          }),
        ),
      ]);
    renderPanel(sw);
    const goals = goalsPanel(sw);
    if (goals) fill(side, [goals]);
    // 目標の下に、いまの状況（階の癖・余韻・冠）と、ヒント。
    const status = statusPanel(sw);
    if (status) fill(side, [status]);
    side.append(hintBox);
    slideSpots(spots);
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
      fill(side, [encounterPanel(w, ui, encView())]);
      return;
    }
    const p = w.pending;
    if (p?.kind === 'story') {
      fill(side, [storyPanel(w, ui)]);
      return;
    }
    if (p?.kind === 'told') {
      fill(side, [toldPanel(w, ui)]);
      return;
    }
    if (p?.kind === 'reward') {
      fill(side, [rewardPanel(w)]);
      return;
    }
    if (p?.kind === 'rest') {
      fill(side, [restPanel(w, ui)]);
      return;
    }
    if (p?.kind === 'summit') {
      fill(side, [summitPanel(w)]);
      return;
    }
    if (p?.kind === 'shop') {
      fill(side, [shopPanel(w, ui)]);
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

  /** いま選んでいる道（部屋を指していなければ）。 */
  function chosenRoute(): Route | undefined {
    if (!advice || pinned !== null) return undefined;
    return [...advice.win, ...advice.play].find((r) => r.kind === routeSel);
  }

  /**
   * 地図の欄。行き先を決めると（道を選ぶか、部屋を押すと）、琥珀の枠が一つ開いて、
   * その中に「行き先の中身 → その場で → 進む釦」が上から順に入る。整えてから、
   * 枠の下端の釦で進む。行き先が無いあいだは、その場でだけがふつうの欄で並ぶ。
   */
  function mapPanel(w: World): HTMLElement {
    const next = reachable(w);
    const sel = pinned !== null ? nodeOf(w, pinned) : undefined;
    const kids: (Child | readonly Child[])[] = [];
    const chosen = sel ? undefined : chosenRoute();
    const go = sel ? (next.some((n) => n.id === sel.id) ? sel.id : undefined) : chosen?.path[0];
    // 自分の脚で：推奨を切って、部屋も、その場でも、自分で選ぶ（道の読みは何も勧めない）。
    const manual = routeSel === 'walk' && !sel;
    if (advice) {
      const all = [...advice.win, ...advice.play];
      const short: Record<RouteKind | 'walk', string> = {
        safe: '安定',
        chain: '高連鎖',
        walk: '自分の脚で',
      };
      const metric = (r: (typeof all)[number]) =>
        r.kind === 'safe'
          ? r.survive < 0.95
            ? `抜ける ${Math.round(r.survive * 100)}%`
            : `体力 ${Math.round(r.hpEnd * 100)}% で着く`
          : `噛み合い ${r.links.length}`;
      const own = h(
        'button',
        {
          type: 'button',
          class: `dig-chip dig-chip--walk${manual ? ' is-on' : ''}`,
          'aria-pressed': manual ? 'true' : 'false',
          onclick: () => {
            routeSel = routeSel === 'walk' && pinned === null ? null : 'walk';
            pinned = null;
            render();
          },
        },
        h('b', {}, short.walk),
        h('span', {}, '推奨を切る'),
        h('span', { class: 'dig-chip__step' }, '部屋は自分で'),
      );
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
                  class: `dig-chip dig-chip--${r.kind}${chosen?.kind === r.kind ? ' is-on' : ''}`,
                  'aria-pressed': chosen?.kind === r.kind ? 'true' : 'false',
                  onclick: () => {
                    routeSel = routeSel === r.kind && pinned === null ? null : r.kind;
                    pinned = null;
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
            own,
          ),
          sel || chosen ? plan(w, sel, chosen, go) : null,
        ),
      );
    } else if (sel) kids.push(section('部屋', plan(w, sel, undefined, go)));
    // 道の読みが無いとき、または自分の脚でのときは、行ける部屋を並べる（自分で選ぶ）。
    if (!sel && (!advice || manual))
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
    if (!sel && !chosen)
      kids.push(
        section(
          'その場で',
          spotRows(w),
          // 抜けたあとは、いつでも灯りを置ける（どこまで下りたかを持ち帰る）。挑戦が
          // 終わる一手なので、ほかの釦から離して置き、二度押さないと置かない。
          w.flags.cleared ? lampButton(w) : null,
        ),
      );
    return h('div', {}, ...kids);
  }

  /** 行き先の枠：中身（道の読みか部屋）→ その場で → 進む釦。 */
  function plan(
    w: World,
    sel: MapNode | undefined,
    chosen: Route | undefined,
    go: number | undefined,
  ): HTMLElement {
    return h(
      'div',
      { class: `dig-plan${chosen ? ` dig-plan--${chosen.kind}` : ''}` },
      sel
        ? h(
            'div',
            { class: 'dig-plan__room' },
            roomInfo(w, sel),
            button(
              '閉じる',
              () => {
                pinned = null;
                render();
              },
              { class: 'dig-plan__close' },
            ),
          )
        : chosen
          ? routeFacts(w, chosen)
          : null,
      spotRows(w, go, chosen, `${chosen?.kind ?? 'room'}:${go ?? ''}`),
      w.flags.cleared ? lampButton(w) : null,
      go !== undefined
        ? h(
            'div',
            { class: 'dig-plan__go', 'data-spot': 'go' },
            button(stepLabel(w, go), () => send({ c: 'move', node: go }), { class: 'dig-go' }),
          )
        : null,
    );
  }

  /** 灯りを置く釦。一度押すと構え（四秒）、もう一度押すと置く。 */
  let lampArmed = -9;
  function lampButton(w: World): HTMLElement {
    const armed = now() - lampArmed < 4;
    const at = `B${floorNo(w, Math.max(0, nodeOf(w, w.pos)?.row ?? 0))}`;
    return h(
      'div',
      { class: 'dig-lamp' },
      button(
        armed ? `もう一度押すと、${at}で灯りを置く` : '灯りを置く…',
        () => {
          if (now() - lampArmed < 4) {
            lampArmed = -9;
            send({ c: 'onward', go: false });
            return;
          }
          lampArmed = now();
          render();
          window.setTimeout(() => {
            if (now() - lampArmed >= 4) render();
          }, 4100);
        },
        {
          class: `dig-lamp__b${armed ? ' is-armed' : ''}`,
          title: `${at}までを持ち帰って、挑戦を終える`,
        },
      ),
    );
  }

  /**
   * 目押し：その場での一手は、左右に揺れる印を止めて決まる。緑の帯で止めれば
   * そのとおり（×1）、帯の真ん中の細い印なら会心（×1.5）、外せば弱く効く（×0.6）。
   * 結果は命令に添えて送る（記録から同じ夜が再現できるように）。静かな設定では
   * 揺らさず、そのとおりに効く。
   */
  const GAUGE_PERIOD = 0.9;
  let gauge: {
    key: string;
    cmd: Cmd;
    at: number;
    ok: [number, number];
    crit: [number, number];
    stop?: number;
    q?: number;
  } | null = null;
  let gaugeRaf = 0;
  let gaugeTimer = 0;
  const gaugePos = (t: number) => {
    const x = ((t - (gauge?.at ?? 0)) / GAUGE_PERIOD) % 2;
    return x < 1 ? x : 2 - x;
  };
  function startGauge(a: SpotAction & { peel?: Cmd }): void {
    if (gauge) return;
    // 付け替えは腕前の要らない一手（剥がして、刻む）。揺らさない。
    if (a.kind === 'ink') {
      stepsNow?.done.add(a.id);
      if (a.peel && !send(a.peel)) return;
      send(a.cmd);
      return;
    }
    if (still()) {
      stepsNow?.done.add(a.id);
      send(withKnack(a.cmd, 1));
      return;
    }
    const c = 0.25 + Math.random() * 0.5;
    gauge = {
      key: a.id,
      cmd: a.cmd,
      at: now(),
      ok: [c - 0.14, c + 0.14],
      crit: [c - 0.03, c + 0.03],
    };
    renderSide();
    const tick = () => {
      const el = side.querySelector<HTMLElement>('.dig-gauge__mark');
      if (!gauge || gauge.stop !== undefined) return;
      if (el) el.style.left = `${(gaugePos(now()) * 100).toFixed(2)}%`;
      gaugeRaf = requestAnimationFrame(tick);
    };
    gaugeRaf = requestAnimationFrame(tick);
  }
  const withKnack = (cmd: Cmd, q: number): Cmd =>
    cmd.c === 'item' || cmd.c === 'breather' ? { ...cmd, q } : cmd;
  function stopGauge(): void {
    if (!gauge || gauge.stop !== undefined) return;
    cancelAnimationFrame(gaugeRaf);
    const p = gaugePos(now());
    const g = gauge;
    g.stop = p;
    g.q = p >= g.crit[0] && p <= g.crit[1] ? 1.5 : p >= g.ok[0] && p <= g.ok[1] ? 1 : 0.6;
    if (g.q > 1) sound.chain(2);
    else if (g.q === 1) sound.gain();
    else sound.fail();
    renderSide();
    const steps = stepsNow;
    gaugeTimer = window.setTimeout(() => {
      gauge = null;
      steps?.done.add(g.key);
      send(withKnack(g.cmd, g.q ?? 1));
    }, 520);
  }
  function cancelGauge(): void {
    if (!gauge || gauge.stop !== undefined) return;
    cancelAnimationFrame(gaugeRaf);
    gauge = null;
    renderSide();
  }
  function gaugeRow(a: SpotAction, fit: boolean): HTMLElement {
    const g = gauge;
    if (!g) return h('div');
    const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
    const result =
      g.q === undefined ? null : g.q > 1 ? '会心 ×1.5' : g.q === 1 ? '良し ×1' : '外れ ×0.6';
    return h(
      'div',
      {
        class: `dig-gauge${fit ? ' is-fit' : ''}${g.q === undefined ? '' : g.q > 1 ? ' is-crit' : g.q === 1 ? ' is-ok' : ' is-miss'}`,
        'data-spot': a.id,
        role: 'button',
        tabindex: '0',
        'aria-label': `${a.label}　押して止める`,
        onclick: () => stopGauge(),
      },
      h('span', { class: 'dig-spot__what' }, a.label),
      h(
        'span',
        { class: 'dig-gauge__bar' },
        h('i', {
          class: 'dig-gauge__ok',
          style: `left:${pct(g.ok[0])};width:${pct(g.ok[1] - g.ok[0])}`,
        }),
        h('i', {
          class: 'dig-gauge__crit',
          style: `left:${pct(g.crit[0])};width:${pct(g.crit[1] - g.crit[0])}`,
        }),
        h('i', { class: 'dig-gauge__mark', style: `left:${pct(g.stop ?? gaugePos(now()))}` }),
      ),
      h(
        'span',
        { class: 'dig-gauge__foot' },
        h('span', { class: 'dig-spot__gain' }, a.gain),
        h('span', { class: 'dig-gauge__say' }, result ?? '押して止める（Space）'),
        // 動いているあいだだけ、取り消せる（品も時間も減らない。Esc でも同じ）。
        g.q === undefined
          ? h(
              'button',
              {
                type: 'button',
                class: 'dig-gauge__cancel',
                onclick: (ev: Event) => {
                  ev.stopPropagation();
                  cancelGauge();
                },
              },
              'やめる',
            )
          : null,
      ),
    );
  }

  /**
   * 行き先を決めたときの「その場で」は、その時点の箱を手順として固定する。使った箱は
   * 消え（回数が残っていても、この行き先のためには済んだ）、残りが上へ詰まる。新しい
   * 案は足さない。全部済めば、枠には進む釦だけが残る。手順は行き先ごとに覚えておき
   * （道を選び替えて戻っても続きから）、部屋を移ると捨てる。
   */
  let stepsAt: number | null = null;
  const stepsBy = new Map<string, { ids: string[]; done: Set<string> }>();
  let stepsNow: { ids: string[]; done: Set<string> } | null = null;

  /**
   * 箱の三行目：見つけた隠し順序（すぐ上の箱か、直前に使ったものに続くとき）と、
   * 代償つきの品の、道の見込みの変わり方。
   */
  function spotExtra(
    w: World,
    a: SpotAction,
    above: SpotAction | undefined,
    route: Route | undefined,
  ): HTMLElement | null {
    const last = w.you.lastUse;
    const prev =
      above !== undefined
        ? spotGear(above)
        : last && last.at === w.pos
          ? last.id === 'breather'
            ? null
            : gearOf(last.id)
          : undefined;
    const g = spotGear(a);
    const o = prev !== undefined && g !== undefined ? orderOf(prev, g) : undefined;
    const known =
      o && (w.found.includes(`order:${o.id}`) || profile.found.includes(`order:${o.id}`));
    const cost = costNote(w, a, route);
    if (!known && !cost) return null;
    return h(
      'span',
      { class: 'dig-spot__more' },
      known ? h('span', { class: 'dig-spot__order' }, `順番：${o?.name}（${o?.effect}）`) : null,
      cost
        ? h(
            'span',
            {
              class: `dig-spot__cost${cost.startsWith('-') ? ' is-worse' : cost.startsWith('+') ? ' is-better' : ''}`,
            },
            cost.slice(1),
          )
        : null,
    );
  }

  /** 代償つきの品を使ったら、選んだ道の見込みがどう変わるか（使う前に）。 */
  const costCache = new Map<string, string>();
  function costNote(w: World, a: SpotAction, route: Route | undefined): string {
    if (!a.cost || !route) return '';
    const k = `${w.seq}:${a.id}:${route.kind}`;
    let v = costCache.get(k);
    if (v === undefined) {
      // 道の読みの数（上の枠に出ている数）に、使う前と後の差を足して見せる。
      const p = preview(w, a.cmd, route.path);
      const pct = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 100);
      const parts: string[] = [];
      if (p) {
        const da = p.after.alive - p.before.alive;
        const dh = p.after.hpEnd - p.before.hpEnd;
        if (Math.abs(da) >= 0.01)
          parts.push(`抜ける ${pct(route.survive)}% → ${pct(route.survive + da)}%`);
        if (Math.abs(dh) >= 0.01)
          parts.push(`着いて体力 ${pct(route.hpEnd)}% → ${pct(route.hpEnd + dh)}%`);
        if (!parts.length) parts.push('見込みは変わらない');
        // 先頭の一字で良し悪し（悪くなる -、良くなる +、変わらない =）。
        const worse = da < -0.005 || dh < -0.005;
        const better = !worse && (da > 0.005 || dh > 0.005);
        v = `${worse ? '-' : better ? '+' : '='}この道：${parts.join('・')}`;
      } else v = '';
      if (costCache.size > 40) costCache.clear();
      costCache.set(k, v);
    }
    return v;
  }

  function spotRows(w: World, toward?: number, route?: Route, key?: string): HTMLElement {
    const ink = inkRow(w, route);
    const mark = markRow(w, route);
    const list = [
      ...(ink ? [{ a: ink as SpotAction, fit: true }] : []),
      ...(mark ? [{ a: mark as SpotAction, fit: true }] : []),
      ...spotActions(w, toward).map((a) => ({ a, fit: spotFits(a, toward, route) })),
    ];
    let shown = [...list]
      .sort((x, y) => Number(y.fit) - Number(x.fit) || y.a.score - x.a.score)
      .slice(0, 4)
      .sort(
        (x, y) =>
          Number(y.fit) - Number(x.fit) ||
          SPOT_ORDER[x.a.kind] - SPOT_ORDER[y.a.kind] ||
          y.a.score - x.a.score,
      );
    stepsNow = null;
    if (key !== undefined) {
      if (stepsAt !== w.pos) {
        stepsAt = w.pos;
        stepsBy.clear();
      }
      let st = stepsBy.get(key);
      if (!st) {
        // 上の四つに入らなくても、手順の中の箱と隠し順序でつながる品は、一つだけ足す。
        const extra = list.find(
          (x) =>
            !shown.includes(x) && shown.some((y) => !!pairOrder(y.a, x.a) || !!pairOrder(x.a, y.a)),
        );
        st = {
          ids: inOrder(extra ? [...shown, extra] : shown).map((x) => x.a.id),
          done: new Set(),
        };
        stepsBy.set(key, st);
      }
      const steps = st;
      stepsNow = steps;
      shown = steps.ids
        .filter((id) => !steps.done.has(id))
        .flatMap((id) => list.filter((x) => x.a.id === id));
    }
    const prep = w.you.prep ?? [];
    const finished = !!stepsNow?.ids.length && !shown.length;
    return h(
      'div',
      { class: 'dig-spot' },
      key !== undefined
        ? stepsNow?.ids.length
          ? h(
              'h4',
              { class: `dig-plan__h${finished ? ' is-done' : ''}`, 'data-spot': 'head' },
              finished ? '整った' : 'その場で',
            )
          : null
        : null,
      finished ? h('p', { class: 'dig-ready' }, voiceOf(READY, w, 'ready')) : null,
      shown.length
        ? shown.map(({ a, fit }, i) =>
            gauge && gauge.key === a.id
              ? gaugeRow(a, fit)
              : h(
                  'button',
                  {
                    type: 'button',
                    class: `dig-spot__row is-${a.kind}${fit ? ' is-fit' : ''}`,
                    'data-spot': a.id,
                    'aria-label': `${SPOT_VERB[a.kind]}：${a.label}　${a.gain}`,
                    disabled: !!gauge,
                    onclick: () => startGauge(a),
                  },
                  h('span', { class: 'dig-spot__what' }, a.label),
                  h('span', { class: 'dig-spot__gain' }, ...heals(a.gain)),
                  spotExtra(w, a, i === 0 ? undefined : shown[i - 1]?.a, route),
                ),
          )
        : key !== undefined
          ? null
          : h('p', { class: 'dig-quiet dig-spot__none' }, 'いま、ここで足りないものはない。'),
      prep.length || (key === undefined && list.length > shown.length)
        ? h(
            'p',
            { class: 'dig-spot__foot' },
            prep.length
              ? h(
                  'span',
                  { class: 'dig-prep' },
                  `備え：${prep.map((x) => `${x.name}${x.mult && x.mult !== 1 ? ` ×${x.mult}` : ''}`).join('・')}`,
                )
              : null,
            key === undefined && list.length > shown.length
              ? button(`ほか ${list.length - shown.length}（手札で）`, () => {
                  deckOpen = true;
                  render();
                })
              : null,
          )
        : null,
    );
  }

  /**
   * 並びが変わった行を、前の位置から今の位置へ滑らせる（何が上がったかが目で追える）。
   * 位置は「その場で」の枠の中での高さで測る（上の欄が伸び縮みしても動かない）。
   */
  function spotSpots(): Map<string, number> {
    const at = new Map<string, number>();
    for (const el of side.querySelectorAll<HTMLElement>('[data-spot]')) {
      const box = el.parentElement?.getBoundingClientRect().top ?? 0;
      at.set(el.dataset.spot ?? '', el.getBoundingClientRect().top - box);
    }
    return at;
  }
  function slideSpots(before: Map<string, number>): void {
    if (!before.size || still()) return;
    for (const el of side.querySelectorAll<HTMLElement>('[data-spot]')) {
      const was = before.get(el.dataset.spot ?? '');
      if (was === undefined) {
        el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
        continue;
      }
      const box = el.parentElement?.getBoundingClientRect().top ?? 0;
      const dy = was - (el.getBoundingClientRect().top - box);
      if (Math.abs(dy) > 1)
        el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], {
          duration: 280,
          easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
        });
    }
  }

  /**
   * 整える：地図の場所に、手持ちの札（枠と後ろ）を全部広げる。札のエピテットは
   * 剥がして手に戻せ、手元のエピテットを選ぶと、刻める札が浮く（押すと刻む）。
   */
  function renderDeck(): void {
    deckView.replaceChildren();
    viewSwitch.replaceChildren();
    const w = game?.world;
    const can = !!w && screen === 'play' && !w.enc && !w.ending;
    if (!can) deckOpen = false;
    viewSwitch.hidden = !can;
    if (w && can) {
      // 手札に手を入れる理由があるとき（尽きた札・刻めるエピテット）は、琥珀の点を添える。
      const cue = dryCount(w) > 0 || w.you.epithets.length > 0;
      const tab = (label: string, on: boolean, next: boolean, extra = '') =>
        h(
          'button',
          {
            type: 'button',
            class: `dig-switch__b${on ? ' is-on' : ''}${extra}`,
            'aria-pressed': on ? 'true' : 'false',
            onclick: () => {
              if (deckOpen === next) return;
              deckOpen = next;
              if (!next && !(aim?.kind === 'inscribe' && epithetDef(aim.ep)?.place)) aim = null;
              render();
            },
          },
          label,
        );
      fill(viewSwitch, [
        tab('地図', !deckOpen, false),
        tab(`手札 ${deckSize(w.you)}`, deckOpen, true, cue && !deckOpen ? ' is-cue' : ''),
        // 拾った札は、手札の切り替えの下にしばらく出る（手元の帯は畳まれているので）。
        now() - joined.at < 2.4
          ? h('span', { class: 'dig-joined dig-switch__new' }, `＋『${joined.name}』`)
          : null,
      ]);
    }
    const open = !!w && can && deckOpen;
    deckView.hidden = !open;
    if (!w || !open) return;
    // 受け取りのあいだの手札は、拾う札と手持ちを見比べるだけの場所。
    if (w.pending?.kind === 'reward') {
      fill(deckView, rewardDeck(w));
      return;
    }
    const a = aim?.kind === 'inscribe' ? aim : null;
    const d = a ? epithetDef(a.ep) : undefined;
    const all = [...w.you.cards.filter((c): c is Card => !!c), ...w.you.back];
    // 道を選んでいれば、その道で頼る札・尽きる札に印を（道を替えると、印も替わる）。
    const route = chosenRoute();
    const card = (c: Card) => {
      const def = cardDef(c.id);
      const live = !!a && !!d?.card && c.eps.length < PACE.stack;
      const lean = !!route?.lean.includes(c.uid);
      const wear = !!route?.wear.includes(c.uid);
      return h(
        'div',
        {
          class: `dig-card${c.uses <= 0 ? ' is-spent' : ''}${live ? ' is-live' : a ? ' is-dim' : ''}${lean ? ' is-lean' : ''}`,
          title: [def.sig, def.flavor].filter(Boolean).join('\n'),
          ...(live
            ? pressable(() => {
                aim = null;
                send({ c: 'inscribe', ep: a?.ep ?? '', uid: c.uid });
              })
            : {}),
        },
        h(
          'span',
          { class: 'dig-card__head' },
          h('b', { class: 'dig-card__name' }, def.name),
          h('span', { class: 'dig-card__key' }, `${c.uses}/${c.max}`),
        ),
        pips(c),
        lean || wear
          ? h(
              'span',
              { class: 'dig-card__route' },
              [lean ? 'この道で頼る' : '', wear ? 'この道で尽きる' : ''].filter(Boolean).join('・'),
            )
          : null,
        badges(def.ready),
        h('span', { class: 'dig-card__fx' }, heals(fxText(def.ready))),
        cardEps(c, ui),
      );
    };
    // 上から：手持ちの札（手元のエピテットと、札ごとの剥がす）→ 持ち物 → 記憶。
    fill(deckView, [
      h(
        'div',
        { class: 'dig-handview__head' },
        h('h3', {}, `手持ちの札 ${deckSize(w.you)}/${deckCap(w.you)}`),
        buildsOf(w.you).length
          ? h(
              'span',
              { class: 'dig-quiet' },
              `構成 ${buildsOf(w.you)
                .map((b) => `《${b.name}》`)
                .join('')}`,
            )
          : null,
      ),
      w.you.epithets.length
        ? h(
            'p',
            { class: 'dig-deck__held' },
            h('span', { class: 'dig-pills__label' }, '手元のエピテット'),
            [...new Set(w.you.epithets)].map((ep) => {
              const on = { kind: 'inscribe' as const, ep };
              const n = w.you.epithets.filter((x) => x === ep).length;
              const ed = epithetDef(ep);
              return h(
                'button',
                {
                  type: 'button',
                  class: `dig-pill dig-pill--ep is-${ed ? epTier(ed) : 'plain'}${sameAim(aim, on) ? ' is-chosen' : ''}`,
                  'aria-pressed': sameAim(aim, on) ? 'true' : 'false',
                  title: facetLines(ep),
                  onclick: () => {
                    aim = sameAim(aim, on) ? null : on;
                    render();
                  },
                },
                `《${ed?.name ?? ep}》`,
                n > 1 ? h('i', { class: 'dig-pill__n' }, `×${n}`) : null,
              );
            }),
            a ? h('span', { class: 'dig-amber' }, `刻む札を押す：${d?.card?.text ?? ''}`) : null,
          )
        : null,
      h('div', { class: 'dig-hand is-preview' }, all.map(card)),
      h(
        'p',
        { class: 'dig-handview__note' },
        '遭遇のたびに、この七枚から五枚が配られる。使い切った札は、休むか、回数を増やすエピテットが宿るまで眠ったままになる。',
      ),
      w.you.items.length
        ? h('div', { class: 'dig-deck__sec' }, h('h3', {}, '持ち物'), gearRows(w, ui))
        : null,
      w.you.perms.length
        ? h(
            'div',
            { class: 'dig-deck__sec' },
            h('h3', {}, '記憶'),
            h(
              'div',
              { class: 'dig-deck__mems' },
              w.you.perms.map((pid) => {
                const list = w.you.permEps[pid] ?? [];
                const live = !!a && !!d?.memory && list.length < PACE.stack;
                const eps = list.map((e) => `《${epithetDef(e)?.name ?? e}》`).join('');
                if (!live)
                  return h(
                    'span',
                    {
                      class: `dig-mem${permDef(pid)?.bad ? ' is-bad' : ''}${a ? ' is-dim' : ''}`,
                      title: permDef(pid)?.text,
                    },
                    `${eps}${permDef(pid)?.name ?? pid}`,
                  );
                return h(
                  'button',
                  {
                    type: 'button',
                    class: `dig-mem is-live${permDef(pid)?.bad ? ' is-bad' : ''}`,
                    title: `${permDef(pid)?.text ?? ''}\n刻むと：${d?.memory?.text ?? ''}`,
                    onclick: () => {
                      if (!a) return;
                      aim = null;
                      send({ c: 'inscribe', ep: a.ep, perm: pid });
                    },
                  },
                  `${eps}${permDef(pid)?.name ?? pid}`,
                );
              }),
            ),
          )
        : null,
    ]);
  }

  /**
   * 受け取りの段取り。地図はそのまま、右の欄に判（結末の一語）→ 余韻 → 品が
   * 一つずつ押され、手札の場所（下の帯）に拾える札が伏せたまま並んで、一枚ずつ
   * 表を向ける。動きはどれも「何が手に入ったか」を順に伝えるためだけのもの。
   * 描き直しても頭からやり直さないよう、受け取りが始まってからの経過で遅れを引く
   * （過ぎたぶんは負の遅れで、途中から続く）。
   */
  let rewardAt = -9;
  function beat(d: number): { cls: string; style?: string } {
    const late = now() - rewardAt;
    if (still() || late > d + 0.7) return { cls: '' };
    return { cls: ' is-beat', style: `--d:${(d - late).toFixed(2)}s` };
  }
  /** 受け取りの、品と札の時刻（秒）。 */
  const spoilAt = (k: number) => 0.35 + k * 0.16;
  const cardAt = (n: number, k: number) => spoilAt(n) + 0.15 + k * 0.22;

  /** 拾える札の表（手元の札と同じ顔）。伏せた裏から、表を向ける。 */
  function sceneCard(
    id: string,
    opts: {
      on?: () => void;
      eps?: readonly string[];
      lucky?: boolean;
      chosen?: boolean;
      d: number;
    },
  ): HTMLElement {
    const def = cardDef(id);
    const n = def.uses + epUses(opts.eps ?? []);
    const card: Card = { uid: 0, id, uses: n, max: n, marks: {}, eps: [...(opts.eps ?? [])] };
    const b = beat(opts.d);
    return h(
      'button',
      {
        type: 'button',
        class: `dig-card dig-scene__card${b.cls ? ' is-flip' : ''}${opts.chosen ? ' is-chosen' : ''}${opts.lucky ? ' is-lucky' : ''}`,
        style: b.style,
        title: [def.sig, def.flavor].filter(Boolean).join('\n'),
        onclick: opts.on,
      },
      h(
        'span',
        { class: 'dig-card__head' },
        h('b', { class: 'dig-card__name' }, def.name),
        opts.chosen ? h('span', { class: 'dig-card__mark' }, '拾う') : null,
        h('span', { class: 'dig-card__key' }, `${n} 回`),
      ),
      opts.eps?.length
        ? h(
            'span',
            { class: 'dig-scene__inked' },
            opts.eps.map((e) => epChip(e)),
          )
        : null,
      opts.lucky ? luckyTag() : null,
      def.legend ? h('span', { class: 'dig-offer__lead' }, `主役『${def.legend}』`) : null,
      pips(card),
      badges(def.ready),
      h('span', { class: 'dig-card__fx' }, heals(fxText(def.ready))),
      opts.eps?.length
        ? h(
            'span',
            { class: 'dig-card__next' },
            opts.eps.map((e) => epithetDef(e)?.card?.text ?? '').join(' '),
          )
        : null,
    );
  }

  /**
   * 受け取りの手順は三つ：
   *   1 拾う一枚を選ぶ（押しても、まだ拾わない）
   *   2 手持ちがいっぱいなら、手放す一枚を選ぶ（尽きた札から並ぶ）
   *   3 確かめて受け取る（釦に、何を拾って何を手放すかがそのまま書いてある）
   * 地図のときは下の帯に、手札のときは左の欄に、同じ手順が一か所にまとまって出る。
   */
  function rewardState(w: World) {
    const p = w.pending;
    if (p?.kind !== 'reward') return null;
    const offers = [...p.cards, ...(p.lucky ? [p.lucky] : [])];
    const full = !deckRoom(w.you) && !w.you.cards.some((c) => !c);
    const isCard = !!pickId && offers.includes(pickId);
    const isTool = !!pickId && p.tools.includes(pickId);
    const needDrop = isCard && full;
    const all = [...w.you.cards.flatMap((c) => (c ? [c] : [])), ...w.you.back].sort(
      (a, b) => a.uses - b.uses,
    );
    const drop = all.find((c) => c.uid === dropUid);
    const ready = isTool || (isCard && (!needDrop || !!drop));
    const pickName =
      isCard && pickId
        ? cardDef(pickId).name
        : isTool && pickId
          ? (gearOf(pickId)?.name ?? '')
          : '';
    const step = !pickId ? 1 : needDrop && !drop ? 2 : 3;
    const stepText =
      step === 1
        ? full
          ? '拾う一枚を選ぶ（手持ちはいっぱいなので、あとで一枚手放す）'
          : '拾う一枚を選ぶ'
        : step === 2
          ? `『${pickName}』の代わりに手放す一枚を選ぶ`
          : needDrop && drop
            ? `『${pickName}』を拾い、『${cardDef(drop.id).name}』を手放す`
            : `『${pickName}』を拾う`;
    return { p, offers, full, isCard, isTool, needDrop, all, drop, ready, step, stepText };
  }

  const selectOffer = (id: string) => () => {
    pickId = pickId === id ? null : id;
    dropUid = null;
    render();
  };
  const selectDrop = (uid: number) => () => {
    dropUid = dropUid === uid ? null : uid;
    render();
  };

  /** 拾える札と道具（地図のときは伏せたまま並んで表を向け、手札のときは静かに並ぶ）。 */
  function offerCards(w: World, animate: boolean): HTMLElement[] {
    const st = rewardState(w);
    if (!st) return [];
    const n = spoils.list.length;
    return [
      ...st.offers.map((id, k) =>
        sceneCard(id, {
          on: selectOffer(id),
          eps: st.p.inked?.[id],
          lucky: id === st.p.lucky,
          chosen: pickId === id,
          d: animate ? cardAt(n, k) : -9,
        }),
      ),
      ...st.p.tools.map((id, k) => {
        const g = gearOf(id);
        const b = animate ? beat(cardAt(n, st.offers.length + k)) : { cls: '' };
        return h(
          'button',
          {
            type: 'button',
            class: `dig-card dig-scene__card is-tool${b.cls ? ' is-flip' : ''}${pickId === id ? ' is-chosen' : ''}`,
            style: 'style' in b ? b.style : undefined,
            disabled: !itemRoom(w.you, id),
            'aria-pressed': pickId === id ? 'true' : 'false',
            title: g?.flavor,
            onclick: selectOffer(id),
          },
          h(
            'span',
            { class: 'dig-card__head' },
            h('b', { class: 'dig-card__name' }, g?.name ?? id),
            pickId === id ? h('span', { class: 'dig-card__mark' }, '拾う') : null,
            h('span', { class: 'dig-card__key' }, `道具・${g?.uses ?? 1} 回`),
          ),
          h('span', { class: 'dig-card__fx' }, g?.text ?? ''),
        );
      }),
    ];
  }

  /** 手順の段と、確かめる釦（何も拾わない釦も）。 */
  /** 受け取る（選んだ一枚を拾い、要れば一枚手放す）。 */
  function claimPicked(w: World): void {
    const st = rewardState(w);
    if (!st?.ready || !pickId) return;
    const cmd = st.isTool
      ? { c: 'claim' as const, take: reward.take, help: reward.help, tool: pickId }
      : {
          c: 'claim' as const,
          take: reward.take,
          help: reward.help,
          card: pickId,
          drop: st.drop?.uid,
        };
    pickId = null;
    dropUid = null;
    deckOpen = false;
    send(cmd);
  }

  /** 何も拾わずに進む。 */
  function claimNone(): void {
    pickId = null;
    dropUid = null;
    deckOpen = false;
    send({ c: 'claim', take: reward.take, help: reward.help });
  }

  function confirmBar(w: World): HTMLElement | null {
    const st = rewardState(w);
    if (!st) return null;
    const confirm = () => claimPicked(w);
    return h(
      'div',
      { class: 'dig-confirm' },
      h(
        'p',
        { class: 'dig-confirm__step' },
        h('b', {}, String(st.step)),
        h('span', {}, st.stepText),
      ),
      button('何も拾わずに進む', claimNone),
      button('受け取る', confirm, { class: 'dig-go', disabled: !st.ready }),
    );
  }

  /** 受け取りの下の帯（地図のとき）：拾える札、手放す一枚、確かめる釦。 */
  function rewardTray(w: World): Child[] {
    const st = rewardState(w);
    if (!st || (!st.offers.length && !st.p.tools.length)) return [];
    // 手放す一枚は、拾える札の右の空いた列に並ぶ（札が四枚以上なら、その下の段に）。
    const n = st.offers.length + st.p.tools.length;
    return [
      h(
        'div',
        { class: 'dig-hand dig-offers' },
        offerCards(w, true),
        st.needDrop ? dropPicks(st, n <= 3 ? n + 1 : 1) : null,
      ),
      toolBlocked(w, st) ? rewardItems(w) : null,
      confirmBar(w),
    ];
  }

  /** 持ち物がいっぱいで、拾えない道具があるか（そのときだけ、持ち物を拾える札のすぐ下に出す）。 */
  const toolBlocked = (w: World, st: NonNullable<ReturnType<typeof rewardState>>) =>
    st.p.tools.some((id) => !itemRoom(w.you, id));

  /** 受け取りの持ち物の節（使えば枠が空き、道具を拾えるようになる）。 */
  function rewardItems(w: World): HTMLElement | null {
    if (!w.you.items.length) return null;
    return h(
      'div',
      { class: 'dig-deck__sec' },
      h('h3', { title: '使うと、持ち物の枠が空く' }, '持ち物'),
      gearRows(w, ui),
    );
  }

  /** 地図のときの、手放す一枚の候補（尽きた札から）。from は並ぶ列の始まり。 */
  function dropPicks(st: NonNullable<ReturnType<typeof rewardState>>, from: number): HTMLElement {
    return h(
      'div',
      { class: 'dig-scene__row dig-scene__drop', style: `--from:${from}` },
      st.all.map((c) =>
        h(
          'button',
          {
            type: 'button',
            class: `dig-scene__pick${c.uses <= 0 ? ' is-spent' : ''}${dropUid === c.uid ? ' is-chosen' : ''}`,
            'aria-pressed': dropUid === c.uid ? 'true' : 'false',
            title: fxText(cardDef(c.id).ready),
            onclick: selectDrop(c.uid),
          },
          c.eps.map((e) => epChip(e)),
          `${cardDef(c.id).name} ${c.uses}/${c.max}`,
          c.uses <= 0 ? h('i', { class: 'dig-quiet' }, ' 尽きた') : null,
        ),
      ),
    );
  }

  /**
   * 受け取りの左の欄（手札のとき）。上から：拾える札 → 手持ちの札 → 持ち物 → 手順の一文
   * （持ち物がいっぱいで拾えない道具があるときだけ、持ち物を拾える札のすぐ下へ）。
   * 受け取りは保留のまま整えられる：持ち物を使って枠を空ける、手放す札からエピテットを
   * 剥がしておく（剥がす釦は、整えるの手札と同じく札の中）。手放す一枚は札を押して選ぶ。
   */
  function rewardDeck(w: World): Child[] {
    const st = rewardState(w);
    if (!st) return [];
    const blocked = toolBlocked(w, st);
    return [
      h('div', { class: 'dig-handview__head' }, h('h3', {}, '拾える札')),
      h('div', { class: 'dig-hand is-preview dig-offers' }, offerCards(w, false)),
      blocked ? rewardItems(w) : null,
      h(
        'div',
        { class: 'dig-deck__sec' },
        h('h3', {}, `手持ちの札 ${deckSize(w.you)}/${deckCap(w.you)}`),
        h(
          'div',
          { class: 'dig-hand is-preview is-droppick' },
          st.all.map((c) => {
            const def = cardDef(c.id);
            const live = st.needDrop;
            const chosen = dropUid === c.uid;
            return h(
              'div',
              {
                class: `dig-card${c.uses <= 0 ? ' is-spent' : ''}${live ? ' is-live' : ' is-still'}${chosen ? ' is-chosen is-drop' : ''}`,
                'aria-pressed': live ? (chosen ? 'true' : 'false') : undefined,
                title: [def.sig, def.flavor].filter(Boolean).join('\n'),
                ...(live ? pressable(selectDrop(c.uid)) : {}),
              },
              h(
                'span',
                { class: 'dig-card__head' },
                h('b', { class: 'dig-card__name' }, def.name),
                chosen ? h('span', { class: 'dig-card__mark' }, '手放す') : null,
                h('span', { class: 'dig-card__key' }, `${c.uses}/${c.max}`),
              ),
              pips(c),
              badges(def.ready),
              h('span', { class: 'dig-card__fx' }, heals(fxText(def.ready))),
              cardEps(c, ui),
            );
          }),
        ),
      ),
      blocked ? null : rewardItems(w),
      confirmBar(w),
    ];
  }

  /** 記憶への刻み先（向き合っているあいだは手札の一覧が開かないので、手元の帯に出す）。 */
  function memoryTargets(w: World, ep: string): HTMLElement[] {
    const d = epithetDef(ep);
    if (!d?.memory) return [];
    return w.you.perms
      .filter((pid) => (w.you.permEps[pid] ?? []).length < PACE.stack)
      .map((pid) =>
        button(
          `記憶《${permDef(pid)?.name ?? pid}》に刻む：${d.memory?.text ?? ''}`,
          () => {
            aim = null;
            send({ c: 'inscribe', ep, perm: pid });
          },
          { class: 'dig-ink-foe is-live' },
        ),
      );
  }

  /** そのエピテットを、いまどこかに刻めるか（札・記憶・先の部屋・出来事・相手）。 */
  function canInk(w: World, ep: string): boolean {
    const d = epithetDef(ep);
    return (
      w.you.cards.some((_, i) => aimOk(w, { kind: 'inscribe', ep }, i)) ||
      (!w.enc && !!d?.card && w.you.back.some((c) => c.eps.length < PACE.stack)) ||
      (!!d?.memory && w.you.perms.some((p) => (w.you.permEps[p] ?? []).length < PACE.stack)) ||
      w.map.some((m) => nodeInkable(w, ep, m)) ||
      (w.pending?.kind === 'story' && !!d?.story && w.pending.eps.length < 2) ||
      foeInkable(w, ep)
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

  /**
   * 受け取りの右の欄：判（結末の一語）→ 余韻 → 品が一つずつ押される。拾える
   * 札は下の帯（手札の場所）に並ぶ。持ち帰る記憶と、頼って満たす札もここで。
   */
  function rewardPanel(w: World): HTMLElement {
    const p = w.pending;
    if (p?.kind !== 'reward') return h('div');
    const blue = p.outcome === 'trusted' || p.outcome === 'uncovered';
    const aft = AFTER[p.outcome];
    // 共鳴の数は原因で、見返りではない（見返りの金や回数は、別に並んでいる）。
    const list = spoils.list.filter((x) => !/^共鳴 \d+$/.test(x));
    const offers = [...p.cards, ...(p.lucky ? [p.lucky] : [])];
    const head = beat(0);
    const after = beat(0.2);
    const rows = beat(spoilAt(list.length));
    const el = h(
      'div',
      { class: 'dig-reward' },
      h(
        'div',
        { class: `dig-scene__head${head.cls}`, style: head.style },
        h('span', { class: 'dig-scene__label' }, '決着'),
        h('b', { class: `dig-scene__word${blue ? ' is-blue' : ''}` }, OUTCOME_NAME[p.outcome]),
        h('span', { class: 'dig-scene__who' }, foeDef(p.npc).name),
      ),
      aft
        ? h(
            'p',
            { class: `dig-scene__after${after.cls}`, style: after.style },
            h('b', {}, aft.name),
            h('span', {}, aft.text),
          )
        : null,
      SETTLED[p.outcome]
        ? h(
            'p',
            { class: `dig-host dig-host--aside${after.cls}`, style: after.style },
            voiceOf(SETTLED[p.outcome] ?? [], w, `settled:${p.npc}`),
          )
        : null,
      list.length
        ? h(
            'div',
            { class: 'dig-scene__spoils' },
            list.map((x, k) => {
              const coin = /^(?:戦利品 )?金 (\d+)$/.exec(x);
              const b = beat(spoilAt(k));
              return h(
                'span',
                {
                  class: `dig-spoil dig-scene__spoil${/^(金|戦利品|エピテット《|共鳴)|》/.test(x) ? ' is-key' : ''}${b.cls}`,
                  style: b.style,
                  'data-count': coin && b.cls ? coin[1] : undefined,
                  'data-delay': coin && b.cls ? String(spoilAt(k) - (now() - rewardAt)) : undefined,
                },
                coin ? `金 +${coin[1]}` : x,
              );
            }),
          )
        : null,
      p.take.length
        ? h(
            'div',
            { class: `dig-scene__row${rows.cls}`, style: rows.style },
            h('span', { class: 'dig-scene__label' }, '持ち帰る記憶'),
            p.take.map((id) =>
              button(
                permDef(id)?.name ?? id,
                () => {
                  reward.take = reward.take === id ? undefined : id;
                  render();
                },
                {
                  class: `dig-scene__pick${reward.take === id ? ' is-chosen' : ''}`,
                  'aria-pressed': reward.take === id ? 'true' : 'false',
                  title: permDef(id)?.text,
                },
              ),
            ),
          )
        : null,
      p.help
        ? h(
            'div',
            { class: `dig-scene__row${rows.cls}`, style: rows.style },
            h('span', { class: 'dig-scene__label', title: '頼ると借りができる' }, '頼って満たす札'),
            [...w.you.cards, ...w.you.back].map((c, i) =>
              c && c.uses < c.max && i < 5
                ? button(
                    cardName(c),
                    () => {
                      reward.help = reward.help === i ? undefined : i;
                      render();
                    },
                    {
                      class: `dig-scene__pick${reward.help === i ? ' is-chosen' : ''}`,
                      'aria-pressed': reward.help === i ? 'true' : 'false',
                    },
                  )
                : null,
            ),
          )
        : null,
      // 拾える札が無ければ、ここで受け取る（あるときは、下の帯か手札の欄で確かめる）。
      offers.length || p.tools.length
        ? null
        : h(
            'div',
            { class: `dig-scene__foot${rows.cls}`, style: rows.style },
            button(
              '受け取って進む',
              () => send({ c: 'claim', take: reward.take, help: reward.help }),
              {
                class: 'dig-go',
              },
            ),
          ),
    );
    if (now() - rewardAt < 0.2) {
      if (!still())
        list.forEach((_, k) => {
          window.setTimeout(() => sound.resonate(k * 2), spoilAt(k) * 1000);
        });
      window.setTimeout(() => countCoins(side), 0);
    }
    return el;
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

  // ─── 終わり ─────────────────────────────────────────────────

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

  /**
   * この夜の一枚。手元に残った主役の札のうち、章がいちばん進んだ一枚を、刻まれた語と
   * 越えた章の一文とともに（押せない。次の挑戦には持ち越さない）。章が進んでいなければ出さない。
   */
  function nightCard(w: World): HTMLElement | null {
    let best: { c: Card; ch: number; p: number } | null = null;
    for (const c of w.you.cards) {
      if (!c || !cardDef(c.id).legend) continue;
      const ch = c.marks.ch ?? 0;
      const p = c.marks.p ?? 0;
      if (ch <= 0) continue;
      if (!best || ch > best.ch || (ch === best.ch && p > best.p)) best = { c, ch, p };
    }
    if (!best) return null;
    const ls = legendState(w.you, best.c.id);
    if (!ls) return null;
    const done = ls.legend.chapters.slice(0, best.ch);
    const last = done[done.length - 1];
    return h(
      'figure',
      { class: 'dig-night' },
      h('figcaption', { class: 'dig-night__h' }, 'この夜の一枚'),
      h(
        'p',
        { class: 'dig-night__name' },
        h('b', {}, `『${cardDef(best.c.id).name}』`),
        best.c.eps.length
          ? h(
              'span',
              {},
              best.c.eps.map((e) => epChip(e)),
            )
          : null,
      ),
      h(
        'p',
        { class: 'dig-night__ch' },
        `『${ls.legend.title}』${best.ch >= ls.legend.chapters.length ? ' 完' : ` 第${best.ch}章まで`}`,
      ),
      last ? h('p', { class: 'dig-night__line' }, last.line) : null,
    );
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
      nightCard(w),
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
    if (!game || screen !== 'play') {
      tray.hidden = false;
      return;
    }
    const w = staged ?? game.world;
    // 手札の帯は、向き合っているあいだだけ。受け取りでは、拾える札がここに並ぶ。
    // ほかのときは畳む（手持ちは、整えるで地図の場所に広げる）。
    if (!w.enc) {
      const offers = w.pending?.kind === 'reward' && !w.ending && !deckOpen ? rewardTray(w) : [];
      tray.hidden = !offers.length;
      fill(tray, offers);
      return;
    }
    tray.hidden = false;
    const builds = buildsOf(w.you);
    const deal = dealt();
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
          h('span', {}, '空き'),
        );
      const d = cardDef(c.id);
      const spent = c.uses <= 0;
      const was = swapped(slot);
      const acting = w.enc?.phase === 'act' && w.enc.who === 'you';
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
          class: `dig-card ${cardState(w, slot)}${spent ? ' is-spent' : ''}${d.legend ? ' is-lead' : ''}${opened === slot ? ' is-open' : ''}${fresh(slot) ? ' is-new' : ''}${deal ? ' is-dealt' : ''}${was !== null ? ' is-swapped' : ''}${leans ? ' is-lean' : ''}${armedSlot === slot ? ' is-armed' : ''}`,
          style: deal ? `--deal:${slot}` : undefined,
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
          title: [
            spent ? `${d.spentName}：${fxText(d.spent)}` : fxText(d.ready),
            !spent && d.spent.length ? `眠りぎわ　${fxText(d.spent)}` : '',
            d.sig,
            d.flavor,
            // タグは説明の最後に（札の上には浮かせない。説明と重なるので）。
            cardTags(c)
              .map((t) => `［${TAG_NAME[t]}］`)
              .join(''),
          ]
            .filter(Boolean)
            .join('\n'),
          'aria-label': `${slot + 1}　${cardName(c, spent)}`,
        },
        was !== null
          ? h('span', { class: 'dig-card__swap' }, was ? `『${was}』と入れ替え` : '入れ替え')
          : null,
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
        // 向き合っているあいだは、動く数だけで選べるようにする（効き目の文・タグ・眠りぎわは、
        // 触れれば出る）。勘で続けて打てるように、札の顔は軽く。
        acting
          ? null
          : h(
              'span',
              { class: 'dig-card__tags' },
              cardTags(c)
                .map((t) => `［${TAG_NAME[t]}］`)
                .join(''),
              (d.arch ?? []).map((a) => `〈${ARCH_NAME[a]}〉`).join(''),
            ),
        acting
          ? null
          : h(
              'span',
              { class: 'dig-card__fx' },
              heals(spent ? `${d.spentName}：${fxText(d.spent)}` : fxText(d.ready)),
            ),
        !acting && !spent && d.spent.length
          ? h('span', { class: 'dig-card__sleep' }, `眠りぎわ　${fxText(d.spent)}`)
          : null,
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
      armDetail(w, encView()),
      h(
        'div',
        { class: 'dig-held' },
        aim
          ? h(
              'p',
              { class: 'dig-amber' },
              aimText(),
              ' ',
              // 向き合っているあいだは、相手も刻む先になる。
              aim.kind === 'inscribe' && foeInkable(w, aim.ep)
                ? button(
                    `相手に刻む：${epithetDef(aim.ep)?.foe?.text ?? ''}`,
                    () => {
                      const ep = aim?.kind === 'inscribe' ? aim.ep : '';
                      aim = null;
                      send({ c: 'inscribe', ep, foe: true });
                    },
                    { class: 'dig-ink-foe is-live' },
                  )
                : null,
              // 記憶へも、向き合っているあいだに刻める（手番は使わない）。案内と同じ場所に。
              aim.kind === 'inscribe' && w.enc ? memoryTargets(w, aim.ep) : null,
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
        ),
      ),
    ]);
  }

  /** 手元のエピテットの列。地図の上では刻む先を選び、向き合っているあいだは相手に刻む。 */
  function epithetRow(w: World): HTMLElement | null {
    const e = w.enc;
    if (e && !(e.phase === 'act' && e.who === 'you')) return null;
    const kinds = [...new Set(w.you.epithets)];
    if (!kinds.length) return null;
    return h(
      'span',
      { class: 'dig-pills__group dig-pills__group--ep' },
      h('span', { class: 'dig-pills__label' }, 'エピテット'),
      kinds.map((ep) => {
        const n = w.you.epithets.filter((x) => x === ep).length;
        const d = epithetDef(ep);
        const on = { kind: 'inscribe' as const, ep };
        return h(
          'button',
          {
            type: 'button',
            // 押すと刻む先を選ぶ段になり、刻める先だけが浮いて、ほかは沈む。
            onclick: () => choose(on),
            ...chosen(on),
            class: `dig-pill dig-pill--ep is-${d ? epTier(d) : 'plain'}${sameAim(aim, on) ? ' is-chosen' : ''}${
              !profile.hints.includes('epithet') ? ' is-fresh' : ''
            }`,
            onmouseenter: () => {
              if (aim || sameAim(hoverAim, on)) return;
              hoverAim = on;
              renderTray();
            },
            onmouseleave: () => {
              if (!hoverAim) return;
              hoverAim = null;
              renderTray();
            },
            disabled: !canInk(w, ep),
            title: facetLines(ep),
            draggable: 'true',
            ondragstart: (ev: Event) =>
              (ev as DragEvent).dataTransfer?.setData('text/plain', `ep:${ep}`),
          },
          h('i', { class: 'dig-pill__plus', 'aria-hidden': 'true' }, '＋'),
          `《${d?.name ?? ep}》`,
          n > 1 ? h('i', { class: 'dig-pill__n' }, `×${n}`) : null,
        );
      }),
    );
  }

  function aimText(): string {
    if (!aim) return '';
    if (aim.kind === 'inscribe')
      return game?.world.enc
        ? `《${epithetDef(aim.ep)?.name}》を刻む先を選ぶ（白い札・記憶・相手）`
        : `《${epithetDef(aim.ep)?.name}》を刻む先を選ぶ（白い札・記憶・地図の先の部屋）`;
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
        return !!c && !!d?.card && c.eps.length < PACE.stack;
      }
      case 'rest':
        return !!c;
      case 'alter':
        return slot === a.slot;
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
    if (w.enc?.phase === 'act' && w.you.cards[slot]) {
      // 狭い画面では、一度目は構えるだけ（相手の棒に、動く分が映る）。二度目で切る。
      if (narrow() && armedSlot !== slot) {
        armedSlot = slot;
        hoverSlot = slot;
        render();
        return;
      }
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
    // 下に帯は足さない（地図の高さが変わると視点が変わる）。ヒントは地図の欄の下端に、
    // 上の案内帯と同じ作法で重ね、「この夜に入る」は右の欄の下端に重ねて、下端を揃える。
    // 狭い画面では地図が低く、重ねると半分が隠れるので、地図のすぐ下（脇の欄の頭）に置く。
    const hint = (): Element[] => [
      h('b', {}, 'ヒント'),
      h(
        'span',
        {},
        '灯りを提げて底の見えない建物を十階ずつ下り、六つ目の区画の底にあたる B60 を抜ければ、ひとまずこの夜は越えたことになる。出会う相手とは殴り合うことも話をつけることもでき、手札とエピテットと記憶の組み方しだいで、同じ建物でも周回ごとに違う夜になる。',
      ),
    ];
    createHint.hidden = false;
    createHint.replaceChildren();
    fill(createHint, hint());
    // 手札を開いているあいだは、地図の場所に初めの手札を並べる。見た目は遊ぶときの
    // 手元と同じ（五枚の枠・見出しは脇の欄と同じ顔）で、押せない見本として。
    handView.replaceChildren();
    handView.hidden = !(j && handOpen);
    if (j && handOpen)
      fill(handView, [
        h(
          'div',
          { class: 'dig-handview__head' },
          h('h3', {}, `${j.name}の初めの手札`),
          button('地図に戻る', () => {
            handOpen = false;
            render();
          }),
        ),
        h(
          'div',
          { class: 'dig-hand is-preview' },
          j.cards.map((id, i) => previewCard(id, i)),
        ),
        h(
          'p',
          { class: 'dig-handview__note' },
          `この五枚に、入るときに配られる二枚を足した七枚が手持ちになる。遭遇のたびに五枚が配られ、二枚は出番を待つ。`,
        ),
      ]);
    const saved = loadRun();
    const pick = <T extends string>(
      label: string,
      list: readonly T[],
      cur: string,
      name: (id: T) => string,
      text: (id: T) => string,
      set: (id: T) => void,
      /** 横に並べる数（短い選択肢は詰めて並べる）。 */
      cols = 1,
    ) =>
      h(
        'fieldset',
        { class: `dig-pick${cols > 1 ? ` dig-pick--cols${cols}` : ''}` },
        h('legend', {}, label),
        h(
          'div',
          { class: 'dig-pick__list' },
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
        ),
      );
    fill(side, [
      h('p', { class: 'dig-create-hint is-narrow' }, hint()),
      section(
        '灯りを持つ者',
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
        // 名前と難度は最初に。難度の差は、構成ができあがる三区から効きはじめる。
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
        pick(
          '難度',
          ['0', '1', '2'] as const,
          String(create.depth),
          (id) => DIFFICULTY[Number(id)] ?? id,
          (id) =>
            [
              'ふつうに下りていけば、たいていは抜けられる',
              '三区から相手が一段手強くなり、受ける傷も重い',
              '三区から相手が二段手強くなり、傷はさらに重く、休んでも戻りが浅い',
            ][Number(id)] ?? '',
          (id) => {
            create.depth = Number(id);
          },
          3,
        ),
        pick(
          '職',
          allJobs().map((x) => x.id),
          create.job,
          (id) => jobDef(id)?.name ?? id,
          (id) => `〈${ARCH_NAME[JOB_ARCH[id] as Archetype] ?? ''}〉`,
          (id) => {
            create = { ...create, job: id, ...defaultSheet(id) };
          },
          2,
        ),
        // 能力値（目盛り）→ 職の一文。初めの札は、いつもの手元（下の帯）に並ぶ。
        j
          ? h(
              'div',
              { class: 'dig-stats' },
              Object.entries(j.innate).map(([k, v]) =>
                h(
                  'span',
                  { class: 'dig-stat' },
                  h('b', {}, k),
                  h(
                    'span',
                    { class: 'dig-stat__pips', 'aria-label': String(v) },
                    Array.from({ length: 6 }, (_, i) => h('i', { class: i < v ? 'is-on' : '' })),
                  ),
                ),
              ),
            )
          : null,
        j ? h('p', { class: 'dig-job-text' }, j.text) : null,
        j
          ? h(
              'p',
              { class: 'dig-create-hand' },
              button(handOpen ? '手札を閉じる' : '手札を見る', () => {
                handOpen = !handOpen;
                render();
              }),
              h(
                'span',
                { class: 'dig-quiet' },
                `手持ち ${j.cards.length + START_BACK} 枚・遭遇ごとに五枚`,
              ),
            )
          : null,
        pick(
          '持って入る記憶',
          ORIGINS[create.job] ?? [],
          create.origin,
          (id) => permDef(id)?.name ?? id,
          (id) => permDef(id)?.text ?? '',
          (id) => {
            create.origin = id;
          },
        ),
        pick(
          '持って入るエピテット',
          JOB_EPITHETS[create.job] ?? [],
          create.ep,
          (id) => `《${epithetDef(id)?.name ?? id}》`,
          (id) => epithetDef(id)?.card?.text ?? '',
          (id) => {
            create.ep = id;
          },
        ),
        pick(
          '持って入る品',
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
          h('input', {
            type: 'checkbox',
            checked: create.daily,
            onchange: (ev: Event) => {
              create.daily = (ev.target as HTMLInputElement).checked;
            },
          }),
          ' 今日の夜に入る（誰が入っても同じ建物になる）',
        ),
        h(
          'div',
          { class: 'dig-start' },
          button('この夜に入る', () => begin(), { class: 'dig-go' }),
        ),
        profile.carry
          ? h(
              'p',
              { class: 'dig-quiet' },
              `前の夜から持ち越した記憶《${permDef(profile.carry)?.name ?? profile.carry}》も、一緒に入る。`,
            )
          : null,
      ),
    ]);
  }

  // ─── 全体 ───────────────────────────────────────────────────

  function render(): void {
    drawNow = true;
    // 描き直しで触れていた札が消えたら、説明も畳む。
    queueMicrotask(() => tips.sync());
    if (screen !== 'create') {
      handView.hidden = true;
      createHint.hidden = true;
    }
    renderBar();
    renderGuide();
    dialog.classList.toggle('is-create', screen === 'create');
    dialog.classList.toggle('dig-enc-on', !!game?.world.enc);
    dialog.classList.toggle('dig-pend-on', !game?.world.enc && !!game?.world.pending);
    // エピテットの刻む先を選んでいるあいだ、刻めないものは沈める。
    app.classList.toggle('is-aiming', aim?.kind === 'inscribe');
    if (screen === 'create') {
      renderCreate();
      return;
    }
    renderSide();
    renderTray();
    renderDeck();
    renderPanes();
  }

  /**
   * 狭い画面の切り替え。地図はいつも残し、その下を「札」か「情報」のどちらかに
   * 使う。場面が替わると、まず見るべきほうに戻す（遭遇は札、受け取りは結末から）。
   * 受け取りでは、下端に「前へ・次へ」（結末 → 拾う → 受け取る）。
   */
  let pane: 'hand' | 'info' = 'info';
  let paneAt = '';
  function renderPanes(): void {
    paneSwitch.replaceChildren();
    stepNav.replaceChildren();
    const w = game && screen === 'play' ? (staged ?? game.world) : null;
    const reward = w?.pending?.kind === 'reward' && !w.enc ? w : null;
    const two = !!w && !tray.hidden;
    const at = w ? (w.enc ? `enc:${w.enc.foe.id}` : (w.pending?.kind ?? 'map')) : '';
    if (at !== paneAt) {
      paneAt = at;
      pane = w?.enc ? 'hand' : 'info';
    }
    // 受け取りは「前へ・次へ」だけで順に進む（切り替えと二重にしない）。
    paneSwitch.hidden = !two || !!reward;
    dialog.classList.toggle('dig-panes-on', two);
    dialog.classList.toggle('dig-pane-hand', two && pane === 'hand');
    dialog.classList.toggle('dig-pane-info', two && pane === 'info');
    const go = (next: 'hand' | 'info') => {
      if (pane === next) return;
      pane = next;
      renderPanes();
    };
    if (two && !reward) {
      const [handName, infoName] = ['札', '相手'];
      const tab = (name: string, which: 'hand' | 'info') =>
        h(
          'button',
          {
            type: 'button',
            role: 'tab',
            class: `dig-panes__b${pane === which ? ' is-on' : ''}`,
            'aria-selected': pane === which ? 'true' : 'false',
            onclick: () => go(which),
          },
          name,
        );
      fill(paneSwitch, [tab(handName, 'hand'), tab(infoName, 'info')]);
    }
    stepNav.hidden = !reward;
    if (!reward) return;
    // 段：結末 → 拾う一枚 →（手持ちがいっぱいなら）手放す一枚。選び終わると「受け取る」。
    const st = rewardState(reward);
    const offers = two;
    const first = !offers || pane === 'info';
    // 点の数は最初から決まっている（手持ちがいっぱいなら、手放す段が一つ増える）。
    const steps = !offers ? 1 : st?.full ? 3 : 2;
    const now = first ? 1 : st?.needDrop && pickId ? 3 : 2;
    const label = first
      ? '結末'
      : st?.ready && pickId
        ? '受け取る'
        : st?.needDrop && pickId
          ? '手放す一枚を選ぶ'
          : '拾う一枚を選ぶ';
    // 何をする段かは、欄の中の一文（確かめる帯）と下端の釦が言う。ここは点だけ（読み上げには段の名）。
    fill(stepNav, [
      button('前へ', () => go('info'), { class: 'dig-stepnav__prev', disabled: first }),
      h(
        'span',
        { class: 'dig-stepnav__at', role: 'img', 'aria-label': `${now}/${steps} ${tr(label)}` },
        h(
          'span',
          { class: 'dig-stepnav__dots' },
          Array.from({ length: steps }, (_, i) => h('i', { class: i + 1 === now ? 'is-on' : '' })),
        ),
      ),
      first && offers
        ? button('次へ', () => go('hand'), { class: 'dig-stepnav__next dig-go' })
        : st?.ready && pickId
          ? button('受け取る', () => claimPicked(reward), { class: 'dig-stepnav__next dig-go' })
          : button(offers ? '拾わずに進む' : '受け取って進む', claimNone, {
              class: `dig-stepnav__next${offers ? '' : ' dig-go'}`,
            }),
    ]);
  }

  function onKey(ev: KeyboardEvent): void {
    if (!game || screen !== 'play' || ev.target instanceof HTMLInputElement) return;
    // 釦・リンクの上の Enter と Space は、その釦のもの（地図の移動や目押しに奪わない）。
    const onControl =
      ev.target instanceof Element &&
      !!ev.target.closest('button, a, select, textarea, [role="button"]:not(.dig-gauge)');
    const press = ev.key === 'Enter' || ev.key === ' ';
    if (onControl && press) return;
    if (gauge) {
      if (press) {
        ev.preventDefault();
        stopGauge();
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        cancelGauge();
      }
      return;
    }
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
      // 札を使わない手は、立ち去る（R）と、取引に応じる（T）だけ。
      const map: Record<string, Basic> = {
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
      resume(g, saved);
    } else saveRun(null);
  }

  /**
   * 続きから再開したとき、画面だけが持っていた数を、記録から戻す。
   * いまの連鎖と最長の連鎖（起きたことの列から数え直す）と、人物を決めた内容
   * （「同じ夜をもう一度」が、同じ人物・難しさ・名前で始まるように）。
   */
  function resume(g: Game, s: { cmds: readonly Cmd[] }): void {
    let run = 0;
    let you = false;
    for (const ev of g.events) {
      if (ev.type === 'enc.start') {
        you = ev.who === 'you';
        run = 0;
      } else if (ev.type === 'enc.st' && ev.key === 'chain' && you) {
        run = Math.max(0, run + ev.n);
        bestStreak = Math.max(bestStreak, run);
      }
    }
    streak = g.world.enc?.who === 'you' ? run : 0;
    const first = s.cmds[0];
    if (first?.c === 'start') {
      create = {
        ...create,
        job: first.job,
        depth: first.depth ?? 0,
        name: first.sheet?.name ?? '',
        ...(first.sheet?.origin ? { origin: first.sheet.origin } : {}),
        ...(first.sheet?.ep ? { ep: first.sheet.ep } : {}),
        ...(first.sheet?.item ? { item: first.sheet.item } : {}),
      };
    }
  }
  const first = profile.lang ?? (doc.documentElement.lang.startsWith('en') ? 'en' : 'ja');
  dialog.lang = first;
  void setLang(first).then(() => {
    retranslate(dialog);
    render();
  });
}
