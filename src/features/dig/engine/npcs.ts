import type { MoveDef, NpcDef } from './defs';
import {
  end,
  has,
  hostile,
  hurtMind,
  hurtYou,
  revealClue,
  say,
  stat,
  strikeValue,
  threatValue,
  trust,
} from './enc';
import { permDef } from './registry';
import type { Encounter, Intent, IntentKind } from './types';

/**
 * 人物。夜の街（Nighthawks の食堂のまわり）、記録層（閉じた映画館と書庫）、
 * 琥珀層（製油所と化石と、家族の声）。
 *
 * それぞれ手の並び（moves）と下駄（prior）と性格（persona）を持ち、頭（ai.ts）
 * が試行で次の手を選ぶ。嘘の予告は、見かけの手を見せて本当の手を打つ。
 */

const hpOf = (e: Encounter) => e.npc.hp / e.npc.maxHp;
const resolveOf = (e: Encounter) => e.npc.resolve / e.npc.maxResolve;
const hiddenClues = (e: Encounter) => e.npc.clues.filter((c) => !c.shown).length;

function strike(
  id: string,
  label: string,
  power: number | ((e: Encounter) => number),
  o: Partial<MoveDef> = {},
): MoveDef {
  const p = (e: Encounter) => (typeof power === 'number' ? power + (e.npc.atk - 4) : power(e));
  return {
    id,
    intent: (e) => ({ kind: 'strike', label, hp: p(e) }),
    act: (e) => {
      hurtYou(e, strikeValue(e, p(e)));
    },
    ...o,
  };
}

function threat(
  id: string,
  label: string,
  power: number | ((e: Encounter) => number),
  o: Partial<MoveDef> = {},
): MoveDef {
  const p = (e: Encounter) => (typeof power === 'number' ? power + (e.npc.wil - 4) : power(e));
  return {
    id,
    intent: (e) => ({ kind: 'threat', label, mind: p(e) }),
    act: (e) => {
      hurtMind(e, threatValue(e, p(e)));
    },
    ...o,
  };
}

function guard(id: string, label: string, n: number, o: Partial<MoveDef> = {}): MoveDef {
  return {
    id,
    intent: () => ({ kind: 'guard', label }),
    act: (e) => {
      e.npc.guard += n + e.npc.def;
    },
    ...o,
  };
}

function confide(id: string, label: string, need: number, o: Partial<MoveDef> = {}): MoveDef {
  return {
    id,
    intent: () => ({ kind: 'confide', label }),
    act: (e) => {
      if (!revealClue(e)) trust(e, 1);
    },
    cond: (e) => e.npc.trust >= need && hiddenClues(e) > 0,
    prior: (e) => 1 + e.npc.trust,
    ...o,
  };
}

function call(id: string, label: string, o: Partial<MoveDef> = {}): MoveDef {
  return {
    id,
    intent: () => ({ kind: 'call', label }),
    act: (e) => {
      e.npc.st.backup = (e.npc.st.backup ?? 0) + 1;
      hostile(e, 1);
    },
    cond: (e) => !e.npc.st.backup,
    ...o,
  };
}

function mend(
  id: string,
  label: string,
  hp: number,
  resolve: number,
  o: Partial<MoveDef> = {},
): MoveDef {
  return {
    id,
    intent: () => ({ kind: 'mend', label }),
    act: (e) => {
      const n = e.npc;
      n.hp = Math.min(n.maxHp, n.hp + hp);
      n.resolve = Math.min(n.maxResolve, n.resolve + resolve);
    },
    repeat: 1,
    ...o,
  };
}

function flee(
  id: string,
  label: string,
  when: (e: Encounter) => boolean,
  o: Partial<MoveDef> = {},
): MoveDef {
  return {
    id,
    intent: () => ({ kind: 'flee', label }),
    act: (e) => end(e, 'fled'),
    cond: when,
    prior: () => 6,
    ...o,
  };
}

function bargain(id: string, label: string, price: number, o: Partial<MoveDef> = {}): MoveDef {
  return {
    id,
    intent: () => ({ kind: 'bargain', label, price }),
    act: () => undefined,
    cond: (e) => hiddenClues(e) > 0,
    repeat: 1,
    ...o,
  };
}

function probe(id: string, label: string, o: Partial<MoveDef> = {}): MoveDef {
  return {
    id,
    intent: () => ({ kind: 'probe', label }),
    act: (e) => {
      e.npc.st.wary = (e.npc.st.wary ?? 0) + 1;
    },
    repeat: 1,
    ...o,
  };
}

