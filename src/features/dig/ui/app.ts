import { cardName, cardTags, JOB_ARCH } from '../content/cardinfo';
import { fxText } from '../content/fx';
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
import type { Card, MapNode, World } from '../core/model';
import { ARCH_NAME, type Archetype, TAG_NAME } from '../core/tags';
import { type Advice, advise, nodeLabel } from '../sim/advise';
import { canAccept, leaveChance, resonance, shownIntent } from '../sim/encounter';
import { Game } from '../sim/game';
import { foeHardness, hardnessLabel, nodeHardness, outmatched, youHardness } from '../sim/hardness';
import { misses } from '../sim/near';
import { maxHp, maxMind, stats } from '../sim/ops';
import {
  alterOptions,
  canChoose,
  cardPrice,
  curePrice,
  DAWN,
  epPrice,
  nodeOf,
  OUTCOME_NAME,
  permValue,
  priceOf,
  ROWS,
  reachable,
  restChance,
  STRATUM_NAME,
  storyChance,
} from '../sim/run';
import { button, type Child, fill, h, meter } from './dom';
import { loadProfile, loadRun, type Profile, saveProfile, saveRun } from './save';
import { DigSound } from './sound';
import { type RoomView, Tower, type TowerView } from './tower';

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
const EMPTY: TowerView = { top: 1, floors: 9, rooms: [], edges: [], you: null, rival: null, routes: [], focus: null, enc: null };

const KIND_NAME: Record<MapNode['kind'], string> = {
  person: '人',
  danger: '危険',
  event: '出来事',
  rest: '食堂',
  shop: '古物商',
  boss: '最後の相手',
};

const BASIC_NAME: Record<Basic, string> = {
  press: '押す',
  brace: '構える',
  talk: '話す',
  leave: '立ち去る',
  accept: '応じる',
};

const clock = (hour: number) => `${String((22 + hour) % 24).padStart(2, '0')}:00`;
const floorNo = (w: World, row: number) => (w.stratum - 1) * (ROWS + 1) + row + 1;
const pips = (c: Card) => '●'.repeat(Math.max(0, c.uses)) + '○'.repeat(Math.max(0, c.max - c.uses));

