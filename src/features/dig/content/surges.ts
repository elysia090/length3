import type { Ev } from '../core/events';
import type { Char, Who, World } from '../core/model';
import type { RuleCtx } from '../core/rules';
import type { Archetype } from '../core/tags';
import type { Tx } from '../core/tx';
import { breakFoe, coins, expose, heal, hitFoe, refill, stun } from '../sim/ops';
import { archCount } from './cardinfo';
import type { PassiveSpec, TriggerSpec } from './defs';
import { chapterOf } from './legends';
import { cardDef } from './registry';

/**
 * ビルドの段。レア度ではなく、構成の噛み合いで上がる。
 *
 *   第一段  ビルド（タグと原型がそろう）
 *   第二段  暴走。主役の札の第二章か、原型の四枚重ねが加わると、ほとんど
 *          バグのような効き目になる。ただし必ず上限がある（一段惜しい）
 *   第三段  極み。主役の結末（第三章）か、原型の五枚重ね。上限が外れる
 *
 * 画面には、暴走のあいだずっと「あと一段」の条件が出ている。
 */

export interface Tier {
  /** どれか一つで足りる。 */
  legend?: string;
  arch?: readonly Archetype[];
}

export interface Surge {
  name: string;
  /** 暴走の条件（主役の第二章、または原型の三枚重ね）。 */
  surge: Tier;
  text: string;
  /** 極みでの言い換え（上限が外れる）。 */
  peakText: string;
  passive?: (peak: boolean) => readonly PassiveSpec[];
  triggers?: (peak: boolean) => readonly TriggerSpec[];
}

const ownerOf = (w: World): Who => w.enc?.who ?? 'you';
const charOf = (w: World, who: Who): Char => (who === 'rival' ? w.rival.char : w.you);
const mine = (ev: Ev, w: World) => ev.type === 'card.use' && ev.who === ownerOf(w);
const count = (tx: Tx, key: string) => tx.w.enc?.st[key] ?? 0;
const bump = (tx: Tx, key: string) => tx.emit({ type: 'enc.st', key, n: 1 });
/** 上限つきで一度ぶん使う。使えたら true。 */
const spend = (tx: Tx, key: string, cap: number, peak: boolean) => {
  if (!peak && count(tx, key) >= cap) return false;
  bump(tx, key);
  return true;
};
const stratumSpend = (tx: Tx, key: string, cap: number, peak: boolean) => {
  const k = `${key}${tx.w.stratum}`;
  const n = tx.w.flags[k] ?? 0;
  if (!peak && n >= cap) return false;
  tx.emit({ type: 'flag', key: k, v: n + 1 });
  return true;
};