/** 嘘の手。見かけ（seem）を見せて、本当の手（real）を打つ。 */
function lie(
  real: MoveDef,
  seem: IntentKind,
  seemLabel: string,
  o: Partial<MoveDef> = {},
): MoveDef {
  return {
    ...real,
    id: `${real.id}-lie`,
    intent: (e): Intent => ({ ...real.intent(e), lie: true, seem, seemLabel }),
    prior: (e) => 1 + 3 * (e.stats.INT < e.npc.int ? 1 : 0.3),
    repeat: 1,
    ...o,
  };
}

const angry = (e: Encounter) => e.npc.hostility / 3;

export const NPC_LIST: readonly NpcDef[] = [
  // ─── 第一層：夜の街 ─────────────────────────────────────────
  {
    id: 'watchman',
    name: '夜警',
    stratum: 1,
    tier: 'normal',
    hp: 24,
    resolve: 18,
    trustNeed: 6,
    atk: 5,
    def: 2,
    wil: 4,
    int: 2,
    agi: 2,
    hostility: 4,
    clues: ['knee', 'daughter-photo', 'saw-her'],
    take: ['daughter-photo', 'saw-her'],
    moves: [
      strike('baton', '警棒', 6, { prior: (e) => 1 + angry(e) }),
      threat('question', '職務質問', 4, { prior: () => 2 }),
      call('backup', '応援を呼ぶ', { prior: (e) => (hpOf(e) < 0.6 ? 5 : 1) }),
      lie(call('backup2', '応援を呼ぶ'), 'confide', '話す', {
        cond: (e) => !e.npc.st.backup && e.npc.trust < 3,
      }),
      confide('tell', 'あの夜のことを話す', 3),
    ],
    persona: { aggression: 0.5, deceit: 0.4, pride: 0.7, fear: 0.2, warmth: 0.5, cunning: 0.4 },
    rewards: {
      beaten: { coins: 15 },
      broken: { perm: 'badge', coins: 5 },
      trusted: { perm: 'watch-debt', help: true },
      uncovered: { coins: 10 },
    },
    model: 'watchman',
    desc: '角の食堂の前で、懐中電灯を持って立っている。',
    lines: {
      greet: ['こんな時間に、何を掘ってる。'],
      again: ['また、あんたか。'],
      hurt: ['……公務執行妨害だぞ。'],
      low: ['待て、待ってくれ。'],
      trusted: ['……わかった。灯りを二度点けたら、行ってやる。'],
      broken: ['持っていけ。どうせ俺には重すぎた。'],
      beaten: ['…………'],
      uncovered: ['どこまで知ってる。……いや、いい。'],
    },
  },
  {
    id: 'counterman',
    name: '給仕',
    stratum: 1,
    tier: 'normal',
    hp: 20,
    resolve: 16,
    trustNeed: 5,
    atk: 4,
    def: 1,
    wil: 3,
    int: 3,
    agi: 2,
    hostility: 2,
    clues: ['closing-time', 'phillies', 'shaft-key'],
    take: ['shaft-key'],
    moves: [
      guard('wipe', 'カウンターを拭く', 5, { prior: () => 2 }),
      bargain('sell', '話を売る', 12, { prior: () => 3 }),
      threat('closing', 'もう閉店だ', 3, { prior: (e) => 1 + e.hour / 3 }),
      strike('out', '追い出す', 5, { cond: (e) => e.npc.hostility >= 6, prior: () => 4 }),
      confide('coffee', 'コーヒーを注ぐ', 2),
    ],
    persona: { aggression: 0.2, deceit: 0.2, pride: 0.4, fear: 0.3, warmth: 0.6, cunning: 0.5 },
    rewards: {
      beaten: { coins: 20 },
      broken: { coins: 8, item: 'cigarette' },
      trusted: { perm: 'regular-seat', help: true, item: 'coffee' },
      uncovered: { coins: 10 },
    },
    model: 'counterman',
    desc: '白い帽子。カウンターの内側で、ずっと同じグラスを拭いている。',
    lines: {
      greet: ['いらっしゃい。……と言いたいところだが。'],
      again: ['また来たのか。席は空いてる。'],
      hurt: ['おい、店の中だぞ。'],
      trusted: ['奥の縦坑なら、鍵はここだ。持ってけ。'],
      broken: ['わかった、わかったよ。'],
      uncovered: ['……煙草、同じのを吸ってたな。あの子も。'],
    },
  },
  {
    id: 'regular',
    name: '常連客',
    stratum: 1,
    tier: 'normal',
    hp: 16,
    resolve: 12,
    trustNeed: 5,
    atk: 3,
    def: 0,
    wil: 3,
    int: 1,
    agi: 1,
    hostility: 3,
    clues: ['drink', 'lost-son', 'false-alibi'],
    take: ['lost-son'],
    moves: [
      threat('rant', '絡む', 4, { prior: () => 2 }),
      strike('glass', 'グラスを振る', 5, { cond: (e) => e.npc.hostility >= 5, prior: () => 3 }),
      lie(threat('story', '作り話で揺さぶる', 4), 'confide', '昔話をする'),
      confide('weep', '泣き出す', 2),
      flee('stagger', 'よろけて出ていく', (e) => hpOf(e) < 0.4),
    ],
    persona: { aggression: 0.3, deceit: 0.8, pride: 0.3, fear: 0.5, warmth: 0.4, cunning: 0.2 },
    rewards: {
      beaten: { coins: 12 },
      broken: { coins: 5 },
      trusted: { coins: 6, item: 'whisky' },
      uncovered: { coins: 8 },
    },
    model: 'patron',
    desc: '帽子を目深にかぶった男。グラスの底を見ている。',
    lines: {
      greet: ['なんだ、あんたも眠れないくちか。'],
      again: ['よう。……前にも会ったか？'],
      hurt: ['いてえな。'],
      low: ['勘弁してくれ。'],
      trusted: ['奢るよ。一杯だけな。'],
      fled: ['……帰る。'],
      uncovered: ['息子がな。……いや、なんでもない。'],
    },
  },
  {
    id: 'stray-dog',
    name: '野良犬',
    stratum: 1,
    tier: 'danger',
    hp: 18,
    resolve: 10,
    trustNeed: 4,
    atk: 5,
    def: 1,
    wil: 2,
    int: 0,
    agi: 4,
    hostility: 6,
    clues: ['hunger', 'hurt-paw'],
    take: [],
    mute: true,
    moves: [
      strike('bite', '噛みつく', 6, { prior: (e) => 1 + angry(e) }),
      threat('growl', '唸る', 3, { prior: () => 2 }),
      guard('circle', '間合いをとる', 4),
      {
        id: 'sniff',
        intent: () => ({ kind: 'confide', label: '匂いを嗅ぐ' }),
        act: (e) => trust(e, 1),
        cond: (e) => e.npc.hostility <= 4,
        prior: (e) => 2 + e.npc.trust,
      },
      flee('run', '逃げ去る', (e) => hpOf(e) < 0.35),
    ],
    persona: { aggression: 0.7, deceit: 0, pride: 0.2, fear: 0.6, warmth: 0.5, cunning: 0.2 },
    rewards: { beaten: { coins: 0 }, trusted: { perm: 'dog-friend' } },
    model: 'dog',
    desc: '路地の奥で、こちらを見ている。',
    lines: {
      greet: ['（低く唸っている）'],
      trusted: ['（尻尾を一度だけ振った）'],
      fled: ['（闇へ消えた）'],
    },
  },
  {
    id: 'last-customer',
    name: '最後の客',
    stratum: 1,
    tier: 'boss',
    hp: 42,
    resolve: 34,
    trustNeed: 8,
    atk: 6,
    def: 2,
    wil: 5,
    int: 5,
    agi: 3,
    hostility: 4,
    clues: ['mirror', 'cold-coffee', 'her-letter'],
    take: ['her-letter'],
    moves: [
      strike('mimic', 'あなたの真似をする', (e) => 4 + stat(e, 'ATK'), { prior: () => 2 }),
      threat('stare', '見つめ返す', 5, { prior: () => 2 }),
      mend('sip', 'コーヒーを啜る', 0, 7, { cond: (e) => resolveOf(e) < 0.6, prior: () => 3 }),
      strike('last-call', 'ラストオーダー', 12, {
        cond: (e) => hpOf(e) < 0.5,
        prior: () => 4,
        repeat: 1,
      }),
      lie(threat('smile', '微笑みで刺す', 6), 'wait', '微笑む'),
      confide('confess', '打ち明ける', 4),
    ],
    persona: { aggression: 0.5, deceit: 0.6, pride: 0.6, fear: 0.1, warmth: 0.4, cunning: 0.8 },
    rewards: {
      beaten: { coins: 30 },
      broken: { coins: 25 },
      trusted: { perm: 'nighthawk', coins: 15 },
      uncovered: { coins: 20 },
    },
    model: 'customer',
    desc: '閉店した食堂の、窓際の席。こちらに背を向けて座っている。',
    lines: {
      greet: ['遅かったね。……ずっと待ってた、とは言わないよ。'],
      again: ['また同じ夜だ。'],
      hurt: ['そう来ると思った。'],
      low: ['きみは、きみが思うより彼女に似ている。'],
      trusted: ['下へ行くといい。灯りは、点けたまま行って。'],
      broken: ['……ああ。もう、待たなくていいのか。'],
      uncovered: ['手紙は、きみ宛てだった。'],
    },
  },
  // ─── 第二層：記録層 ─────────────────────────────────────────
  {
    id: 'archivist',
    name: '記録係',
    stratum: 2,
    tier: 'normal',
    hp: 22,
    resolve: 24,
    trustNeed: 6,
    atk: 3,
    def: 2,
    wil: 4,
    int: 6,
    agi: 2,
    hostility: 3,
    clues: ['catalog', 'redacted', 'her-file'],
    take: ['her-file'],
    moves: [
      threat('correct', '訂正する', 5, { prior: () => 2 }),
      guard('file', '綴じる', 7, { prior: (e) => 1 + (hiddenClues(e) <= 1 ? 3 : 0) }),
      probe('crosscheck', '照合する', { prior: (e) => (e.log.lies > 0 ? 4 : 1) }),
      strike('stamp', '押印', 4),
      lie(threat('fee', '閲覧料を求める', 6), 'bargain', '閲覧料'),
      confide('show', '棚の奥を見せる', 3),
    ],
    persona: { aggression: 0.2, deceit: 0.7, pride: 0.6, fear: 0.3, warmth: 0.2, cunning: 0.8 },
    rewards: {
      beaten: { coins: 12 },
      broken: { coins: 10, item: 'notebook' },
      trusted: { item: 'notebook', help: true },
      uncovered: { coins: 15 },
    },
    model: 'archivist',
    desc: '果てしない書架の前で、索引カードを繰っている。',
    lines: {
      greet: ['閲覧の目的は。'],
      again: ['前回の閲覧記録が残っています。'],
      hurt: ['記録しました。'],
      trusted: ['これは、目録に載っていない棚の鍵です。'],
      broken: ['……記録を、訂正します。'],
      uncovered: ['黒塗りの下を見ましたね。'],
    },
  },
  {
    id: 'ghost',
    name: '映写技師の亡霊',
    stratum: 2,
    tier: 'normal',
    hp: 18,
    resolve: 26,
    trustNeed: 5,
    atk: 3,
    def: 0,
    wil: 6,
    int: 3,
    agi: 3,
    hostility: 2,
    clues: ['fire', 'last-reel'],
    take: ['fire'],
    moves: [
      threat('flicker', '明滅する', 6, { prior: () => 2 }),
      guard('reel', 'リールを替える', 6),
      strike('burn', '炎を映す', 5),
      confide('plead', '終わりを見せてくれと頼む', 2),
      flee('fade', '消える', (e) => resolveOf(e) < 0.4),
    ],
    persona: { aggression: 0.4, deceit: 0.3, pride: 0.5, fear: 0.2, warmth: 0.6, cunning: 0.5 },
    rewards: {
      beaten: { coins: 5 },
      broken: { coins: 8 },
      trusted: { coins: 10, help: true },
      uncovered: { coins: 10 },
    },
    model: 'ghost',
    desc: '誰もいない映写室で、リールだけが回っている。',
    lines: {
      greet: ['上映中だ。静かに。……いや、もう誰もいないか。'],
      trusted: ['最後のリールを、かけてくれるか。'],
      fled: ['（光の中に溶けた）'],
      uncovered: ['火は、俺のせいじゃなかった。……そう思いたい。'],
    },
  },
  {
    id: 'usher',
    name: '案内係',
    stratum: 2,
    tier: 'normal',
    hp: 22,
    resolve: 18,
    trustNeed: 5,
    atk: 4,
    def: 2,
    wil: 4,
    int: 3,
    agi: 3,
    hostility: 3,
    clues: ['flashlight', 'empty-seat', 'ticket'],
    take: ['ticket'],
    hush: true,
    moves: [
      strike('shine', '照らす', 5, { prior: (e) => 1 + angry(e) }),
      threat('shush', 'お静かに', 5, { prior: () => 2 }),
      guard('escort', '通路に立つ', 6),
      confide('seat', '空席へ案内する', 3),
    ],
    persona: { aggression: 0.4, deceit: 0.2, pride: 0.7, fear: 0.3, warmth: 0.3, cunning: 0.4 },
    rewards: {
      beaten: { coins: 14 },
      broken: { coins: 10 },
      trusted: { item: 'bus-ticket' },
      uncovered: { coins: 12 },
    },
    model: 'usher',
    desc: '暗い通路に、懐中電灯の小さな輪。',
    lines: {
      greet: ['（唇に指を当てる）'],
      hurt: ['……上映中です。'],
      trusted: ['G 列の 7 番へどうぞ。ずっと、空けてありました。'],
      uncovered: ['その席の人は、もう来ません。'],
    },
  },
  {
    id: 'silverfish',
    name: '紙魚の群れ',
    stratum: 2,
    tier: 'danger',
    hp: 26,
    resolve: 8,
    trustNeed: 99,
    atk: 4,
    def: 0,
    wil: 0,
    int: 0,
    agi: 5,
    hostility: 8,
    clues: ['paper-diet'],
    take: [],
    mute: true,
    moves: [
      strike('swarm', '群がる', 7, { prior: () => 3 }),
      guard('scatter', '散る', 6),
      mend('multiply', '殖える', 7, 0, { prior: (e) => (hpOf(e) < 0.6 ? 4 : 1) }),
    ],
    persona: { aggression: 0.8, deceit: 0, pride: 0, fear: 0.4, warmth: 0, cunning: 0.1 },
    rewards: { beaten: { coins: 10, item: 'notebook' }, uncovered: { coins: 6 } },
    model: 'swarm',
    desc: '書架の隙間から、銀色の群れが流れ出してくる。',
    lines: {},
  },
  {
    id: 'censor',
    name: '検閲官',
    stratum: 2,
    tier: 'danger',
    hp: 34,
    resolve: 30,
    trustNeed: 8,
    atk: 6,
    def: 3,
    wil: 6,
    int: 6,
    agi: 2,
    hostility: 6,
    clues: ['black-ink', 'scissors', 'uncut'],
    take: ['uncut'],
    moves: [
      threat('redline', '墨を引く', 7, { prior: () => 2 }),
      strike('cut', '切る', 8, { prior: (e) => 1 + angry(e) }),
      {
        id: 'erase',
        intent: () => ({ kind: 'probe', label: '手がかりを消す' }),
        act: (e) => {
          const shown = e.npc.clues.filter((c) => c.shown && !c.false);
          const c = shown[shown.length - 1];
          if (c) {
            c.shown = false;
            say(e, 'npc', 'その一行は、なかったことに。');
          }
        },
        cond: (e) => e.npc.clues.some((c) => c.shown && !c.false),
        prior: (e) => 2 + e.npc.clues.filter((c) => c.shown).length * 2,
        repeat: 1,
      },
      lie(strike('approve', '許可の印で殴る', 9), 'wait', '許可する'),
    ],
    persona: { aggression: 0.6, deceit: 0.5, pride: 0.9, fear: 0.1, warmth: 0.1, cunning: 0.9 },
    rewards: {
      beaten: { coins: 25 },
      broken: { coins: 20, item: 'brass' },
      trusted: { coins: 20 },
      uncovered: { coins: 15 },
    },
    model: 'censor',
    desc: '黒い帯を引く机。机の上には鋏と墨。',
    lines: {
      greet: ['あなたの場面は、不適切です。'],
      hurt: ['……削除対象。'],
      trusted: ['一場面だけ、残しておきましょう。'],
      uncovered: ['切らなかった場面が、ひとつだけある。'],
    },
  },
  {
    id: 'projector',
    name: '映写機',
    stratum: 2,
    tier: 'boss',
    hp: 52,
    resolve: 42,
    trustNeed: 9,
    atk: 6,
    def: 2,
    wil: 6,
    int: 5,
    agi: 2,
    hostility: 5,
    clues: ['last-reel'],
    take: [],
    moves: [
      threat(
        'replay',
        'あなたの記憶を上映する',
        (e) => 4 + e.permanents.filter((id) => permDef(id)?.kind === 'memory').length * 2,
        { prior: () => 3 },
      ),
      strike('glare', '光を浴びせる', 8, { prior: () => 2 }),
      mend('rewind', '巻き戻す', 6, 8, { cond: (e) => hpOf(e) < 0.7, prior: () => 3 }),
      guard('intermission', '幕間', 10),
      lie(threat('credits', 'エンドロールで刺す', 8), 'wait', 'エンドロール'),
    ],
    persona: { aggression: 0.6, deceit: 0.5, pride: 0.5, fear: 0.1, warmth: 0.2, cunning: 0.8 },
    rewards: {
      beaten: { coins: 35 },
      broken: { coins: 30 },
      trusted: { coins: 20, perm: 'projected' },
      uncovered: { coins: 25, perm: 'projected' },
    },
    model: 'projector',
    desc: '客席の後ろで、映写機が光を吐いている。スクリーンには、あなたが映っている。',
    lines: {
      greet: ['（スクリーンに、あなたの夜が映る）'],
      hurt: ['（フィルムが軋む）'],
      trusted: ['（光が、柔らかくなった）'],
      uncovered: ['（最後の場面で、フィルムが止まった）'],
    },
    init: (e) => {
      // 映写機の手がかりは、あなたの記憶。
      const mine = e.permanents.filter((id) => permDef(id)?.kind === 'memory').slice(0, 4);
      if (mine.length) e.npc.clues = mine.map((id) => ({ id, shown: false }));
    },
  },
  // ─── 第三層：琥珀層 ─────────────────────────────────────────
  {
    id: 'mother',
    name: '母の声',
    stratum: 3,
    tier: 'normal',
    hp: 20,
    resolve: 30,
    trustNeed: 6,
    atk: 2,
    def: 0,
    wil: 7,
    int: 4,
    agi: 1,
    hostility: 2,
    clues: ['voicemail', 'lullaby', 'illness'],
    take: ['voicemail'],
    moves: [
      threat('come-home', '帰ってきなさい', 6, { prior: () => 3 }),
      threat('lullaby', '子守歌', 4),
      mend('worry', '心配する', 0, 6, { prior: (e) => (resolveOf(e) < 0.6 ? 4 : 1) }),
      lie(threat('fine', '大丈夫だと言い張る', 8), 'confide', '大丈夫よ'),
      confide('remember', '昔の話をする', 2),
    ],
    persona: { aggression: 0.3, deceit: 0.3, pride: 0.3, fear: 0.2, warmth: 0.9, cunning: 0.4 },
    rewards: {
      beaten: { coins: 5, perm: 'guilt' },
      broken: { coins: 5 },
      trusted: { coins: 10, help: true },
      uncovered: { coins: 10 },
    },
    model: 'voice',
    desc: '琥珀の壁の向こうで、留守番電話のランプが点滅している。',
    lines: {
      greet: ['もしもし。……ちゃんと、ごはん食べてる？'],
      again: ['また電話くれたのね。'],
      hurt: ['……どうして。'],
      trusted: ['いいのよ。行ってらっしゃい。'],
      broken: ['……そう。もう、帰ってこないのね。'],
      uncovered: ['病院のことは、黙っていてごめんね。'],
    },
  },
  {
    id: 'drone',
    name: '製油所のドローン',
    stratum: 3,
    tier: 'danger',
    hp: 34,
    resolve: 99,
    trustNeed: 99,
    atk: 7,
    def: 4,
    wil: 0,
    int: 0,
    agi: 2,
    hostility: 8,
    clues: ['overheat', 'serial'],
    take: [],
    mute: true,
    moves: [
      strike('burn', '焼く', (e) => 7 + (e.npc.atk - 4) + 2 * (e.npc.mem.heat ?? 0), {
        prior: () => 3,
      }),
      {
        id: 'heat',
        intent: () => ({ kind: 'guard', label: '出力を上げる' }),
        act: (e) => {
          e.npc.guard += 6 + e.npc.def;
          e.npc.mem.heat = (e.npc.mem.heat ?? 0) + 1;
        },
        prior: () => 2,
      },
      {
        id: 'vent',
        intent: () => ({ kind: 'mend', label: '排熱する' }),
        act: (e) => {
          e.npc.hp = Math.min(e.npc.maxHp, e.npc.hp + 6);
          e.npc.mem.heat = 0;
        },
        cond: (e) => (e.npc.mem.heat ?? 0) >= 2,
        prior: (e) => 1 + (e.npc.mem.heat ?? 0),
        repeat: 1,
      },
    ],
    persona: { aggression: 0.8, deceit: 0, pride: 0, fear: 0.2, warmth: 0, cunning: 0.4 },
    rewards: { beaten: { coins: 18, item: 'brass' }, uncovered: { coins: 12 } },
    model: 'drone',
    desc: '止まったはずの製油所で、一台だけが巡回を続けている。',
    lines: {},
  },
  {
    id: 'geologist',
    name: '地質学者',
    stratum: 3,
    tier: 'danger',
    hp: 36,
    resolve: 32,
    trustNeed: 7,
    atk: 6,
    def: 3,
    wil: 5,
    int: 7,
    agi: 2,
    hostility: 5,
    clues: ['core-sample', 'factory-smell', 'rival-notes'],
    take: ['factory-smell', 'rival-notes'],
    moves: [
      strike('hammer', 'ハンマー', 9, { prior: (e) => 1 + angry(e) }),
      threat('lecture', '講釈を垂れる', 6, { prior: () => 2 }),
      probe('sample', 'あなたを採取する', { prior: (e) => (e.log.lies > 0 ? 4 : 1.5) }),
      guard('dig-in', '地層に潜る', 9),
      bargain('deal', '標本を売る', 20, { prior: () => 2 }),
    ],
    persona: { aggression: 0.5, deceit: 0.4, pride: 0.8, fear: 0.2, warmth: 0.2, cunning: 1 },
    rewards: {
      beaten: { coins: 25 },
      broken: { coins: 20 },
      trusted: { coins: 20, item: 'notebook' },
      uncovered: { coins: 15 },
    },
    model: 'geologist',
    desc: '琥珀の断面に、ルーペを当てている。',
    lines: {
      greet: ['その層は千年前だ。踏むな。'],
      hurt: ['野蛮だな。'],
      trusted: ['もう一人の掘る人も、同じことを訊いた。'],
      uncovered: ['この臭いを、どこで嗅いだ？'],
    },
  },
  {
    id: 'insect',
    name: '琥珀の蟲',
    stratum: 3,
    tier: 'danger',
    hp: 28,
    resolve: 20,
    trustNeed: 99,
    atk: 6,
    def: 3,
    wil: 2,
    int: 0,
    agi: 4,
    hostility: 7,
    clues: ['resin-shell', 'amber-eye'],
    take: ['amber-eye'],
    mute: true,
    moves: [
      strike('sting', '刺す', 7, { prior: () => 3 }),
      guard('harden', '固まる', 8),
      threat('buzz', '羽音', 4),
    ],
    persona: { aggression: 0.7, deceit: 0, pride: 0, fear: 0.3, warmth: 0, cunning: 0.2 },
    rewards: { beaten: { coins: 12 }, uncovered: { coins: 10 } },
    model: 'insect',
    desc: '琥珀から半分だけ抜け出した、大きな羽虫。',
    lines: {},
  },
  {
    id: 'hound',
    name: '化石の犬',
    stratum: 3,
    tier: 'danger',
    hp: 32,
    resolve: 16,
    trustNeed: 5,
    atk: 7,
    def: 2,
    wil: 2,
    int: 0,
    agi: 4,
    hostility: 7,
    clues: ['hurt-paw', 'hunger'],
    take: [],
    mute: true,
    moves: [
      strike('bite', '噛み砕く', 8, { prior: (e) => 1 + angry(e) }),
      threat('howl', '遠吠え', 5),
      guard('crouch', '身を伏せる', 6),
      {
        id: 'nuzzle',
        intent: () => ({ kind: 'confide', label: '鼻を寄せる' }),
        act: (e) => trust(e, 1),
        cond: (e) => e.npc.hostility <= 4,
        prior: (e) => 2 + e.npc.trust,
      },
    ],
    persona: { aggression: 0.7, deceit: 0, pride: 0.2, fear: 0.3, warmth: 0.6, cunning: 0.2 },
    rewards: { beaten: { coins: 10 }, trusted: { perm: 'dog-friend', help: true } },
    model: 'dog',
    desc: '骨の半分が琥珀になった犬。',
    lines: {
      greet: ['（骨が軋む音がする）'],
      again: ['（あなたの匂いを覚えている）'],
      trusted: ['（隣に座った）'],
    },
    init: (e) => {
      if (has(e, 'dog-friend')) {
        e.npc.trust = e.npc.trustNeed - 1;
        e.npc.hostility = 1;
        say(e, 'voice', 'あの路地の犬だ。覚えている。');
      }
    },
  },
  {
    id: 'volume',
    name: '体積',
    stratum: 3,
    tier: 'boss',
    hp: 60,
    resolve: 40,
    trustNeed: 10,
    atk: 6,
    def: 3,
    wil: 6,
    int: 6,
    agi: 3,
    hostility: 5,
    clues: [],
    take: [],
    moves: [0, 1, 2]
      .map(
        (k): MoveDef => ({
          id: `echo-${k}`,
          intent: (e) => {
            const echo = echoOf(e, k);
            return echo.kind === 'strike'
              ? { kind: 'strike', label: echo.label, hp: echo.power + e.stratum }
              : { kind: 'threat', label: echo.label, mind: echo.power + e.stratum };
          },
          act: (e) => {
            const echo = echoOf(e, k);
            if (echo.kind === 'strike') hurtYou(e, strikeValue(e, echo.power + e.stratum));
            else hurtMind(e, threatValue(e, echo.power + e.stratum));
          },
          prior: () => 2,
        }),
      )
      .concat([
        guard('expand', '膨らむ', 8, { prior: (e) => (hpOf(e) < 0.5 ? 3 : 1) }),
        mend('settle', '沈殿する', 8, 6, { cond: (e) => hpOf(e) < 0.6 }),
        confide('accept', 'あなたの記憶を差し出す', 5),
      ]),
    persona: { aggression: 0.6, deceit: 0.4, pride: 0.5, fear: 0, warmth: 0.3, cunning: 0.9 },
    rewards: {},
    model: 'volume',
    desc: 'いちばん深いところに、立方体がある。一辺は、あなたが経験してきたことの数で決まる。',
    lines: {
      greet: ['（立方体の面に、あなたの夜が刻まれている）'],
      hurt: ['（辺が、少し縮んだ）'],
      low: ['（立方体が、あなたの声で話しはじめる）'],
      trusted: ['ぜんぶ、持っていっていい。重さはそのままだけど。'],
      broken: ['（立方体は、ただの土に戻った）'],
      uncovered: ['（面の一つに、彼女の名前があった）'],
    },
    init: (e) => {
      // 体積はあなたの履歴でできている。辺は記憶の数、手がかりはあなたの永続カード。
      const mine = e.permanents.filter((id) => id !== 'false-lead');
      const edge = 3 + Math.min(3, Math.floor(mine.length / 4));
      const hp = Math.round((edge ** 3 / 2 + 20) * (1 + 0.1 * e.depth));
      e.npc.hp = hp;
      e.npc.maxHp = hp;
      const memories = mine.filter((id) => permDef(id)?.kind === 'memory').length;
      e.npc.resolve = e.npc.maxResolve = 14 + 4 * memories;
      const bonds = mine.filter((id) => permDef(id)?.kind === 'bond').length;
      e.npc.trustNeed = Math.max(5, 10 - bonds);
      const ordered = [...mine].sort(
        (a, b) =>
          (permDef(b)?.tags?.includes('her') ? 1 : 0) - (permDef(a)?.tags?.includes('her') ? 1 : 0),
      );
      e.npc.clues = ordered.slice(0, 6).map((id) => ({ id, shown: false }));
      e.npc.mem.edge = edge;
    },
  },
  // ─── もう一人の掘る人（数は遭遇のときにライバルの人物から入れる） ───
  {
    id: 'rival',
    name: 'もう一人の掘る人',
    stratum: 0,
    tier: 'danger',
    hp: 30,
    resolve: 26,
    trustNeed: 7,
    atk: 5,
    def: 2,
    wil: 4,
    int: 4,
    agi: 3,
    hostility: 4,
    clues: [],
    take: [],
    moves: [
      strike('shovel', 'シャベルで殴る', 6, { prior: (e) => 1 + angry(e) }),
      threat('taunt', '先に着くのは自分だ', 5, { prior: () => 2 }),
      probe('read', 'あなたを読む', { prior: () => 1.5 }),
      guard('dig-in', '掘った穴に身を沈める', 6),
      confide('notes', '手帳を見せる', 4),
      flee('climb', '別の坑道へ逃げる', (e) => hpOf(e) < 0.3),
    ],
    persona: { aggression: 0.5, deceit: 0.4, pride: 0.8, fear: 0.3, warmth: 0.3, cunning: 0.8 },
    rewards: {
      beaten: { coins: 20 },
      broken: { coins: 15 },
      trusted: { perm: 'rival-notes', help: true },
      uncovered: { coins: 15 },
    },
    model: 'rival',
    desc: 'あなたと同じシャベルを持っている。',
    lines: {
      greet: ['同じ穴を掘ってるとは思わなかった。'],
      again: ['また会ったな。今度は譲らない。'],
      hurt: ['……やるじゃないか。'],
      trusted: ['半分ずつ掘ろう。底で会おう。'],
      broken: ['先に行け。'],
      uncovered: ['俺も、彼女を探してる。'],
      fled: ['底で待ってる。'],
    },
  },
];

/** 体積の手。あなたの記憶から 3 つを、その声で使う。 */
function echoOf(
  e: Encounter,
  k: number,
): { label: string; kind: 'strike' | 'threat'; power: number } {
  const mine = e.permanents.filter((id) => permDef(id)?.echo);
  const id = mine[(k * 3 + (e.npc.mem.edge ?? 0)) % Math.max(1, mine.length)];
  const echo = id ? permDef(id)?.echo : undefined;
  return (
    echo ??
    (k % 2 === 0
      ? { label: '押し潰す', kind: 'strike', power: 7 }
      : { label: '沈黙で満たす', kind: 'threat', power: 6 })
  );
}
