import { actions } from '../engine/ai';
import type { ActiveDef } from '../engine/defs';
import {
  canAccept,
  basic as doBasic,
  leaveChance,
  pressDamage,
  shownIntent,
  strikeValue,
  threatValue,
  useCard,
} from '../engine/enc';
import { ORIGINS, originOf } from '../engine/origins';
import { activeDef, eventDef, itemDef, npcDef, permDef } from '../engine/registry';
import { seedOf } from '../engine/rng';
import {
  alterOptions,
  autoStep,
  buyCard,
  buyItem,
  canChoose,
  cardPrice,
  chooseOption,
  claimReward,
  clock,
  cure,
  curePrice,
  DAWN,
  type EventResult,
  eventChance,
  finishEncounter,
  history,
  leave,
  type MapNode,
  moveTo,
  newRun,
  nodeOf,
  OUTCOME_NAME,
  priceOf,
  type Run,
  reachable,
  restAction,
  restAlter,
  restChance,
  STRATUM_NAME,
  sacrifice,
  sellPerm,
  shortRest,
  startEncounter,
  statsOf,
  useItem,
  vitals,
} from '../engine/run';
import { STAT_NAME, xpNeed } from '../engine/stats';
import { type EncEvent, type Encounter, STATS, type Stat } from '../engine/types';
import { loadProfile, loadRun, type Profile, saveProfile, saveRun } from './save';
import { DigSound } from './sound';
import { Stage } from './stage';

/**
 * DIG。検索欄に 'dig' と打つと開く。
 *
 * 画面は一枚の dialog。上に時刻と体と心、下にいつも ACTIVE の 5 枚、横に
 * 能力値と PERMANENT（今回、経験してきたこと）。真ん中が、地図・遭遇・
 * 出来事・食堂・古物商・結末と切り替わる。
 *
 * 操作: 押して選ぶ。遭遇では 1〜5 でカード、A 押す・S 構える・D 話す・
 * F 去る。Esc で閉じる（地図の上にいれば、続きから再開できる）。
 */

const KIND_NAME: Record<string, string> = {
  memory: '記憶',
  trait: '人格',
  wound: '傷',
  bond: '関係',
  state: '状態',
};

type Child = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | number | undefined | ((ev: Event) => void)> = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v);
    else if (k === 'class') el.className = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

/** 中身を差し替える（空の子は飛ばす）。 */
function fill(el: HTMLElement, ...children: Child[]): void {
  el.replaceChildren(
    ...children.filter((c): c is Node | string => c !== null && c !== undefined && c !== false),
  );
}

const button = (
  label: Child | Child[],
  on: () => void,
  attrs: Record<string, string | boolean | undefined> = {},
) => h('button', { type: 'button', class: 'dig-btn', ...attrs, onclick: on }, label);

function bar(value: number, max: number, kind: string, label: string): HTMLElement {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return h(
    'div',
    {
      class: `dig-bar dig-bar--${kind}`,
      role: 'meter',
      'aria-label': label,
      'aria-valuenow': value,
      'aria-valuemax': max,
    },
    h('span', { class: 'dig-bar-label' }, label),
    h(
      'span',
      { class: 'dig-bar-track' },
      h('span', { class: 'dig-bar-fill', style: `width:${pct}%` }),
    ),
    h('span', { class: 'dig-bar-num' }, `${Math.max(0, value)}/${max}`),
  );
}

function pips(uses: number, max: number): HTMLElement {
  const out = h('span', { class: 'dig-pips', 'aria-label': `${uses}/${max}` });
  for (let i = 0; i < max; i++) out.append(h('i', { class: i < uses ? 'on' : '' }));
  return out;
}