export const SURGES: Readonly<Record<string, Surge>> = {
  saturn: {
    name: '環が閉じる',
    surge: { legend: 'saturn', arch: ['scribe', 'drifter'] },
    text: '［記憶］のカードを使うたび、別の［記憶］のカード +1（遭遇で 3 回まで）',
    peakText: '［記憶］のカードを使うたび、別の［記憶］のカード +1（上限なし）',
    triggers: (peak) => [
      {
        on: 'card.use',
        when: (ev, w) => mine(ev, w) && ev.type === 'card.use' && ev.tags.includes('memory'),
        run: (tx, ev) => {
          if (ev.type !== 'card.use' || !spend(tx, 'sv:saturn', 3, peak)) return;
          const who = ownerOf(tx.w);
          const ch = charOf(tx.w, who);
          const slot = ch.cards.findIndex(
            (c, i) => i !== ev.slot && !!c && c.uses < c.max && cardHas(c.id, 'memory'),
          );
          if (slot >= 0) tx.emit({ type: 'card.uses', who, slot, n: 1 });
        },
        text: '環が閉じる',
      },
    ],
  },
  ironman: {
    name: '反応炉',
    surge: { legend: 'ironman', arch: ['machine'] },
    text: '手番の終わりに残った守りの半分で、相手を削る（1 手番 12 まで）',
    peakText: '手番の終わりに残った守りの半分で、相手を削る（上限なし）',
    triggers: (peak) => [
      {
        on: 'turn',
        when: (_ev, w) => !!w.enc && w.enc.guard > 1,
        run: (tx) => {
          const g = Math.floor((tx.w.enc?.guard ?? 0) / 2);
          const d = peak ? g : Math.min(12, g);
          if (d > 0) hitFoe(tx, d, true);
        },
        text: '反応炉',
      },
    ],
  },
  nighthawks: {
    name: '終夜営業',
    surge: { legend: 'nighthawks', arch: ['witness', 'drifter'] },
    text: '深夜、嘘の予告を見るたび相手を止める（遭遇で 2 回まで）',
    peakText: '深夜、嘘の予告を見るたび相手を止める（上限なし）',
    triggers: (peak) => [
      {
        on: 'seen',
        when: (_ev, w) => w.hour >= 2 && !!w.enc?.foe.intent?.lie,
        run: (tx) => {
          if (spend(tx, 'sv:nighthawks', 2, peak)) stun(tx);
        },
        text: '終夜営業',
      },
    ],
  },
  miserables: {
    name: '赦しの連鎖',
    surge: { legend: 'miserables', arch: ['saint'] },
    text: '得た信頼と同じだけ、体力が戻る（遭遇で 10 まで）',
    peakText: '得た信頼と同じだけ、体力と精神が戻る（上限なし）',
    triggers: (peak) => [
      {
        on: 'foe',
        when: (ev, w) =>
          ev.type === 'foe' && ev.field === 'trust' && ev.n > 0 && ev.by === ownerOf(w),
        run: (tx, ev) => {
          if (ev.type !== 'foe') return;
          const left = peak ? ev.n : Math.max(0, Math.min(ev.n, 10 - count(tx, 'sv:mis')));
          if (left <= 0) return;
          tx.emit({ type: 'enc.st', key: 'sv:mis', n: left });
          heal(tx, left, peak ? left : 0, ownerOf(tx.w));
        },
        text: '赦しの連鎖',
      },
    ],
  },
  chrome: {
    name: '金庫破り',
    surge: { legend: 'chrome', arch: ['trickster', 'machine'] },
    text: '本当の手がかりを見るたび、金 5・相手の守り −1（遭遇で 3 回まで）',
    peakText: '本当の手がかりを見るたび、金 5・相手の守り −1（上限なし）',
    triggers: (peak) => [
      {
        on: 'clue',
        when: (ev) => ev.type === 'clue' && ev.shown && !ev.false,
        run: (tx) => {
          if (!spend(tx, 'sv:chrome', 3, peak)) return;
          coins(tx, 5, ownerOf(tx.w));
          expose(tx, 1);
        },
        text: '金庫破り',
      },
    ],
  },
  orwell: {
    name: '二重思考',
    surge: { arch: ['sovereign', 'observer', 'prisoner'] },
    text: '相手の嘘がすべて見え、嘘の予告のたびに意志 −4（遭遇で 3 回まで）',
    peakText: '相手の嘘がすべて見え、嘘の予告のたびに意志 −4（上限なし）',
    passive: () => [{ rule: 'intentVisible', fn: () => 1, text: '二重思考' }],
    triggers: (peak) => [
      {
        on: 'intent',
        when: (ev) => ev.type === 'intent' && !!ev.intent.lie,
        run: (tx) => {
          if (spend(tx, 'sv:orwell', 3, peak)) breakFoe(tx, 4);
        },
        text: '二重思考',
      },
    ],
  },
  cities: {
    name: '都市の目録',
    surge: { legend: 'cities', arch: ['architect'] },
    text: '着くたび、全カード +1（1 区画で 4 回まで）',
    peakText: '着くたび、全カード +1（上限なし）',
    triggers: (peak) => [
      {
        on: 'moved',
        run: (tx) => {
          if (stratumSpend(tx, 'sv:cities', 4, peak)) refill(tx, 1, undefined, 'you');
        },
        text: '都市の目録',
      },
    ],
  },
  stalker: {
    name: '案内人',
    surge: { legend: 'stalker', arch: ['drifter', 'gatekeeper'] },
    text: '出来事の判定 +30%。最後の相手以外からは、必ず立ち去れる',
    peakText: '出来事の判定 +30%。必ず立ち去れる。休むと全快',
    passive: (peak) => [
      { rule: 'storyChance', fn: (_c, v) => v + 30, text: '案内人' },
      { rule: 'leaveChance', fn: (_c, v) => (v > 0 ? 100 : v), text: '案内人' },
      ...(peak
        ? [
            {
              rule: 'restHeal' as const,
              fn: (_c: RuleCtx, v: number) => v * 3,
              text: '案内人の部屋',
            },
          ]
        : []),
    ],
  },
  leaves: {
    name: '終わらない廊下',
    surge: { legend: 'leaves', arch: ['exile'] },
    text: '奇妙な場所では、カードが回数を減らさない（遭遇で 3 回まで）',
    peakText: '奇妙な場所では、カードが回数を減らさない（上限なし）',
    passive: (peak) => [
      {
        rule: 'useSpend',
        when: (c) =>
          !!c.w.map.find((n) => n.id === c.w.pos)?.eps.length &&
          (peak || (c.enc?.st['sv:leaves'] ?? 0) < 3),
        fn: () => 0,
        text: '終わらない廊下',
      },
    ],
    triggers: () => [
      {
        on: 'card.use',
        when: (ev, w) =>
          mine(ev, w) &&
          ev.type === 'card.use' &&
          !ev.free &&
          !!w.map.find((n) => n.id === w.pos)?.eps.length,
        run: (tx) => bump(tx, 'sv:leaves'),
        text: '廊下を数える',
      },
    ],
  },
  matrix: {
    name: '弾丸時間',
    surge: { legend: 'matrix', arch: ['machine', 'double'] },
    text: '予告が見え、積む守りが 2 倍（1 手番 +12 まで）',
    peakText: '予告が見え、積む守りが 2 倍（上限なし）。受ける傷は最大 2',
    passive: (peak) => [
      { rule: 'intentVisible', fn: () => 1, text: '弾丸時間' },
      ...(peak
        ? [
            {
              rule: 'strikeTaken' as const,
              fn: (_c: RuleCtx, v: number) => Math.min(v, 2),
              text: '弾丸時間',
            },
          ]
        : []),
    ],
    triggers: (peak) => [
      {
        on: 'enc.you',
        when: (ev, w) =>
          ev.type === 'enc.you' &&
          ev.field === 'guard' &&
          ev.n > 0 &&
          !!w.enc &&
          (w.enc.st['sv:mx'] ?? 0) === 0,
        run: (tx, ev) => {
          if (ev.type !== 'enc.you') return;
          const n = peak ? ev.n : Math.min(ev.n, 12);
          tx.emit({ type: 'enc.st', key: 'sv:mx', n: 1 });
          tx.emit({ type: 'enc.you', field: 'guard', n });
          tx.emit({ type: 'enc.st', key: 'sv:mx', n: -1 });
        },
        text: '弾丸時間',
      },
    ],
  },
  heat: {
    name: '三十秒ルール',
    surge: { legend: 'heat', arch: ['double', 'hunter'] },
    text: '立ち去るたび、全カード +2・金 10（1 区画で 3 回まで）',
    peakText: '立ち去るたび、全カード +2・金 10（上限なし）',
    triggers: (peak) => [
      {
        on: 'enc.end',
        when: (ev) => ev.type === 'enc.end' && ev.outcome === 'left',
        run: (tx) => {
          if (!stratumSpend(tx, 'sv:heat', 3, peak)) return;
          refill(tx, 2, undefined, ownerOf(tx.w));
          coins(tx, 10, ownerOf(tx.w));
        },
        text: '三十秒ルール',
      },
    ],
  },
  highlow: {
    name: '身代金の坂',
    surge: { legend: 'highlow', arch: ['detective', 'traitor'] },
    text: '遭遇で払った金が、そのまま相手の意志を折る（遭遇で 20 まで）',
    peakText: '遭遇で払った金が、その 1.5 倍だけ相手の意志を折る（上限なし）',
    triggers: (peak) => [
      {
        on: 'coins',
        when: (ev, w) => ev.type === 'coins' && ev.n < 0 && w.enc?.phase === 'act',
        run: (tx, ev) => {
          if (ev.type !== 'coins') return;
          const room = peak
            ? Math.round(-ev.n * 1.5)
            : Math.max(0, Math.min(-ev.n, 20 - count(tx, 'sv:hl')));
          if (room <= 0) return;
          tx.emit({ type: 'enc.st', key: 'sv:hl', n: room });
          breakFoe(tx, room);
        },
        text: '身代金の坂',
      },
    ],
  },
  solaris: {
    name: '海の贈り物',
    surge: { legend: 'solaris', arch: ['revenant', 'lover'] },
    text: '精神を削られるたび、同じだけ体力が戻る（遭遇で 10 まで）',
    peakText: '精神を削られるたび、同じだけ体力と精神が戻る（上限なし）',
    triggers: (peak) => [
      {
        on: 'vital',
        when: (ev, w) =>
          ev.type === 'vital' &&
          ev.who === ownerOf(w) &&
          (ev.mind ?? 0) < 0 &&
          w.enc?.phase === 'act',
        run: (tx, ev) => {
          if (ev.type !== 'vital') return;
          const n = -(ev.mind ?? 0);
          const left = peak ? n : Math.max(0, Math.min(n, 10 - count(tx, 'sv:sol')));
          if (left <= 0) return;
          tx.emit({ type: 'enc.st', key: 'sv:sol', n: left });
          heal(tx, left, peak ? Math.ceil(left / 2) : 0, ownerOf(tx.w));
        },
        text: '海の贈り物',
      },
    ],
  },
};