export function openDig(doc: Document, onClose: () => void): void {
  const profile: Profile = loadProfile();
  const sound = new DigSound();
  sound.muted = profile.muted;
  let game: Game | null = null;
  let screen: Screen = 'create';
  let focus: number | null = null;
  let advice: Advice | null = null;
  let adviceAt = -1;
  let log: string[] = [];
  /** 次に手元の枠を押したとき、何をするか。 */
  let aim:
    | { kind: 'inscribe'; ep: string }
    | { kind: 'rest'; action: RestAction }
    | { kind: 'buy'; id: string }
    | { kind: 'pick'; id: string }
    | null = null;
  const reward: { take?: string; help?: number } = {};
  const anim = { foeHitAt: -9, youHitAt: -9, end: null as 'fall' | 'glow' | null, endAt: -9 };
  let create = { job: 'watch', ...defaultSheet('watch'), name: '', depth: 0, daily: false };

  const t0 = performance.now();
  const now = () => (performance.now() - t0) / 1000;

  const dialog = h('dialog', { class: 'dig', 'aria-label': 'DIG' });
  const bar = h('header', { class: 'dig-bar' });
  const canvas = h('canvas', { class: 'dig-tower', 'aria-label': '塔の見取り図' });
  const tip = h('div', { class: 'dig-tip', hidden: true });
  const view = h('div', { class: 'dig-view' }, canvas, tip);
  const side = h('aside', { class: 'dig-side' });
  const tray = h('footer', { class: 'dig-tray' });
  const live = h('p', { class: 'dig-live', 'aria-live': 'polite' });
  const main = h('main', { class: 'dig-main' }, view, side);
  const app = h('div', { class: 'dig-app' }, bar, main, tray, live);
  dialog.append(app);
  doc.body.append(dialog);
  dialog.showModal();
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

  function send(cmd: Cmd): boolean {
    if (!game) return false;
    const evs = game.dispatch(cmd);
    if (!evs.length) {
      sound.fail();
      return false;
    }
    react(evs);
    aim = null;
    if (cmd.c === 'claim') {
      reward.take = undefined;
      reward.help = undefined;
    }
    const w = game.world;
    if (w.ending) finishRun(w);
    else saveRun(game.save());
    render();
    return true;
  }

  function react(evs: readonly Ev[]): void {
    const t = now();
    for (const ev of evs) {
      switch (ev.type) {
        case 'foe':
          if ((ev.field === 'hp' || ev.field === 'resolve') && ev.n < 0 && ev.by === 'you') {
            anim.foeHitAt = t;
            sound.hit();
          }
          break;
        case 'vital':
          if (ev.who === 'you' && ((ev.hp ?? 0) < 0 || (ev.mind ?? 0) < 0) && game?.world.enc) {
            anim.youHitAt = t;
            sound.hurt();
          }
          break;
        case 'enc.start':
          if (ev.who === 'you') {
            anim.end = null;
            anim.endAt = -9;
          }
          break;
        case 'enc.end':
          anim.end = ['beaten', 'broken'].includes(ev.outcome)
            ? 'fall'
            : ev.outcome === 'trusted' || ev.outcome === 'uncovered'
              ? 'glow'
              : null;
          anim.endAt = t;
          if (anim.end) sound.ok();
          else sound.fail();
          break;
        case 'clue':
          if (ev.shown) sound.clue();
          break;
        case 'title':
        case 'perm':
          sound.gain();
          break;
        case 'note':
          say(ev.text);
          break;
        case 'say':
          say(ev.who === 'foe' ? `「${ev.text}」` : ev.text);
          break;
        default:
          break;
      }
    }
  }

  function say(text: string): void {
    log = [...log.slice(-30), text];
    live.textContent = text;
  }

  function finishRun(w: World): void {
    saveRun(null);
    const e = w.ending;
    if (!e) return;
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
    game = Game.start(s, create.job, create.depth, {
      carry: profile.carry ?? undefined,
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
        cols: w.map.filter((m) => m.row === n.row).length,
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
    for (const r of rooms) r.reachable = next.has(r.id);
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
      rival: !rv.down && rv.stratum === w.stratum && rv.node !== null && w.enc?.foe.id !== 'rival' ? rv.node : null,
      routes: w.enc || w.pending ? [] : routes,
      focus,
      enc: w.enc && w.enc.who === 'you' && w.pos !== null ? { room: w.pos, ...anim } : null,
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
      tower.draw(towerView(w), now(), dt);
    }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  canvas.addEventListener('pointermove', (ev) => {
    const id = tower.pick(ev.clientX, ev.clientY);
    if (id !== focus) {
      focus = id;
      render();
    }
  });
  canvas.addEventListener('pointerleave', () => {
    focus = null;
    render();
  });
  canvas.addEventListener('click', (ev) => {
    const id = tower.pick(ev.clientX, ev.clientY);
    if (id === null || !game) return;
    if (reachable(game.world).some((n) => n.id === id)) {
      sound.click();
      send({ c: 'move', node: id });
    } else {
      focus = id;
      render();
    }
  });

  // ─── 上帯 ───────────────────────────────────────────────────

  function renderBar(): void {
    bar.replaceChildren();
    const items: Child[] = [h('span', { class: 'dig-logo' }, 'DIG')];
    if (game && screen === 'play') {
      const w = game.world;
      const s = stats(w, 'you');
      const row = nodeOf(w, w.pos)?.row ?? -1;
      const left = DAWN - w.hour;
      const hard = youHardness(w);
      items.push(
        h(
          'span',
          { class: 'dig-where' },
          h('b', {}, row >= 0 ? `B${floorNo(w, row)}` : `B${floorNo(w, 0)} の上`),
          ` ${STRATUM_NAME[w.stratum] ?? ''}`,
        ),
        h(
          'span',
          { class: `dig-clock${left <= 1 ? ' is-late' : ''}` },
          clock(w.hour),
          ' ',
          left > 0 ? `夜明けまで ${left} 時間` : '夜が明けた',
        ),
        meter(w.you.hp, maxHp(s), 'hp', '体力'),
        meter(w.you.mind, maxMind(s), 'mind', '精神'),
        h('span', { class: 'dig-coins' }, `金 ${w.you.coins}`),
        h('span', { class: 'dig-hard', title: '総合の地力（モース硬度）' }, hardnessLabel(hard)),
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
      button(sound.muted ? '音 切' : '音 入', () => {
        sound.muted = !sound.muted;
        profile.muted = sound.muted;
        saveProfile(profile);
        renderBar();
      }),
      button('閉じる', close),
    );
    fill(bar, items);
  }

  // ─── 脇 ─────────────────────────────────────────────────────

  function renderSide(): void {
    side.replaceChildren();
    if (!game) return;
    const w = game.world;
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
    if (p?.kind === 'shop') {
      fill(side, [shopPanel(w)]);
      return;
    }
    fill(side, [mapPanel(w)]);
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
      h(
        'p',
        { class: 'dig-room__name' },
        `B${floorNo(w, n.row)}・${KIND_NAME[n.kind]}`,
        def ? ` ── ${def.name}` : '',
      ),
      def ? h('p', { class: 'dig-quiet' }, def.desc) : null,
      hard !== null
        ? h(
            'p',
            { class: outmatched(hard, you) ? 'dig-warn' : '' },
            `${hardnessLabel(hard)}（あなたは ${you}）`,
            outmatched(hard, you) ? ' ── 正面からは歯が立たない。退いて、出直せる。' : '',
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
    const f = focus !== null ? nodeOf(w, focus) : undefined;
    const kids: (Child | readonly Child[])[] = [];
    if (f) {
      const can = next.some((n) => n.id === f.id);
      kids.push(
        section(
          '部屋',
          roomInfo(w, f),
          can
            ? button('ここへ下りる', () => send({ c: 'move', node: f.id }), { class: 'dig-go' })
            : null,
        ),
      );
    } else
      kids.push(
        section(
          '次のフロア',
          h('p', { class: 'dig-quiet' }, '光っている部屋を押すと、そこへ下りる。'),
          next.map((n) =>
            button(`${KIND_NAME[n.kind]}${n.npc ? `・${foeDef(n.npc).name}` : ''}`, () =>
              send({ c: 'move', node: n.id }),
            ),
          ),
        ),
      );
    if (advice) {
      const card = (r: Advice['win'][number]) =>
        h(
          'article',
          { class: `dig-route dig-route--${r.kind}` },
          h('h4', {}, r.label),
          h('p', { class: 'dig-route__steps' }, r.steps.join(' → ')),
          h('p', {}, r.text),
          r.warn.length ? h('p', { class: 'dig-warn' }, r.warn.join('。')) : null,
          r.hint ? h('p', { class: 'dig-amber' }, r.hint) : null,
          r.path[0] !== undefined
            ? button('この道へ一歩', () => send({ c: 'move', node: r.path[0] as number }))
            : null,
        );
      kids.push(
        section('勝つための推奨', advice.win.map(card)),
        section('面白いことをするための推奨', advice.play.map(card)),
      );
    }
    const near = misses(w).slice(0, 3);
    if (near.length)
      kids.push(
        section(
          'あと一つ',
          near.map((m) => h('p', {}, `${m.name}：あと${lackText(m.lack)}`)),
        ),
      );
    kids.push(
      section(
        'その場で',
        button('一服する（1 時間）', () => send({ c: 'breather' })),
        w.you.items.map((id, i) =>
          button(`${itemDef(id)?.name ?? id}を使う`, () => send({ c: 'item', index: i }), {
            title: itemDef(id)?.text,
          }),
        ),
      ),
    );
    return h('div', {}, ...kids);
  }

  function lackText(l: { tag?: string; arch?: string; perm?: string; card?: string }): string {
    if (l.tag) return `［${TAG_NAME[l.tag as keyof typeof TAG_NAME]}］が 1 つ`;
    if (l.arch) return `〈${ARCH_NAME[l.arch as Archetype]}〉が 1 つ`;
    if (l.perm) return `記憶《${permDef(l.perm)?.name ?? l.perm}》`;
    if (l.card) return `『${cardDef(l.card).name}』`;
    return '何か';
  }

  function encounterPanel(w: World): HTMLElement {
    const e = w.enc;
    if (!e) return h('div');
    const f = e.foe;
    const def = foeDef(f.id);
    const hard = foeHardness(f);
    const you = youHardness(w);
    const intent = shownIntent(w);
    const res = resonance(w);
    const track = (label: string, v: number, max: number, cls: string) => meter(v, max, cls, label);
    const kids: (Child | readonly Child[])[] = [
      h(
        'p',
        { class: 'dig-room__name' },
        f.name,
        ' ',
        h('span', { class: outmatched(hard, you) ? 'dig-warn' : 'dig-quiet' }, hardnessLabel(hard)),
      ),
      h('p', { class: 'dig-quiet' }, def.desc),
      track('体力', f.hp, f.maxHp, 'foe-hp'),
      track('意志', f.resolve, f.maxResolve, 'foe-will'),
      f.need < 50
        ? track('信頼', f.trust, f.need, 'foe-trust')
        : h('p', { class: 'dig-quiet' }, '言葉は通じない'),
      f.clues.length
        ? h(
            'p',
            {},
            `手がかり ${f.clues.filter((c) => c.shown && !c.false).length}/${f.clues.length}`,
          )
        : null,
      track('敵意', f.hostility, 10, 'foe-host'),
      e.stage.length
        ? h('p', { class: 'dig-amber' }, `見せ場［${e.stage.map((t) => TAG_NAME[t]).join('・')}］`)
        : null,
      f.eps.length
        ? h('p', { class: 'dig-ep' }, f.eps.map((x) => `《${epithetDef(x)?.name ?? x}》`).join(''))
        : null,
      intent
        ? h(
            'p',
            { class: 'dig-intent' },
            '次の手：',
            h('b', {}, intent.label),
            intent.power ? ` （${intent.power}）` : '',
          )
        : null,
      h(
        'p',
        { class: 'dig-quiet' },
        `あなたの守り ${e.guard}・心の構え ${e.calm}`,
        res.length ? `・共鳴 ${res.length}` : '',
      ),
    ];
    if (e.phase === 'over' && e.outcome) {
      kids.push(
        h('p', { class: 'dig-outcome' }, OUTCOME_NAME[e.outcome]),
        button('決着を受け取る', () => send({ c: 'close' }), { class: 'dig-go' }),
      );
    } else {
      const lc = leaveChance(w);
      const basics: Basic[] = ['press', 'brace', 'talk', 'leave'];
      if (canAccept(w)) basics.push('accept');
      kids.push(
        h(
          'div',
          { class: 'dig-basics' },
          basics.map((a, i) =>
            button(`${'QWERT'[i]}　${BASIC_NAME[a]}${a === 'leave' ? `（${lc}%）` : ''}`, () =>
              send({ c: 'act', a }),
            ),
          ),
        ),
        h('p', { class: 'dig-quiet' }, '手元のカードを押すか、数字の 1〜5 で使う。'),
      );
    }
    kids.push(
      h(
        'ol',
        { class: 'dig-log' },
        log.slice(-6).map((l) => h('li', {}, l)),
      ),
    );
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
      def.options.map((o, i) =>
        button(
          `${o.label}${o.stat ? `（${o.stat} ${storyChance(w, o.stat, o.diff ?? 0)}%）` : ''}`,
          () => send({ c: 'choose', option: i }),
          { disabled: !canChoose(w, i) },
        ),
      ),
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
    const kids: (Child | readonly Child[])[] = [
      h('p', { class: 'dig-outcome' }, `${foeDef(p.npc).name}：${OUTCOME_NAME[p.outcome]}`),
    ];
    if (p.take.length)
      kids.push(
        h('p', {}, '記憶を一つ持ち帰れる：'),
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
        h('p', {}, '頼れば、カードを一枚戻してもらえる（借りができる）：'),
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
        h('p', {}, 'カードを一枚拾える（拾うと決着を受け取る）：'),
        p.cards.map((id) => cardOffer(id, () => pickCard(w, id))),
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

  function pickCard(w: World, id: string): void {
    const empty = w.you.cards.findIndex((c) => !c);
    if (empty >= 0)
      send({ c: 'claim', take: reward.take, help: reward.help, card: id, slot: empty });
    else {
      aim = { kind: 'pick', id };
      render();
    }
  }

  function cardOffer(id: string, on: () => void): HTMLElement {
    const d = cardDef(id);
    return h(
      'button',
      { type: 'button', class: 'dig-offer', onclick: on },
      h('b', {}, d.name),
      d.legend ? h('span', { class: 'dig-amber' }, ` 主役『${d.legend}』`) : null,
      h(
        'span',
        { class: 'dig-quiet' },
        ` ${d.uses} 回 ［${d.tags.map((t) => TAG_NAME[t]).join('・')}］${(d.arch ?? []).map((a) => `〈${ARCH_NAME[a]}〉`).join('')}`,
      ),
      h('span', { class: 'dig-offer__fx' }, fxText(d.ready)),
      d.sig ? h('span', { class: 'dig-offer__sig' }, d.sig) : null,
    );
  }

  function restPanel(w: World): HTMLElement {
    const p = w.pending;
    if (p?.kind !== 'rest') return h('div');
    const kids: (Child | readonly Child[])[] = [];
    if (!p.used)
      kids.push(
        button('休む（全カード +1・1 時間）', () => send({ c: 'rest', action: 'rest' })),
        button('ひと晩ここで（一枚を満たす・2 時間・次の出来事を逃す）', () => {
          aim = { kind: 'rest', action: 'full' };
          render();
        }),
        button(`考えを整える（INT ${restChance(w, 'tune-int')}%）`, () =>
          send({ c: 'rest', action: 'tune-int' }),
        ),
        button(`気を落ち着ける（WIL ${restChance(w, 'tune-wil')}%）`, () =>
          send({ c: 'rest', action: 'tune-wil' }),
        ),
        button('一枚捨てて、残りを満たす', () => {
          aim = { kind: 'rest', action: 'discard' };
          render();
        }),
      );
    else kids.push(h('p', { class: 'dig-quiet' }, 'もう休んだ。'));
    if (!p.altered)
      w.you.cards.forEach((c, slot) => {
        if (!c) return;
        for (const o of alterOptions(w.you, slot))
          kids.push(
            button(
              `『${cardDef(c.id).name}』→『${cardDef(o.to).name}』（${o.need}）`,
              () => send({ c: 'alter', slot, to: o.to }),
              {
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
      kids.push(
        h(
          'div',
          { class: 'dig-shopline' },
          cardOffer(id, () => {
            if (sold) return;
            aim = { kind: 'buy', id };
            render();
          }),
          h('span', { class: 'dig-price' }, sold ? '売約' : `金 ${cardPrice(w, id)}`),
        ),
      );
    }
    for (const id of p.items) {
      const sold = p.sold.includes(id);
      const ep = id.startsWith('ep:') ? epithetDef(id.slice(3)) : undefined;
      const it = ep ? undefined : itemDef(id);
      const price = ep ? epPrice(w, id.slice(3)) : priceOf(w, it?.price ?? 99);
      kids.push(
        button(
          `${ep ? `エピテット《${ep.name}》` : it?.name}　金 ${price}${sold ? '（売約）' : ''}`,
          () => send({ c: 'buy', id }),
          {
            disabled: sold || w.you.coins < price,
            title: ep ? `${ep.gloss} ${ep.card?.text ?? ''}` : it?.text,
          },
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

  function endPanel(w: World): HTMLElement {
    const e = w.ending;
    if (!e) return h('div');
    const near = misses(w).slice(0, 3);
    return section(
      e.title,
      h('p', { class: 'dig-persona' }, persona(w)),
      h('p', {}, e.text),
      h(
        'p',
        { class: 'dig-quiet' },
        `点 ${e.score}　最高 ${profile.best}　挑戦 ${profile.runs}　夜明けまで抜けた ${profile.wins}`,
      ),
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
    const w = game.world;
    const builds = buildsOf(w.you);
    const slots = w.you.cards.map((c, slot) => {
      const onClick = () => clickSlot(w, slot);
      if (!c)
        return h(
          'button',
          { type: 'button', class: `dig-card is-empty${aim ? ' is-aim' : ''}`, onclick: onClick },
          h('span', {}, '空き枠'),
        );
      const d = cardDef(c.id);
      const spent = c.uses <= 0;
      const ls = legendState(w.you, c.id);
      const ch = ls?.legend.chapters[ls.chapter];
      return h(
        'button',
        {
          type: 'button',
          class: `dig-card${spent ? ' is-spent' : ''}${aim ? ' is-aim' : ''}${d.legend ? ' is-lead' : ''}`,
          onclick: onClick,
          title: [d.sig, d.flavor].filter(Boolean).join('\n'),
          'aria-label': `${slot + 1}　${cardName(c, spent)}`,
        },
        h('span', { class: 'dig-card__key' }, String(slot + 1)),
        h('b', { class: 'dig-card__name' }, cardName(c, spent)),
        h('span', { class: 'dig-card__uses' }, pips(c)),
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
          spent ? `${d.spentName}：${fxText(d.spent)}` : fxText(d.ready),
        ),
        ls && ch
          ? h(
              'span',
              { class: 'dig-card__legend' },
              `『${ls.legend.title}』第${'一二三'[ls.chapter]}章 ${ch.name}　${ls.progress}/${ch.count}`,
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
        `《${b.name}》${t === 2 ? '極み' : t === 1 ? '暴走' : ''}`,
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
        buildLine.length ? h('p', {}, 'ビルド ', buildLine) : null,
        w.you.epithets.length
          ? h(
              'p',
              {},
              '手元のエピテット ',
              w.you.epithets.map((ep) =>
                button(
                  `《${epithetDef(ep)?.name ?? ep}》`,
                  () => {
                    aim = { kind: 'inscribe', ep };
                    render();
                  },
                  { title: `${epithetDef(ep)?.gloss ?? ''}\n${epithetDef(ep)?.card?.text ?? ''}` },
                ),
              ),
            )
          : null,
        h(
          'p',
          { class: 'dig-perms' },
          '記憶 ',
          w.you.perms.map((p) =>
            h('span', { title: permDef(p)?.text }, `《${permDef(p)?.name ?? p}》`),
          ),
        ),
      ),
    ]);
  }

  function aimText(): string {
    if (!aim) return '';
    if (aim.kind === 'inscribe') return `《${epithetDef(aim.ep)?.name}》を刻むカードを選ぶ`;
    if (aim.kind === 'buy') return `『${cardDef(aim.id).name}』を入れる枠を選ぶ`;
    if (aim.kind === 'pick') return `『${cardDef(aim.id).name}』と入れ替える枠を選ぶ`;
    return aim.action === 'full' ? 'ひと晩かけて満たすカードを選ぶ' : '捨てるカードを選ぶ';
  }

  function clickSlot(w: World, slot: number): void {
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
    if (w.enc?.phase === 'act' && w.you.cards[slot]) send({ c: 'card', slot });
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
          '底の見えない建物を、フロアごとに下りる。夜明けまでに最後の相手まで。初めのカードは 3 枚、枠は 2 つ空いている。',
        ),
        saved
          ? button(
              '続きから',
              () => {
                const g = Game.load(saved);
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
          '深さ ',
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
    dialog.classList.toggle('is-create', screen === 'create');
    if (screen === 'create') {
      renderCreate();
      return;
    }
    renderSide();
    renderTray();
    tip.hidden = true;
  }

  function onKey(ev: KeyboardEvent): void {
    if (!game || screen !== 'play' || ev.target instanceof HTMLInputElement) return;
    const w = game.world;
    const n = Number(ev.key);
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
    }
  }
  doc.addEventListener('keydown', onKey, true);

  const saved = loadRun();
  if (saved) {
    const g = Game.load(saved);
    if (g) {
      game = g;
      screen = 'play';
    } else saveRun(null);
  }
  render();
}