export function openDig(doc: Document, onClose: () => void): void {
  const dialog = h('dialog', { class: 'dig', 'aria-label': 'DIG' });
  doc.body.append(dialog);
  const sound = new DigSound();
  const profile: Profile = loadProfile();
  sound.muted = profile.muted;
  let run: Run | null = loadRun();
  let enc: Encounter | null = null;
  let seen = 0;
  let sheet = false;
  let lastEvent: EventResult | null = null;
  let stage: Stage | null = null;
  let stageCanvas: HTMLCanvasElement | null = null;
  let raf = 0;
  let picking: { kind: 'full' | 'discard' | 'buy' | 'sac'; id?: string; stat?: Stat } | null = null;
  const t0 = performance.now();
  const now = () => (performance.now() - t0) / 1000;
  const live = h('p', { class: 'dig-live', 'aria-live': 'polite' });
  const shell = h('div', { class: 'dig-shell' });
  dialog.append(shell, live);

  function close() {
    cancelAnimationFrame(raf);
    saveRun(run);
    saveProfile(profile);
    dialog.close();
    dialog.remove();
    doc.removeEventListener('keydown', onKey, true);
    onClose();
  }
  dialog.addEventListener('cancel', (ev) => {
    ev.preventDefault();
    close();
  });

  // ─── 共通の枠 ───────────────────────────────────────────────

  function top(): HTMLElement {
    const r = run;
    const bits: Child[] = [h('span', { class: 'dig-logo' }, 'DIG')];
    if (r) {
      const v = vitals(r.you);
      const left = DAWN - r.hour;
      bits.push(
        h('span', { class: 'dig-where' }, `${STRATUM_NAME[r.stratum]} `, h('b', {}, clock(r.hour))),
        h(
          'span',
          { class: `dig-dawn${left <= 1 ? ' is-late' : ''}`, title: '夜明けまで' },
          left > 0 ? `夜明けまで ${left} 時間` : '夜が明けた',
        ),
        bar(v.hp, v.maxHp, 'hp', '体力'),
        bar(v.mind, v.maxMind, 'mind', '精神'),
        h('span', { class: 'dig-coins' }, `金 ${r.you.coins}`),
        button(sheet ? '戻る' : '人物', () => {
          sheet = !sheet;
          render();
        }),
      );
    }
    bits.push(
      button(sound.muted ? '音 ×' : '音', () => {
        sound.muted = !sound.muted;
        profile.muted = sound.muted;
        saveProfile(profile);
        render();
      }),
      button('閉じる', close, { class: 'dig-btn dig-exit' }),
    );
    return h('header', { class: 'dig-top' }, ...bits);
  }

  function cardTile(
    def: ActiveDef,
    uses: number,
    max: number,
    slot: number,
    playable: boolean,
  ): HTMLElement {
    const spent = uses <= 0;
    const r = run;
    const card = r?.you.actives[slot];
    const chance = enc && playable ? (spent ? def.spentChance : def.chance)?.(enc) : undefined;
    const alters = r ? alterOptions(r.you, slot) : [];
    const tile = h(
      'button',
      {
        type: 'button',
        class: `dig-card dig-card--${def.cat}${spent ? ' is-spent' : ''}${playable ? ' is-live' : ''}`,
        disabled: !playable,
        'aria-label': `${slot + 1}. ${spent ? `${def.spentName}（${def.name} 0/${max}）` : def.name} ${spent ? def.spentText : def.text}`,
        onclick: () => act({ kind: 'card', slot }),
      },
      h('span', { class: 'dig-card-key' }, String(slot + 1)),
      h(
        'span',
        { class: 'dig-card-head' },
        h('b', {}, spent ? def.spentName : def.name),
        spent ? h('span', { class: 'dig-card-state' }, `${def.name} 0/${max}`) : pips(uses, max),
      ),
      h('span', { class: 'dig-card-text' }, spent ? def.spentText : def.text),
      chance !== undefined ? h('span', { class: 'dig-card-chance' }, `${chance}%`) : null,
      h('span', { class: 'dig-card-rec' }, def.recover.text),
      alters.length && card
        ? h(
            'span',
            { class: 'dig-card-alter' },
            ...alters.map((a) =>
              h(
                'span',
                { class: `dig-alter dig-alter--${a.kind}${a.ready ? ' is-ready' : ''}` },
                `→ ${activeDef(a.to).name}  ${a.need}`,
              ),
            ),
          )
        : null,
    );
    return tile;
  }

  function hand(): HTMLElement {
    const r = run;
    const wrap = h('footer', { class: 'dig-hand', 'aria-label': 'ACTIVE' });
    if (!r) return wrap;
    r.you.actives.forEach((c, slot) => {
      if (!c) {
        wrap.append(
          h(
            'div',
            { class: 'dig-card is-empty' },
            h('span', { class: 'dig-card-key' }, String(slot + 1)),
            '空き',
          ),
        );
        return;
      }
      const playable = !!enc && !enc.outcome && enc.phase === 'player';
      const live = enc?.cards[slot] ?? c;
      wrap.append(cardTile(activeDef(live.id), live.uses, live.maxUses, slot, playable));
    });
    return wrap;
  }

  function side(): HTMLElement {
    const r = run;
    const wrap = h('aside', { class: 'dig-side', 'aria-label': '人物' });
    if (!r) return wrap;
    const s = enc ? enc.stats : statsOf(r.you);
    const o = originOf(r.you.origin);
    const table = h('table', { class: 'dig-stats' });
    for (const st of STATS) {
      const perm = s[st] - r.you.innate[st] - r.you.growth[st];
      const need = xpNeed(r.you.growth[st]);
      table.append(
        h(
          'tr',
          {},
          h('th', { title: STAT_NAME[st] }, st),
          h('td', { class: 'dig-stat-v' }, String(s[st])),
          h(
            'td',
            { class: 'dig-stat-parts' },
            `${r.you.innate[st]}+${r.you.growth[st]}${perm ? (perm > 0 ? `+${perm}` : String(perm)) : ''}`,
          ),
          h(
            'td',
            {},
            h(
              'span',
              { class: 'dig-xp' },
              h('i', { style: `width:${(r.you.xp[st] / need) * 100}%` }),
            ),
          ),
        ),
      );
    }
    const perms = h('ol', { class: 'dig-perms' });
    for (const p of history(r.you)) {
      const d = permDef(p.id);
      perms.append(
        h(
          'li',
          {
            class: `dig-perm dig-perm--${p.kind}${d?.tags?.includes('bad') ? ' is-bad' : ''}`,
            title: d?.text ?? '',
          },
          h('span', { class: 'dig-perm-kind' }, KIND_NAME[p.kind] ?? ''),
          h('b', {}, p.name),
          h('span', { class: 'dig-perm-text' }, d?.text ?? ''),
        ),
      );
    }
    const items = r.you.items.length
      ? h(
          'ul',
          { class: 'dig-items' },
          ...r.you.items.map((id, i) =>
            h(
              'li',
              {},
              button(
                itemDef(id)?.name ?? id,
                () => {
                  if (enc) return;
                  useItem(r, i);
                  sound.ok();
                  render();
                },
                { title: itemDef(id)?.text ?? '', disabled: !!enc },
              ),
            ),
          ),
        )
      : null;
    const rv = r.rival;
    return h(
      'aside',
      { class: 'dig-side', 'aria-label': '人物' },
      h('p', { class: 'dig-origin' }, o.name),
      table,
      h('h3', {}, 'PERMANENT'),
      perms,
      items ? h('h3', {}, '所持品') : null,
      items,
      h('h3', {}, 'もう一人'),
      h(
        'p',
        { class: 'dig-rival' },
        `${rv.you.name} — ${rv.down ? '最下層' : `${STRATUM_NAME[rv.stratum] ?? ''} ${Math.max(0, rv.row + 1)} 段目`}`,
      ),
      rv.log.length ? h('p', { class: 'dig-rival-log' }, rv.log.slice(-3).join(' / ')) : null,
    );
  }

  // ─── 画面 ───────────────────────────────────────────────────

  function titleScreen(): HTMLElement {
    const saved = loadRun();
    let origin = ORIGINS[0]?.id ?? 'surveyor';
    let depth = profile.depth;
    let carry: string | null = profile.carry;
    const body = h('section', { class: 'dig-title' });
    const draw = () => {
      fill(
        body,
        h('h1', { class: 'dig-title-mark' }, 'DIG'),
        h(
          'p',
          { class: 'dig-title-lead' },
          '一夜ずつ、三つの層を下りる。人を掘り、記憶を持ち帰る。',
        ),
        saved
          ? button(
              `続きから（${STRATUM_NAME[saved.stratum]} ${clock(saved.hour)}）`,
              () => {
                run = saved;
                render();
              },
              { class: 'dig-btn dig-btn--primary' },
            )
          : null,
        h('h2', {}, '生まれ'),
        h(
          'div',
          { class: 'dig-origins' },
          ...ORIGINS.map((o) =>
            h(
              'button',
              {
                type: 'button',
                class: `dig-origin-card${o.id === origin ? ' is-on' : ''}`,
                'aria-pressed': o.id === origin ? 'true' : 'false',
                onclick: () => {
                  origin = o.id;
                  draw();
                },
              },
              h('b', {}, o.name),
              h('span', {}, o.text),
              h(
                'span',
                { class: 'dig-origin-stats' },
                ...STATS.map((s) => h('span', {}, `${s} ${o.innate[s]}`)),
              ),
              h(
                'span',
                { class: 'dig-origin-cards' },
                o.cards.map((c) => activeDef(c).name).join('・'),
              ),
            ),
          ),
        ),
        h('h2', {}, '深さ'),
        h(
          'div',
          { class: 'dig-depths' },
          ...Array.from({ length: profile.depth + 1 }, (_v, d) =>
            button(
              String(d),
              () => {
                depth = d;
                draw();
              },
              {
                'aria-pressed': d === depth ? 'true' : 'false',
                class: `dig-btn dig-depth${d === depth ? ' is-on' : ''}`,
              },
            ),
          ),
        ),
        profile.last.length
          ? h(
              'div',
              { class: 'dig-carry' },
              h('h2', {}, '残響（前の夜から 1 枚だけ持ち越す）'),
              h(
                'div',
                { class: 'dig-carry-list' },
                button(
                  '持ち越さない',
                  () => {
                    carry = null;
                    draw();
                  },
                  { class: `dig-btn${carry === null ? ' is-on' : ''}` },
                ),
                ...profile.last
                  .filter((id) => (permDef(id)?.value ?? 0) > 0)
                  .map((id) =>
                    button(
                      permDef(id)?.name ?? id,
                      () => {
                        carry = id;
                        draw();
                      },
                      {
                        class: `dig-btn${carry === id ? ' is-on' : ''}`,
                        title: permDef(id)?.text ?? '',
                      },
                    ),
                  ),
              ),
            )
          : null,
        button(
          '下りる',
          () => {
            const seed = seedOf(`${Date.now()}:${Math.random()}`);
            run = newRun({
              seed,
              origin,
              depth,
              carry: carry ?? undefined,
              remembered: profile.remembered,
            });
            profile.carry = null;
            profile.runs++;
            saveProfile(profile);
            saveRun(run);
            sound.gain();
            render();
          },
          { class: 'dig-btn dig-btn--primary dig-start' },
        ),
      );
    };
    draw();
    return body;
  }

  const KIND_LABEL: Record<MapNode['kind'], string> = {
    person: '人',
    danger: '危',
    event: '？',
    rest: '食',
    shop: '古',
    boss: '主',
  };
  const KIND_TITLE: Record<MapNode['kind'], string> = {
    person: '人物',
    danger: '危険',
    event: '出来事',
    rest: '食堂（休める）',
    shop: '古物商',
    boss: 'この層の主',
  };

  function mapScreen(r: Run): HTMLElement {
    const open = new Set(reachable(r).map((n) => n.id));
    const rows = new Map<number, MapNode[]>();
    for (const n of r.map) rows.set(n.row, [...(rows.get(n.row) ?? []), n]);
    const grid = h('div', { class: 'dig-map' });
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'dig-map-lines');
    svg.setAttribute('aria-hidden', 'true');
    grid.append(svg);
    const pos = (n: MapNode) => {
      const list = rows.get(n.row) ?? [];
      const x = ((n.col + 0.5) / list.length) * 100;
      const y = ((n.row + 0.5) / (Math.max(...rows.keys()) + 1)) * 100;
      return [x, y] as const;
    };
    for (const n of r.map) {
      for (const id of n.next) {
        const m = nodeOf(r, id);
        if (!m) continue;
        const [x1, y1] = pos(n);
        const [x2, y2] = pos(m);
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', `${x1}%`);
        line.setAttribute('y1', `${y1}%`);
        line.setAttribute('x2', `${x2}%`);
        line.setAttribute('y2', `${y2}%`);
        if (r.pos === n.id && open.has(m.id)) line.setAttribute('class', 'is-open');
        svg.append(line);
      }
    }
    const rv = r.rival;
    for (const n of r.map) {
      const [x, y] = pos(n);
      const here = r.pos === n.id;
      const rivalHere = !rv.down && rv.stratum === r.stratum && rv.node === n.id;
      const name = n.npc ? npcDef(n.npc).name : '';
      grid.append(
        h(
          'button',
          {
            type: 'button',
            class: `dig-node dig-node--${n.kind}${n.visited ? ' is-done' : ''}${here ? ' is-here' : ''}${open.has(n.id) ? ' is-open' : ''}${n.rival ? ' is-rival' : ''}`,
            style: `left:${x}%;top:${y}%`,
            disabled: !open.has(n.id),
            'aria-label': `${KIND_TITLE[n.kind]}${name ? `：${name}` : ''}${n.rival ? '（もう一人が先に寄った）' : ''}`,
            title: `${KIND_TITLE[n.kind]}${name ? `：${name}` : ''}`,
            onclick: () => {
              sound.click();
              moveTo(r, n.id);
              saveRun(r);
              render();
            },
          },
          h('span', { class: 'dig-node-mark' }, KIND_LABEL[n.kind]),
          rivalHere ? h('span', { class: 'dig-node-rival', 'aria-hidden': 'true' }, '◆') : null,
        ),
      );
    }
    return h(
      'section',
      { class: 'dig-mapview' },
      h(
        'div',
        { class: 'dig-map-head' },
        h('h2', {}, STRATUM_NAME[r.stratum] ?? ''),
        button(
          '一服（全カード +1・1 時間）',
          () => {
            shortRest(r);
            sound.ok();
            saveRun(r);
            render();
          },
          { title: '逃走の系統は、食堂で休むまで戻らない' },
        ),
      ),
      grid,
      h('ol', { class: 'dig-journal' }, ...r.journal.slice(-4).map((t) => h('li', {}, t))),
    );
  }

  function intentView(e: Encounter): HTMLElement {
    const i = shownIntent(e);
    const real = e.npc.intent;
    const lied = !!real?.lie && i !== real;
    const caught = !!real?.lie && i === real;
    if (!i) return h('div', { class: 'dig-intent' });
    const nums: string[] = [];
    if (i.kind === 'strike' && i.hp !== undefined) nums.push(`体力 −${strikeValue(e, i.hp)}`);
    if (i.kind === 'threat' && i.mind !== undefined) nums.push(`精神 −${threatValue(e, i.mind)}`);
    if (i.kind === 'bargain' && i.price !== undefined) nums.push(`金 ${i.price}`);
    return h(
      'div',
      {
        class: `dig-intent dig-intent--${i.kind}${caught ? ' is-caught' : ''}`,
        'aria-label': `次の手：${i.label}`,
      },
      h('span', { class: 'dig-intent-k' }, '次の手'),
      h('b', {}, i.label),
      nums.length ? h('span', { class: 'dig-intent-n' }, nums.join(' ')) : null,
      caught
        ? h('span', { class: 'dig-intent-lie' }, `嘘：見かけは「${real?.seemLabel ?? ''}」`)
        : null,
      lied ? null : null,
    );
  }

  function logLine(ev: EncEvent, e: Encounter): HTMLElement | null {
    switch (ev.k) {
      case 'say':
        return h(
          'li',
          { class: `dig-log-say dig-log--${ev.who}` },
          ev.who === 'npc'
            ? h('b', {}, e.npc.name)
            : ev.who === 'you'
              ? h('b', {}, 'あなた')
              : null,
          ev.text,
        );
      case 'check':
        return h(
          'li',
          { class: `dig-log-check${ev.ok ? ' is-ok' : ' is-ng'}` },
          `［${ev.stat} ${ev.chance}%］${ev.ok ? '成功' : '失敗'}`,
        );
      case 'clue': {
        const d = permDef(ev.id);
        return h(
          'li',
          { class: `dig-log-clue${ev.false ? ' is-false' : ''}` },
          '手がかり：',
          h('b', {}, `《${d?.name ?? ev.id}》`),
          d?.exploit ? ` ${d.exploit.text}` : '',
        );
      }
      case 'perm':
        return h('li', { class: 'dig-log-perm' }, `《${permDef(ev.id)?.name ?? ev.id}》を得た`);
      case 'use': {
        const c = e.cards[ev.slot];
        if (!c) return null;
        const d = activeDef(c.id);
        return h(
          'li',
          { class: `dig-log-use${ev.spent ? ' is-spent' : ''}` },
          ev.spent ? `《${d.spentName}》（${d.name} 0 回）` : `《${d.name}》`,
        );
      }
      case 'seen':
        return h('li', { class: 'dig-log-seen' }, '予告の本当の姿が見えた。');
      case 'crit':
        return h('li', { class: 'dig-log-crit' }, '会心。');
      case 'end':
        return h('li', { class: 'dig-log-end' }, OUTCOME_NAME[ev.outcome]);
      default:
        return null;
    }
  }

  const transcript = h('ol', { class: 'dig-log', 'aria-label': '経過' });

  function feedEvents(e: Encounter) {
    const fresh = e.events.slice(seen);
    seen = e.events.length;
    let delay = 0;
    for (const ev of fresh) {
      const li = logLine(ev, e);
      if (li) {
        li.style.animationDelay = `${delay}ms`;
        delay += 90;
        transcript.append(li);
      }
      if (ev.k === 'hp' && ev.to === 'npc' && ev.delta < 0) {
        if (stage) stage.mood.hurtAt = now();
        sound.hit();
      }
      if (ev.k === 'hp' && ev.to === 'you' && ev.delta < 0) sound.hurt();
      if (ev.k === 'check') ev.ok ? sound.ok() : sound.fail();
      if (ev.k === 'clue') sound.clue();
      if (ev.k === 'perm') sound.gain();
      if (ev.k === 'say' && ev.who === 'npc' && stage) stage.mood.actAt = now();
    }
    while (transcript.children.length > 40) transcript.firstElementChild?.remove();
    const text = fresh
      .map((ev) => logLine(ev, e)?.textContent)
      .filter(Boolean)
      .join(' ');
    if (text) live.textContent = text;
    requestAnimationFrame(() => {
      transcript.scrollTop = transcript.scrollHeight;
    });
  }

  function encounterScreen(r: Run, e: Encounter): HTMLElement {
    const n = e.npc;
    const def = npcDef(n.id);
    if (!stage || !stageCanvas) {
      stageCanvas = h('canvas', { class: 'dig-stage', 'aria-hidden': 'true' });
      stage = new Stage(stageCanvas);
    }
    stage.model = def.model;
    stage.mood.hostility = n.hostility;
    stage.mood.edge = n.mem.edge ?? 4;
    const clues = h(
      'ul',
      { class: 'dig-clues', 'aria-label': '手がかり' },
      ...n.clues.map((c) => {
        const d = permDef(c.id);
        return c.shown
          ? h(
              'li',
              { class: `dig-clue is-shown${c.false ? ' is-false' : ''}` },
              h('b', {}, d?.name ?? c.id),
              h(
                'span',
                {},
                c.false ? '（誤り）' : (d?.exploit?.text ?? KIND_NAME[d?.kind ?? ''] ?? ''),
              ),
            )
          : h('li', { class: 'dig-clue' }, '？');
      }),
    );
    const meters = h(
      'div',
      { class: 'dig-meters' },
      bar(n.hp, n.maxHp, 'npc-hp', '体力'),
      bar(n.resolve, n.maxResolve, 'npc-resolve', '意志'),
      bar(n.trust, n.trustNeed, 'trust', '信頼'),
      bar(n.hostility, 10, 'hostility', '敵意'),
    );
    const over = !!e.outcome;
    const basics = h(
      'div',
      { class: 'dig-basics', role: 'group', 'aria-label': '基本の行動' },
      button(
        [h('kbd', {}, 'A'), ` 押す 体力 −${pressDamage(e)}`],
        () => act({ kind: 'basic', a: 'press' }),
        { disabled: over },
      ),
      button([h('kbd', {}, 'S'), ' 構える'], () => act({ kind: 'basic', a: 'brace' }), {
        disabled: over,
      }),
      button(
        [
          h('kbd', {}, 'D'),
          def.mute ? ' 話す（通じない）' : def.hush && !n.st.unhushed ? ' 話す（静粛）' : ' 話す',
        ],
        () => act({ kind: 'basic', a: 'talk' }),
        { disabled: over },
      ),
      button(
        [h('kbd', {}, 'F'), ` 去る ${leaveChance(e)}%`],
        () => act({ kind: 'basic', a: 'leave' }),
        { disabled: over },
      ),
      canAccept(e)
        ? button(
            `応じる（金 ${n.intent?.price ?? 0}）`,
            () => act({ kind: 'basic', a: 'accept' }),
            { class: 'dig-btn dig-btn--primary' },
          )
        : null,
    );
    const end = over
      ? h(
          'div',
          { class: `dig-verdict dig-verdict--${e.outcome}` },
          h('b', {}, OUTCOME_NAME[e.outcome ?? 'left']),
          button(
            '続ける',
            () => {
              finishEncounter(r, e);
              enc = null;
              stage = null;
              stageCanvas = null;
              transcript.replaceChildren();
              seen = 0;
              saveRun(r);
              if (r.ending) settle(r);
              render();
            },
            { class: 'dig-btn dig-btn--primary', autofocus: true },
          ),
        )
      : null;
    return h(
      'section',
      { class: 'dig-encounter' },
      h(
        'div',
        { class: 'dig-foe' },
        h(
          'h2',
          {},
          n.name,
          h(
            'span',
            { class: 'dig-foe-tier' },
            e.tier === 'boss'
              ? '主'
              : e.tier === 'danger'
                ? '危険'
                : e.tier === 'rival'
                  ? 'もう一人'
                  : '',
          ),
        ),
        h('p', { class: 'dig-foe-desc' }, def.desc),
        stageCanvas,
        intentView(e),
        meters,
        clues,
      ),
      h('div', { class: 'dig-talk' }, transcript, end ?? basics),
    );
  }

  function act(
    a:
      | { kind: 'basic'; a: 'press' | 'brace' | 'talk' | 'leave' | 'accept' }
      | { kind: 'card'; slot: number },
  ) {
    const e = enc;
    if (!e || e.outcome || e.phase !== 'player') return;
    if (a.kind === 'basic') doBasic(e, a.a);
    else if (!useCard(e, a.slot)) return;
    sound.click();
    if (e.outcome && stage) {
      stage.mood.end =
        e.outcome === 'beaten' || e.outcome === 'broken'
          ? 'fall'
          : e.outcome === 'trusted' || e.outcome === 'uncovered'
            ? 'glow'
            : null;
      stage.mood.endAt = now();
    }
    feedEvents(e);
    render();
  }

  function rewardScreen(
    r: Run,
    p: Extract<NonNullable<Run['pending']>, { kind: 'reward' }>,
  ): HTMLElement {
    let take: string | undefined = p.take[0];
    let help: number | undefined;
    const body = h('section', { class: 'dig-reward' });
    const newsList = [...r.news];
    r.news = [];
    const draw = () => {
      fill(
        body,
        h('h2', {}, `${npcDef(p.npc).name}を${OUTCOME_NAME[p.outcome]}`),
        p.notes.length
          ? h('p', { class: 'dig-reward-notes' }, `手に入れた：${p.notes.join('、')}`)
          : null,
        newsList.length
          ? h('ul', { class: 'dig-news' }, ...newsList.map((t) => h('li', {}, t)))
          : null,
        p.take.length
          ? h(
              'div',
              { class: 'dig-take' },
              h('h3', {}, '暴いた記憶を 1 枚、持ち帰る'),
              ...p.take.map((id) =>
                h(
                  'button',
                  {
                    type: 'button',
                    class: `dig-perm-card${take === id ? ' is-on' : ''}`,
                    'aria-pressed': take === id ? 'true' : 'false',
                    onclick: () => {
                      take = id;
                      draw();
                    },
                  },
                  h('span', { class: 'dig-perm-kind' }, KIND_NAME[permDef(id)?.kind ?? ''] ?? ''),
                  h('b', {}, permDef(id)?.name ?? id),
                  h('span', {}, permDef(id)?.text ?? ''),
                ),
              ),
            )
          : null,
        p.help
          ? h(
              'div',
              { class: 'dig-help' },
              h('h3', {}, '頼る（カード 1 枚を最大まで回復。借りができる）'),
              ...r.you.actives.map((c, slot) =>
                c
                  ? button(
                      `${activeDef(c.id).name} ${c.uses}/${c.maxUses}`,
                      () => {
                        help = help === slot ? undefined : slot;
                        draw();
                      },
                      { class: `dig-btn${help === slot ? ' is-on' : ''}` },
                    )
                  : null,
              ),
            )
          : null,
        button(
          '先へ',
          () => {
            claimReward(r, { take, help });
            sound.gain();
            saveRun(r);
            if (r.ending) settle(r);
            render();
          },
          { class: 'dig-btn dig-btn--primary' },
        ),
      );
    };
    draw();
    return body;
  }

  function eventScreen(r: Run, id: string): HTMLElement {
    const def = eventDef(id);
    if (!def) return h('section', {});
    return h(
      'section',
      { class: 'dig-event' },
      h('h2', {}, def.title),
      h('p', { class: 'dig-prose' }, def.text),
      h(
        'ol',
        { class: 'dig-options' },
        ...def.options.map((o, i) => {
          const ok = canChoose(r, i);
          const tag = o.stat ? `［${o.stat} ${eventChance(r, o.stat, o.diff ?? 0)}%］` : '';
          return h(
            'li',
            {},
            button(
              [tag ? h('span', { class: 'dig-opt-check' }, tag) : null, o.label],
              () => {
                lastEvent = chooseOption(r, i);
                if (lastEvent?.check) lastEvent.ok ? sound.ok() : sound.fail();
                saveRun(r);
                render();
              },
              { disabled: !ok, class: 'dig-btn dig-option' },
            ),
          );
        }),
      ),
    );
  }

  function eventResult(r: Run, res: EventResult): HTMLElement {
    const newsList = [...r.news];
    r.news = [];
    return h(
      'section',
      { class: 'dig-event' },
      res.check
        ? h(
            'p',
            { class: `dig-log-check${res.ok ? ' is-ok' : ' is-ng'}` },
            `［${res.check.chance}%］${res.ok ? '成功' : '失敗'}`,
          )
        : null,
      h('p', { class: 'dig-prose' }, res.text),
      newsList.length
        ? h('ul', { class: 'dig-news' }, ...newsList.map((t) => h('li', {}, t)))
        : null,
      button(
        '先へ',
        () => {
          lastEvent = null;
          render();
        },
        { class: 'dig-btn dig-btn--primary' },
      ),
    );
  }

  function slotPicker(
    r: Run,
    label: string,
    on: (slot: number) => void,
    allowEmpty = false,
  ): HTMLElement {
    return h(
      'div',
      { class: 'dig-picker' },
      h('p', {}, label),
      ...r.you.actives.map((c, slot) =>
        c || allowEmpty
          ? button(
              c
                ? `${slot + 1}. ${activeDef(c.id).name} ${c.uses}/${c.maxUses}`
                : `${slot + 1}. 空き`,
              () => on(slot),
            )
          : null,
      ),
      button('やめる', () => {
        picking = null;
        render();
      }),
    );
  }

  function restScreen(
    r: Run,
    p: Extract<NonNullable<Run['pending']>, { kind: 'rest' }>,
  ): HTMLElement {
    const newsList = [...r.news];
    r.news = [];
    if (picking?.kind === 'full' || picking?.kind === 'discard') {
      const kind = picking.kind;
      return h(
        'section',
        { class: 'dig-rest' },
        slotPicker(
          r,
          kind === 'full' ? '最大まで回復させるカード' : '手放すカード（ほかの 4 枚がすべて戻る）',
          (slot) => {
            restAction(r, kind, slot);
            picking = null;
            sound.ok();
            saveRun(r);
            render();
          },
        ),
      );
    }
    const alters = r.you.actives.flatMap((c, slot) =>
      c
        ? alterOptions(r.you, slot).map((o) =>
            h(
              'li',
              { class: `dig-alter-row dig-alter--${o.kind}${o.ready ? ' is-ready' : ''}` },
              h('span', {}, `${activeDef(c.id).name} → `, h('b', {}, activeDef(o.to).name)),
              h('span', { class: 'dig-alter-need' }, o.need),
              h('span', { class: 'dig-alter-text' }, activeDef(o.to).text),
              button(
                '変える',
                () => {
                  if (restAlter(r, slot, o.to)) sound.gain();
                  saveRun(r);
                  render();
                },
                { disabled: !o.ready || p.altered },
              ),
            ),
          )
        : [],
    );
    return h(
      'section',
      { class: 'dig-rest' },
      h('h2', {}, '夜の食堂'),
      h('p', { class: 'dig-prose' }, 'カウンターの灯りの下。ここなら、少し休める。'),
      newsList.length
        ? h('ul', { class: 'dig-news' }, ...newsList.map((t) => h('li', {}, t)))
        : null,
      p.used
        ? h('p', { class: 'dig-note' }, '休んだ。')
        : h(
            'div',
            { class: 'dig-rest-actions' },
            button('休む — 体と心 +40%、全カード +1、1 時間', () => {
              restAction(r, 'rest');
              sound.ok();
              saveRun(r);
              render();
            }),
            button('完全休養 — 1 枚を最大まで、2 時間、次の出来事を逃す', () => {
              picking = { kind: 'full' };
              render();
            }),
            button(
              `手帳を整理する［INT ${restChance(r, 'tune-int')}%］— 調べ・話すカード +2`,
              () => {
                restAction(r, 'tune-int');
                saveRun(r);
                render();
              },
            ),
            button(`呼吸を整える［WIL ${restChance(r, 'tune-wil')}%］— 心・力のカード +2`, () => {
              restAction(r, 'tune-wil');
              saveRun(r);
              render();
            }),
            button('破棄 — 1 枚を手放し、ほかを全回復', () => {
              picking = { kind: 'discard' };
              render();
            }),
          ),
      alters.length ? h('h3', {}, '変質') : null,
      alters.length ? h('ul', { class: 'dig-alters' }, ...alters) : null,
      button(
        '発つ',
        () => {
          leave(r);
          saveRun(r);
          render();
        },
        { class: 'dig-btn dig-btn--primary' },
      ),
    );
  }

  function shopScreen(
    r: Run,
    p: Extract<NonNullable<Run['pending']>, { kind: 'shop' }>,
  ): HTMLElement {
    const newsList = [...r.news];
    r.news = [];
    if (picking?.kind === 'buy' && picking.id) {
      const id = picking.id;
      return h(
        'section',
        { class: 'dig-shop' },
        slotPicker(
          r,
          `《${activeDef(id).name}》をどの枠に入れるか（入れ替えた札は手放す）`,
          (slot) => {
            if (buyCard(r, id, slot)) sound.gain();
            picking = null;
            saveRun(r);
            render();
          },
          true,
        ),
      );
    }
    if (picking?.kind === 'sac' && picking.stat) {
      const st = picking.stat;
      return h(
        'section',
        { class: 'dig-shop' },
        slotPicker(r, `${st} を 1 差し出して、最大回数を 1 増やすカード`, (slot) => {
          if (sacrifice(r, st, slot)) sound.gain();
          picking = null;
          saveRun(r);
          render();
        }),
      );
    }
    const sellable = r.you.permanents.filter((id) => (permDef(id)?.value ?? 0) > 0);
    const bad = r.you.permanents.filter((id) => permDef(id)?.tags?.includes('bad'));
    return h(
      'section',
      { class: 'dig-shop' },
      h('h2', {}, '古物商'),
      h('p', { class: 'dig-prose' }, '「物でも、記憶でも。値がつくものなら買うよ」'),
      newsList.length
        ? h('ul', { class: 'dig-news' }, ...newsList.map((t) => h('li', {}, t)))
        : null,
      h('h3', {}, 'カード'),
      h(
        'div',
        { class: 'dig-shop-row' },
        ...p.cards.map((id) => {
          const d = activeDef(id);
          const price = cardPrice(r, d);
          return button(
            [h('b', {}, d.name), ` 金 ${price}`, h('span', { class: 'dig-shop-text' }, d.text)],
            () => {
              picking = { kind: 'buy', id };
              render();
            },
            {
              disabled: p.sold.includes(id) || r.you.coins < price,
              class: 'dig-btn dig-shop-item',
            },
          );
        }),
      ),
      h('h3', {}, '品'),
      h(
        'div',
        { class: 'dig-shop-row' },
        ...p.items.map((id) => {
          const d = itemDef(id);
          const price = priceOf(r, d?.price ?? 99);
          return button(
            [
              h('b', {}, d?.name ?? id),
              ` 金 ${price}`,
              h('span', { class: 'dig-shop-text' }, d?.text ?? ''),
            ],
            () => {
              if (buyItem(r, id)) sound.ok();
              saveRun(r);
              render();
            },
            {
              disabled: p.sold.includes(id) || r.you.coins < price,
              class: 'dig-btn dig-shop-item',
            },
          );
        }),
      ),
      h('h3', {}, '記憶を売る（効き目も組み合わせも消える）'),
      h(
        'div',
        { class: 'dig-shop-row' },
        ...sellable.map((id) =>
          button(
            [h('b', {}, permDef(id)?.name ?? id), ` 金 ${permDef(id)?.value ?? 0}`],
            () => {
              sellPerm(r, id);
              sound.click();
              saveRun(r);
              render();
            },
            { class: 'dig-btn dig-shop-item', title: permDef(id)?.text ?? '' },
          ),
        ),
      ),
      bad.length ? h('h3', {}, `忘れさせてもらう（金 ${curePrice(r)}）`) : null,
      bad.length
        ? h(
            'div',
            { class: 'dig-shop-row' },
            ...bad.map((id) =>
              button(
                permDef(id)?.name ?? id,
                () => {
                  cure(r, id);
                  saveRun(r);
                  render();
                },
                { disabled: r.you.coins < curePrice(r), class: 'dig-btn dig-shop-item' },
              ),
            ),
          )
        : null,
      h('h3', {}, '能力値を差し出す（カードの最大回数 +1）'),
      h(
        'div',
        { class: 'dig-shop-row' },
        ...STATS.map((st) =>
          button(
            st,
            () => {
              picking = { kind: 'sac', stat: st };
              render();
            },
            { disabled: r.you.innate[st] + r.you.growth[st] <= 1 },
          ),
        ),
      ),
      button(
        '店を出る',
        () => {
          leave(r);
          saveRun(r);
          render();
        },
        { class: 'dig-btn dig-btn--primary' },
      ),
    );
  }

  function sheetScreen(r: Run): HTMLElement {
    const debts = Object.entries(r.you.debts).filter(([, n]) => n > 0);
    const rm = r.you.rumor;
    return h(
      'section',
      { class: 'dig-sheet' },
      h('h2', {}, '今回、経験してきたこと'),
      h(
        'ol',
        { class: 'dig-history' },
        ...history(r.you).map((p) =>
          h(
            'li',
            { class: `dig-perm dig-perm--${p.kind}` },
            h('span', { class: 'dig-perm-kind' }, KIND_NAME[p.kind] ?? ''),
            h('b', {}, p.name),
            h('span', { class: 'dig-perm-text' }, permDef(p.id)?.text ?? ''),
            h('span', { class: 'dig-perm-flavor' }, permDef(p.id)?.flavor ?? ''),
          ),
        ),
      ),
      h('h3', {}, '噂'),
      h('p', {}, `恐れられている ${rm.fear}　信用されている ${rm.kind}　詮索屋 ${rm.nosy}`),
      debts.length ? h('h3', {}, '借り') : null,
      debts.length
        ? h('p', {}, debts.map(([id, n]) => `${npcDef(id).name} ×${n}`).join('　'))
        : null,
    );
  }

  function settle(r: Run) {
    const end = r.ending;
    if (!end) return;
    profile.best = Math.max(profile.best, end.score);
    profile.last = [...r.you.permanents];
    for (const [id, o] of Object.entries(r.npcMet)) profile.remembered[id] = o;
    if (end.won) {
      profile.wins++;
      profile.depth = Math.max(profile.depth, Math.min(8, r.depth + 1));
    }
    saveProfile(profile);
    saveRun(null);
  }

  function endingScreen(r: Run): HTMLElement {
    const end = r.ending;
    if (!end) return h('section', {});
    return h(
      'section',
      { class: `dig-ending${end.won ? ' is-won' : ''}` },
      h('h2', {}, end.title),
      h('p', { class: 'dig-prose' }, end.text),
      h(
        'p',
        { class: 'dig-score' },
        `${end.score}`,
        h('span', {}, profile.best <= end.score ? ' 自己最高' : ` 最高 ${profile.best}`),
      ),
      end.won && r.depth + 1 > 0
        ? h('p', { class: 'dig-note' }, `深さ ${Math.min(8, r.depth + 1)} が開いた。`)
        : null,
      h('h3', {}, '今回、経験したこと'),
      h(
        'ol',
        { class: 'dig-history' },
        ...history(r.you).map((p) =>
          h(
            'li',
            { class: `dig-perm dig-perm--${p.kind}` },
            h('span', { class: 'dig-perm-kind' }, KIND_NAME[p.kind] ?? ''),
            h('b', {}, p.name),
          ),
        ),
      ),
      h(
        'p',
        { class: 'dig-rival' },
        `${r.rival.you.name}：${r.rival.log.slice(-4).join(' / ') || '会わなかった'}`,
      ),
      h(
        'div',
        { class: 'dig-carry' },
        h('h3', {}, '残響 — 次の夜へ 1 枚だけ持ち越す'),
        h(
          'div',
          { class: 'dig-carry-list' },
          ...r.you.permanents
            .filter((id) => (permDef(id)?.value ?? 0) > 0)
            .map((id) =>
              button(
                permDef(id)?.name ?? id,
                () => {
                  profile.carry = profile.carry === id ? null : id;
                  saveProfile(profile);
                  render();
                },
                { class: `dig-btn${profile.carry === id ? ' is-on' : ''}` },
              ),
            ),
        ),
      ),
      h(
        'div',
        { class: 'dig-ending-actions' },
        button(
          'もう一夜',
          () => {
            const seed = seedOf(`${Date.now()}:${Math.random()}`);
            const carry = profile.carry ?? undefined;
            run = newRun({
              seed,
              origin: r.you.origin,
              depth: Math.min(profile.depth, r.depth + (end.won ? 1 : 0)),
              carry,
              remembered: profile.remembered,
            });
            profile.carry = null;
            profile.runs++;
            saveProfile(profile);
            saveRun(run);
            sound.gain();
            render();
          },
          { class: 'dig-btn dig-btn--primary', autofocus: true },
        ),
        button('生まれを選び直す', () => {
          run = null;
          render();
        }),
      ),
    );
  }

  // ─── 描く ───────────────────────────────────────────────────

  function main(): HTMLElement {
    const r = run;
    if (!r) return titleScreen();
    if (r.ending) return endingScreen(r);
    if (sheet) return sheetScreen(r);
    if (lastEvent) return eventResult(r, lastEvent);
    const p = r.pending;
    if (!p) return mapScreen(r);
    switch (p.kind) {
      case 'encounter': {
        if (!enc) {
          enc = startEncounter(r);
          seen = 0;
          transcript.replaceChildren();
          if (enc) feedEvents(enc);
        }
        return enc ? encounterScreen(r, enc) : mapScreen(r);
      }
      case 'reward':
        return rewardScreen(r, p);
      case 'event':
        return eventScreen(r, p.id);
      case 'rest':
        return restScreen(r, p);
      case 'shop':
        return shopScreen(r, p);
      case 'ending':
        return endingScreen(r);
    }
  }

  function render() {
    const body = main();
    const playing = !!run && !run.ending;
    shell.className = `dig-shell${playing ? ' is-playing' : ''}${enc ? ' is-encounter' : ''}`;
    shell.replaceChildren(
      top(),
      h('main', { class: 'dig-main' }, body),
      playing ? side() : '',
      playing ? hand() : '',
    );
    const focus = shell.querySelector<HTMLElement>('[autofocus]');
    focus?.focus();
  }

  function loop() {
    raf = requestAnimationFrame(loop);
    if (stage && stageCanvas?.isConnected) stage.draw(now());
  }

  function onKey(ev: KeyboardEvent) {
    if (!dialog.open || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const target = ev.target as HTMLElement | null;
    if (target && /INPUT|TEXTAREA/.test(target.tagName)) return;
    if (enc && !enc.outcome) {
      const k = ev.key.toLowerCase();
      const map: Record<string, 'press' | 'brace' | 'talk' | 'leave'> = {
        a: 'press',
        s: 'brace',
        d: 'talk',
        f: 'leave',
      };
      const basicKey = map[k];
      if (basicKey) {
        ev.preventDefault();
        act({ kind: 'basic', a: basicKey });
        return;
      }
      const n = Number(ev.key);
      if (n >= 1 && n <= 5 && enc.cards[n - 1]) {
        ev.preventDefault();
        act({ kind: 'card', slot: n - 1 });
      }
    }
  }
  doc.addEventListener('keydown', onKey, true);

  dialog.showModal();
  render();
  loop();
  // 開発用: 自動で 1 歩（?dig-auto）。
  if (doc.location.search.includes('dig-auto')) {
    const tick = () => {
      if (!dialog.isConnected || !run || run.ending) return;
      if (enc) return;
      autoStep(run);
      render();
      setTimeout(tick, 120);
    };
    setTimeout(tick, 300);
  }
  void actions;
}