// ─── 段の判定 ─────────────────────────────────────────────────

const cardHas = (id: string, tag: string) => cardDef(id).tags.includes(tag as never);

/** 0: 第一段のまま、1: 暴走、2: 極み。 */
export function tierOf(c: Char, build: string): 0 | 1 | 2 {
  const s = SURGES[build];
  if (!s) return 0;
  const arch = archCount(c);
  const legend = s.surge.legend ? chapterOf(c, s.surge.legend) : 0;
  const archMax = Math.max(0, ...(s.surge.arch ?? []).map((a) => arch[a] ?? 0));
  if (legend >= 3 || archMax >= 5) return 2;
  if (legend >= 2 || archMax >= 4) return 1;
  return 0;
}

/** 画面向け：次の段への条件。 */
export function nextTier(c: Char, build: string): string | null {
  const s = SURGES[build];
  if (!s) return null;
  const t = tierOf(c, build);
  if (t >= 2) return null;
  const parts: string[] = [];
  if (s.surge.legend) parts.push(`主役の札の第${t === 0 ? '二' : '三'}章`);
  if (s.surge.arch?.length) parts.push(`原型の${t === 0 ? '四' : '五'}枚重ね`);
  return `あと一段（${t === 0 ? '暴走' : '極み'}）：${parts.join('、または')}`;
}
