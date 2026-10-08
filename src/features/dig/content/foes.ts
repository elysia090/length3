import type { Intent, IntentKind, World } from '../core/model';
import {
  end,
  hostile,
  hurt,
  hurtMind,
  revealClue,
  say,
  statOf,
  strikeValue,
  threatValue,
  trust,
} from '../sim/ops';
import { PACE } from './balance';
import type { FoeDef, MoveDef } from './defs';
import { permDef } from './registry';

/**
 * 人物。夜の街（Nighthawks の食堂のまわり）、記録の階（閉じた映画館と書庫）、
 * 琥珀の階（標本と地層と、家族の声）。
 *
 * それぞれ手の並び（moves）と下駄（prior）と性格（persona）を持ち、頭（ai.ts）
 * が試行で次の手を選ぶ。嘘の予告は、見かけの手を見せて本当の手を打つ。
 */

const foe = (w: World) => {
  const f = w.enc?.foe;
  if (!f) throw new Error('no encounter');
  return f;
};
const hpOf = (w: World) => foe(w).hp / foe(w).maxHp;
const resolveOf = (w: World) => foe(w).resolve / foe(w).maxResolve;
const hiddenClues = (w: World) => foe(w).clues.filter((c) => !c.shown).length;
const stat = (w: World, s: 'ATK' | 'WIL' | 'INT') => statOf(w, w.enc?.who ?? 'you', s);

type Power = number | ((w: World) => number);

function strike(id: string, label: string, power: Power, o: Partial<MoveDef> = {}): MoveDef {
  const p = (w: World) => (typeof power === 'number' ? power + (foe(w).atk - 4) : power(w));
  return {
    id,
    intent: (w) => ({ kind: 'strike', label, power: p(w) }),
    act: (tx) => {
      hurt(tx, strikeValue(tx.w, p(tx.w)));
    },
    ...o,
  };
}

function threat(id: string, label: string, power: Power, o: Partial<MoveDef> = {}): MoveDef {
  const p = (w: World) => (typeof power === 'number' ? power + (foe(w).wil - 4) : power(w));
  return {
    id,
    intent: (w) => ({ kind: 'threat', label, power: p(w) }),
    act: (tx) => {
      hurtMind(tx, threatValue(tx.w, p(tx.w)));
    },
    ...o,
  };
}

function guard(id: string, label: string, n: number, o: Partial<MoveDef> = {}): MoveDef {
  return {
    id,
    intent: () => ({ kind: 'guard', label }),
    act: (tx) => tx.emit({ type: 'foe', field: 'guard', n: n + foe(tx.w).def }),
    ...o,
  };
}

function confide(id: string, label: string, need: number, o: Partial<MoveDef> = {}): MoveDef {
  return {
    id,
    intent: () => ({ kind: 'confide', label }),
    act: (tx) => {
      if (!revealClue(tx)) trust(tx, 1);
    },
    cond: (w) => foe(w).trust >= need && hiddenClues(w) > 0,
    prior: (w) => 1 + foe(w).trust,
    ...o,
  };
}

function call(id: string, label: string, o: Partial<MoveDef> = {}): MoveDef {
  return {
    id,
    intent: () => ({ kind: 'call', label }),
    act: (tx) => {
      tx.emit({ type: 'foe.st', key: 'backup', n: 1 });
      hostile(tx, 1);
    },
    cond: (w) => !foe(w).st.backup,
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
    act: (tx) => {
      const f = foe(tx.w);
      const h = Math.min(hp, f.maxHp - f.hp);
      const r = Math.min(resolve, f.maxResolve - f.resolve);
      if (h > 0) tx.emit({ type: 'foe', field: 'hp', n: h });
      if (r > 0) tx.emit({ type: 'foe', field: 'resolve', n: r });
    },
    repeat: 1,
    ...o,
  };
}

function flee(
  id: string,
  label: string,
  when: (w: World) => boolean,
  o: Partial<MoveDef> = {},
): MoveDef {
  return {
    id,
    intent: () => ({ kind: 'flee', label }),
    act: (tx) => end(tx, 'fled'),
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
    cond: (w) => hiddenClues(w) > 0,
    repeat: 1,
    ...o,
  };
}

function probe(id: string, label: string, o: Partial<MoveDef> = {}): MoveDef {
  return {
    id,
    intent: () => ({ kind: 'probe', label }),
    act: (tx) => tx.emit({ type: 'foe.st', key: 'wary', n: 1 }),
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
    intent: (w): Intent => ({ ...real.intent(w), lie: true, seem, seemLabel }),
    prior: (w) => 1 + 3 * (stat(w, 'INT') < foe(w).int ? 1 : 0.3),
    repeat: 1,
    ...o,
  };
}

const angry = (w: World) => foe(w).hostility / 3;

export const FOE_LIST: readonly FoeDef[] = [
  // ─── 一の区画：夜の街 ─────────────────────────────────────────
  {
    id: 'watchman',
    name: '夜警',
    stratum: 1,
    tier: 'normal',
    hp: 24,
    resolve: 18,
    need: 6,
    atk: 5,
    def: 2,
    wil: 4,
    int: 2,
    agi: 2,
    hostility: 4,
    tags: ['institution', 'night', 'person'],
    weak: ['trust', 'private'],
    guarded: ['institution'],
    clues: ['knee', 'daughter-photo', 'saw-her'],
    take: ['daughter-photo', 'saw-her'],
    moves: [
      strike('baton', '警棒', 6, { prior: (w) => 1 + angry(w) }),
      threat('question', '職務質問', 4, { prior: () => 2 }),
      call('backup', '応援を呼ぶ', { prior: (w) => (hpOf(w) < 0.6 ? 5 : 1) }),
      lie(call('backup2', '応援を呼ぶ'), 'confide', '話す', {
        cond: (w) => !foe(w).st.backup && foe(w).trust < 3,
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
      greet: [
        'こんな時間に、何を探してる。',
        '止まれ。……ああ、灯りか。驚かせるな。',
        'ここから先は、通行証がいる。持ってないだろうな。',
      ],
      again: ['また、あんたか。', '巡回のたびに、あんたに会う。', '今夜は、これで何度目だ。'],
      hurt: ['……公務執行妨害だぞ。', '膝に来た。古傷なんだ。', 'やめろ。書類が増える。'],
      low: ['待て、待ってくれ。', 'わかった。少し、話そう。', '俺にも、家で待ってるやつがいる。'],
      trusted: [
        '……わかった。灯りを二度点けたら、行ってやる。',
        '娘の写真、見るか。……いや、いい。行け。',
        'あの夜、あの子を見た。北の階段だ。',
      ],
      broken: [
        '持っていけ。どうせ俺には重すぎた。',
        '制服を脱いだら、俺には何が残る。',
        '……好きにしろ。',
      ],
      beaten: ['…………', '（懐中電灯が、床を転がっていく）', '……報告は、しない。'],
      uncovered: [
        'どこまで知ってる。……いや、いい。',
        '写真のことは、誰にも言うな。',
        '見たよ。見たが、止めなかった。',
      ],
      taunt: ['言ったろう。ここは通さない。', '夜は長いぞ。', 'これも仕事だ。悪く思うな。'],
      mutter: [
        '（懐中電灯を、点けたり消したりしている）',
        '……膝が冷える。',
        '黙ってるなら、名前だけでも書いていけ。',
      ],
    },
  },
  {
    id: 'counterman',
    name: '給仕',
    stratum: 1,
    tier: 'normal',
    hp: 20,
    resolve: 16,
    need: 5,
    atk: 4,
    def: 1,
    wil: 3,
    int: 3,
    agi: 2,
    hostility: 2,
    tags: ['place', 'night', 'person'],
    weak: ['trust', 'place'],
    guarded: ['body'],
    clues: ['closing-time', 'phillies', 'shaft-key'],
    take: ['shaft-key'],
    moves: [
      guard('wipe', 'カウンターを拭く', 5, { prior: () => 2 }),
      bargain('sell', '話を売る', 12, { prior: () => 3 }),
      threat('closing', 'もう閉店だ', 3, { prior: (w) => 1 + w.hour / 3 }),
      strike('out', '追い出す', 5, { cond: (w) => foe(w).hostility >= 6, prior: () => 4 }),
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
      greet: [
        'いらっしゃい。……と言いたいところだが。',
        '座るなら、何か頼んでくれ。',
        'コーヒーしかない。昔からだ。',
      ],
      again: [
        'また来たのか。席は空いてる。',
        'いつもの、でいいか。',
        '同じ席に座るんだな。あんたも。',
      ],
      hurt: ['おい、店の中だぞ。', 'グラスが割れる。', '……修理代は、つけておく。'],
      trusted: [
        '奥の縦坑なら、鍵はここだ。持ってけ。',
        'お代はいい。今夜はもう、帳場を閉めた。',
        '冷めないうちに、飲んでいけ。',
      ],
      broken: [
        'わかった、わかったよ。',
        '好きなだけ持っていけ。店は、もう終わりだ。',
        '……帽子を、取らせてくれ。',
      ],
      uncovered: [
        '……煙草、同じのを吸ってたな。あの子も。',
        'あの子は、窓際の席だった。いつも。',
        '閉店の札を出したのは、俺だ。あの夜も。',
      ],
      taunt: ['閉店だと言ったろう。', '勘定は、まだだぞ。', '悪いが、ここは俺の店だ。'],
      mutter: [
        '（同じグラスを、まだ拭いている）',
        'コーヒー、淹れなおすか。',
        '……迷ってるなら、座ればいい。',
      ],
    },
  },
  {
    id: 'regular',
    name: '常連客',
    stratum: 1,
    tier: 'normal',
    hp: 16,
    resolve: 12,
    need: 5,
    atk: 3,
    def: 0,
    wil: 3,
    int: 1,
    agi: 1,
    hostility: 3,
    tags: ['person', 'memory', 'night'],
    weak: ['memory', 'trust'],
    guarded: ['institution'],
    clues: ['drink', 'lost-son', 'false-alibi'],
    take: ['lost-son'],
    moves: [
      threat('rant', '絡む', 4, { prior: () => 2 }),
      strike('glass', 'グラスを振る', 5, { cond: (w) => foe(w).hostility >= 5, prior: () => 3 }),
      lie(threat('story', '作り話で揺さぶる', 4), 'confide', '昔話をする'),
      confide('weep', '泣き出す', 2),
      flee('stagger', 'よろけて出ていく', (w) => hpOf(w) < 0.4),
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
      greet: [
        'なんだ、あんたも眠れないくちか。',
        '一杯付き合えよ。払いは、あんたで。',
        'その灯り、どこで買った。……いや、聞いてない。',
      ],
      again: [
        'よう。……前にも会ったか？',
        'ああ、あんたか。たぶん。',
        '顔は覚えてる。名前は飲んじまった。',
      ],
      hurt: ['いてえな。', '酔いが、覚めちまうだろうが。', 'おい、帽子が。'],
      low: ['勘弁してくれ。', '悪かった。何が悪かったかは知らんが。', 'もう飲まない。今夜は。'],
      trusted: [
        '奢るよ。一杯だけな。',
        'あんた、いいやつだな。息子に似てる。……似てないか。',
        '本当のことを言うとな。……やっぱり、明日にする。',
      ],
      fled: ['……帰る。', '勘定は、つけといてくれ。', '（帽子を押さえて、階段を上がっていった）'],
      uncovered: [
        '息子がな。……いや、なんでもない。',
        'アリバイなんて、作り話だ。最初から。',
        'あいつは、帰ってこなかった。それだけだ。',
      ],
      taunt: ['ほら見ろ。', '酔っ払いを、なめるなよ。', 'へへ。当たった。'],
      mutter: [
        '（グラスの底を覗いている）',
        '黙ってると、酒がまずくなる。',
        '……で、何の話だったっけ。',
      ],
    },
  },
  {
    id: 'stray-dog',
    name: '野良犬',
    stratum: 1,
    tier: 'danger',
    hp: 18,
    resolve: 10,
    need: 4,
    atk: 5,
    def: 1,
    wil: 2,
    int: 0,
    agi: 4,
    hostility: 6,
    tags: ['body', 'place', 'night'],
    weak: ['trust', 'body'],
    guarded: ['public'],
    clues: ['hunger', 'hurt-paw'],
    take: [],
    mute: true,
    moves: [
      strike('bite', '噛みつく', 6, { prior: (w) => 1 + angry(w) }),
      threat('growl', '唸る', 3, { prior: () => 2 }),
      guard('circle', '間合いをとる', 4),
      {
        id: 'sniff',
        intent: () => ({ kind: 'confide', label: '匂いを嗅ぐ' }),
        act: (tx) => trust(tx, 1),
        cond: (w) => foe(w).hostility <= 4,
        prior: (w) => 2 + foe(w).trust,
      },
      flee('run', '逃げ去る', (w) => hpOf(w) < 0.35),
    ],
    persona: { aggression: 0.7, deceit: 0, pride: 0.2, fear: 0.6, warmth: 0.5, cunning: 0.2 },
    rewards: { beaten: { coins: 0 }, trusted: { perm: 'dog-friend' } },
    model: 'dog',
    desc: '路地の奥で、こちらを見ている。',
    lines: {
      greet: [
        '（低く唸っている）',
        '（耳を伏せ、鼻先だけをこちらへ向けている）',
        '（あばらの浮いた体で、道をふさいでいる）',
      ],
      trusted: [
        '（尻尾を一度だけ振った）',
        '（あなたの手の匂いを、長いこと嗅いでいた）',
        '（少し離れて、ついてくる）',
      ],
      fled: [
        '（闇へ消えた）',
        '（足を引きずりながら、路地の奥へ）',
        '（一度だけ振り返って、いなくなった）',
      ],
      taunt: ['（低く唸る）', '（短く吠える）', '（歯を見せたまま、退がる）'],
      mutter: [
        '（前足の傷を舐めている）',
        '（座りこんで、あなたの灯りを見ている）',
        '（鼻を鳴らす）',
      ],
    },
  },
  {
    id: 'last-customer',
    name: '最後の客',
    stratum: 1,
    tier: 'boss',
    hp: 42,
    resolve: 34,
    need: 8,
    atk: 6,
    def: 2,
    wil: 5,
    int: 5,
    agi: 3,
    hostility: 4,
    tags: ['night', 'person', 'gaze'],
    weak: ['memory', 'private'],
    guarded: ['gaze'],
    clues: ['mirror', 'cold-coffee', 'her-letter'],
    take: ['her-letter'],
    moves: [
      strike('mimic', 'あなたの真似をする', (w) => 4 + stat(w, 'ATK'), { prior: () => 2 }),
      threat('stare', '見つめ返す', 5, { prior: () => 2 }),
      mend('sip', 'コーヒーを啜る', 0, 7, { cond: (w) => resolveOf(w) < 0.6, prior: () => 3 }),
      strike('last-call', 'ラストオーダー', 12, {
        cond: (w) => hpOf(w) < 0.5,
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
      greet: [
        '遅かったね。……ずっと待ってた、とは言わないよ。',
        '座りなよ。コーヒーは、もう冷めてる。',
        'その灯り、昔は僕も持ってた。',
      ],
      again: [
        'また同じ夜だ。',
        'きみは、何度ここに来れば気が済むのかな。',
        'さっきも、こんなふうに始まった。',
      ],
      hurt: [
        'そう来ると思った。',
        '痛いね。きみの手も、痛いだろう。',
        '……窓に映ってるよ。きみの顔。',
      ],
      low: [
        'きみは、きみが思うより彼女に似ている。',
        '閉店の時間だ。僕の。',
        'もう少しだけ、ここにいさせて。',
      ],
      trusted: [
        '下へ行くといい。灯りは、点けたまま行って。',
        '彼女も、その席に座ってた。',
        'ありがとう。……いや、礼を言うのは変か。',
      ],
      broken: [
        '……ああ。もう、待たなくていいのか。',
        '窓の外が、やっと暗くなった。',
        'カップを片づけてくれるかい。',
      ],
      uncovered: [
        '手紙は、きみ宛てだった。',
        '封は切ってない。それが、僕にできた精一杯。',
        '鏡に映っていたのは、きみだよ。最初から。',
      ],
      taunt: ['ほら。きみの手だ。', '鏡みたいだろう。', 'きみがそうするなら、僕もそうする。'],
      mutter: [
        '（カップの縁を、指でなぞっている）',
        '急がなくていい。電車は、もう来ない。',
        '……黙っているところまで、似てるんだね。',
      ],
    },
  },
  // ─── 二の区画：記録の階 ─────────────────────────────────────────
  {
    id: 'archivist',
    name: '記録係',
    stratum: 2,
    tier: 'normal',
    hp: 22,
    resolve: 24,
    need: 6,
    atk: 3,
    def: 2,
    wil: 4,
    int: 6,
    agi: 2,
    hostility: 3,
    tags: ['institution', 'public', 'memory'],
    weak: ['public', 'gaze'],
    guarded: ['private'],
    clues: ['catalog', 'redacted', 'her-file'],
    take: ['her-file'],
    moves: [
      threat('correct', '訂正する', 5, { prior: () => 2 }),
      guard('file', '綴じる', 7, { prior: (w) => 1 + (hiddenClues(w) <= 1 ? 3 : 0) }),
      probe('crosscheck', '照合する', { prior: (w) => ((w.enc?.lies ?? 0) > 0 ? 4 : 1) }),
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
      greet: ['閲覧の目的は。', '閲覧票に、記入を。', 'お探しの資料は、おそらく下の段です。'],
      again: [
        '前回の閲覧記録が残っています。',
        '再閲覧ですね。手数料は、前回と同じです。',
        'あなたのカードは、これで三枚目になりました。',
      ],
      hurt: ['記録しました。', '……損傷として、記録します。', '備品です。私も。'],
      trusted: [
        'これは、目録に載っていない棚の鍵です。',
        '貸出期限は、設けないでおきます。',
        '彼女の請求記号は、ここに。',
      ],
      broken: ['……記録を、訂正します。', '索引が、もう引けません。', 'どうぞ、ご自由に閲覧を。'],
      uncovered: [
        '黒塗りの下を見ましたね。',
        'そのファイルは、廃棄済みのはずでした。',
        '……私が綴じました。命じられたとおりに。',
      ],
      taunt: ['規定どおりです。', '異議は、書面で。', '受理されません。'],
      mutter: [
        '（索引カードを、一枚ずつ繰っている）',
        '閲覧時間は、限られています。',
        '……ご用件を、もう一度。',
      ],
    },
  },
  {
    id: 'ghost',
    name: '映写技師の亡霊',
    stratum: 2,
    tier: 'normal',
    hp: 18,
    resolve: 26,
    need: 5,
    atk: 3,
    def: 0,
    wil: 6,
    int: 3,
    agi: 3,
    hostility: 2,
    tags: ['memory', 'tech', 'time'],
    weak: ['memory', 'time'],
    guarded: ['body'],
    clues: ['fire', 'last-reel'],
    take: ['fire'],
    moves: [
      threat('flicker', '明滅する', 6, { prior: () => 2 }),
      guard('reel', 'リールを替える', 6),
      strike('burn', '炎を映す', 5),
      confide('plead', '終わりを見せてくれと頼む', 2),
      flee('fade', '消える', (w) => resolveOf(w) < 0.4),
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
      greet: [
        '上映中だ。静かに。……いや、もう誰もいないか。',
        'フィルムの切れ目から来たのか。',
        '客か。久しぶりだ。',
      ],
      trusted: [
        '最後のリールを、かけてくれるか。',
        '終わりを見たら、俺も行ける気がする。',
        'ピントは、あんたが合わせてくれ。',
      ],
      fled: [
        '（光の中に溶けた）',
        '（リールの音だけが残った）',
        '（スクリーンの白に紛れて、見えなくなった）',
      ],
      uncovered: [
        '火は、俺のせいじゃなかった。……そう思いたい。',
        '煙草を、置いたままにした。あの晩だけ。',
        '扉の鍵を閉めたのは、誰だったんだろうな。',
      ],
      taunt: ['目を逸らすな。', 'これが、あの夜の光だ。', '熱いだろう。俺も、熱かった。'],
      mutter: [
        '（フィルムの端を、指で確かめている）',
        '……巻き取りが遅れてる。',
        'あんたも、終わりを待ってるのか。',
      ],
    },
  },
  {
    id: 'usher',
    name: '案内係',
    stratum: 2,
    tier: 'normal',
    hp: 22,
    resolve: 18,
    need: 5,
    atk: 4,
    def: 2,
    wil: 4,
    int: 3,
    agi: 3,
    hostility: 3,
    tags: ['place', 'gaze', 'institution'],
    weak: ['place', 'private'],
    guarded: ['public'],
    clues: ['flashlight', 'empty-seat', 'ticket'],
    take: ['ticket'],
    hush: true,
    moves: [
      strike('shine', '照らす', 5, { prior: (w) => 1 + angry(w) }),
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
      greet: [
        '（唇に指を当てる）',
        '（懐中電灯で、足元を照らしてくれる）',
        'チケットを、拝見します。',
      ],
      hurt: ['……上映中です。', 'お客様。', '（懐中電灯の輪が、震えた）'],
      trusted: [
        'G 列の 7 番へどうぞ。ずっと、空けてありました。',
        '途中からでも、構いません。どうぞ。',
        '終わるまで、お席はそのままに。',
      ],
      uncovered: [
        'その席の人は、もう来ません。',
        '切符の半券は、私が持っています。',
        '最後に来たのは、雨の夜でした。',
      ],
      taunt: ['お静かに。', '（まっすぐ、あなたの目を照らす）', 'ほかのお客様の、ご迷惑です。'],
      mutter: [
        '（通路に立ったまま、動かない）',
        '……お席は、お決まりですか。',
        '（懐中電灯を、ゆっくり左右に振っている）',
      ],
    },
  },
  {
    id: 'silverfish',
    name: '紙魚の群れ',
    stratum: 2,
    tier: 'danger',
    hp: 26,
    resolve: 8,
    need: 99,
    atk: 4,
    def: 0,
    wil: 0,
    int: 0,
    agi: 5,
    hostility: 8,
    tags: ['body', 'memory'],
    weak: ['body', 'tech'],
    guarded: ['trust'],
    clues: ['paper-diet'],
    take: [],
    mute: true,
    moves: [
      strike('swarm', '群がる', 7, { prior: () => 3 }),
      guard('scatter', '散る', 6),
      mend('multiply', '殖える', 7, 0, { prior: (w) => (hpOf(w) < 0.6 ? 4 : 1) }),
    ],
    persona: { aggression: 0.8, deceit: 0, pride: 0, fear: 0.4, warmth: 0, cunning: 0.1 },
    rewards: { beaten: { coins: 10, item: 'notebook' }, uncovered: { coins: 6 } },
    model: 'swarm',
    desc: '書架の隙間から、銀色の群れが流れ出してくる。',
    lines: {
      taunt: [
        '（銀色の群れが、袖口から入り込む）',
        '（紙を食む、乾いた音）',
        '（群れが二つに分かれて、回りこむ）',
      ],
      mutter: [
        '（書架の影で、群れがゆっくり渦を巻く）',
        '（頁のめくれる音。誰も触れていない）',
        '（灯りの届かない端で、銀色が増えていく）',
      ],
    },
  },
  {
    id: 'censor',
    name: '検閲官',
    stratum: 2,
    tier: 'danger',
    hp: 34,
    resolve: 30,
    need: 8,
    atk: 6,
    def: 3,
    wil: 6,
    int: 6,
    agi: 2,
    hostility: 6,
    tags: ['institution', 'public', 'private'],
    weak: ['private', 'memory'],
    guarded: ['institution'],
    clues: ['black-ink', 'scissors', 'uncut'],
    take: ['uncut'],
    moves: [
      threat('redline', '墨を引く', 7, { prior: () => 2 }),
      strike('cut', '切る', 8, { prior: (w) => 1 + angry(w) }),
      {
        id: 'erase',
        intent: () => ({ kind: 'probe', label: '手がかりを消す' }),
        act: (tx) => {
          const shown = foe(tx.w).clues.filter((c) => c.shown && !c.false);
          const c = shown[shown.length - 1];
          if (c) {
            tx.emit({ type: 'clue', id: c.id, shown: false });
            say(tx, 'foe', 'その一行は、なかったことに。');
          }
        },
        cond: (w) => foe(w).clues.some((c) => c.shown && !c.false),
        prior: (w) => 2 + foe(w).clues.filter((c) => c.shown).length * 2,
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
      greet: [
        'あなたの場面は、不適切です。',
        '名前を。……いえ、結構。こちらで消しますので。',
        '台本を拝見。ああ、これは長すぎる。',
      ],
      hurt: ['……削除対象。', 'その場面は、通しません。', '記録に残らない傷です。'],
      trusted: [
        '一場面だけ、残しておきましょう。',
        '鋏を置きます。今夜だけは。',
        'この行は、塗らずにおきます。',
      ],
      uncovered: [
        '切らなかった場面が、ひとつだけある。',
        'あれは、私の母の顔でした。',
        '塗っても塗っても、下から滲んでくるのです。',
      ],
      taunt: ['削除しました。', '不適切です。', 'ほら、なかったことになった。'],
      mutter: [
        '（墨の筆先を、整えている）',
        '沈黙は結構。検閲の手間が省ける。',
        '……どこから、切りましょうか。',
      ],
    },
  },
  {
    id: 'projector',
    name: '映写機',
    stratum: 2,
    tier: 'boss',
    hp: 52,
    resolve: 42,
    need: 9,
    atk: 6,
    def: 2,
    wil: 6,
    int: 5,
    agi: 2,
    hostility: 5,
    tags: ['tech', 'memory', 'gaze'],
    weak: ['memory', 'time'],
    guarded: ['tech'],
    clues: ['last-reel'],
    take: [],
    moves: [
      threat(
        'replay',
        'あなたの記憶を上映する',
        (w) => 4 + w.you.perms.filter((id) => permDef(id)?.kind === 'memory').length * 2,
        { prior: () => 3 },
      ),
      strike('glare', '光を浴びせる', 8, { prior: () => 2 }),
      mend('rewind', '巻き戻す', 6, 8, { cond: (w) => hpOf(w) < 0.7, prior: () => 3 }),
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
      greet: [
        '（スクリーンに、あなたの夜が映る）',
        '（カタカタと、フィルムが送られはじめる）',
        '（光の筋が、あなたの胸で止まる）',
      ],
      hurt: ['（フィルムが軋む）', '（画面が一瞬、白く飛んだ）', '（コマが一つ、抜け落ちた）'],
      trusted: [
        '（光が、柔らかくなった）',
        '（スクリーンに、知らない誰かの笑顔が映る）',
        '（映写機が、ゆっくり回転を落とす）',
      ],
      uncovered: [
        '（最後の場面で、フィルムが止まった）',
        '（焼けたコマの向こうに、彼女の背中）',
        '（映写窓の奥に、もう一台の映写機が見える）',
      ],
      taunt: [
        '（忘れたかった場面が、大写しになる）',
        '（同じ場面が、もう一度かかる）',
        '（客席のどこかで、笑い声）',
      ],
      mutter: [
        '（スクリーンに、黙っているあなたが映る）',
        '（フィルムの端が、空回りしている）',
        '（光の中の埃だけが動いている）',
      ],
    },
    shape: (w, f) => {
      // 映写機の手がかりは、あなたの記憶。
      const mine = w.you.perms.filter((id) => permDef(id)?.kind === 'memory').slice(0, 4);
      if (mine.length) f.clues = mine.map((id) => ({ id, shown: false }));
    },
  },
  // ─── 三の区画：琥珀の階 ─────────────────────────────────────────
  {
    id: 'mother',
    name: '母の声',
    stratum: 3,
    tier: 'normal',
    hp: 20,
    resolve: 30,
    need: 6,
    atk: 2,
    def: 0,
    wil: 7,
    int: 4,
    agi: 1,
    hostility: 2,
    tags: ['person', 'memory', 'trust'],
    weak: ['trust', 'memory'],
    guarded: ['body'],
    clues: ['voicemail', 'lullaby', 'illness'],
    take: ['voicemail'],
    moves: [
      threat('come-home', '帰ってきなさい', 6, { prior: () => 3 }),
      threat('lullaby', '子守歌', 4),
      mend('worry', '心配する', 0, 6, { prior: (w) => (resolveOf(w) < 0.6 ? 4 : 1) }),
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
      greet: [
        'もしもし。……ちゃんと、ごはん食べてる？',
        'あら、出てくれたの。めずらしいわね。',
        'もしもし。お母さんです。……元気？',
      ],
      again: ['また電話くれたのね。', '昨日も、声を聞いた気がする。', '何度でも、かけてきなさい。'],
      hurt: ['……どうして。', 'そんな言い方、しなくても。', '……ごめんね。お母さん、何か言った？'],
      trusted: [
        'いいのよ。行ってらっしゃい。',
        '寒くないようにね。',
        '帰る場所は、ちゃんと置いておくから。',
      ],
      broken: ['……そう。もう、帰ってこないのね。', '電話、切るわね。', '（発信音だけが続く）'],
      uncovered: [
        '病院のことは、黙っていてごめんね。',
        '検査の結果ね。……まだ、聞かないで。',
        'あの子のことも、知ってたのよ。お母さん。',
      ],
      taunt: [
        'あなたのためを思って言ってるの。',
        'ほら、言わんこっちゃない。',
        '昔から、そうなんだから。',
      ],
      mutter: [
        '……もしもし？　聞こえてる？',
        '（受話器の向こうで、やかんが鳴っている）',
        '黙ってても、わかるのよ。',
      ],
    },
  },
  {
    id: 'drone',
    name: '製油所のドローン',
    stratum: 3,
    tier: 'danger',
    hp: 34,
    resolve: 99,
    need: 99,
    atk: 7,
    def: 4,
    wil: 0,
    int: 0,
    agi: 2,
    hostility: 8,
    tags: ['tech', 'body', 'place'],
    weak: ['tech', 'body'],
    guarded: ['trust', 'person'],
    clues: ['overheat', 'serial'],
    take: [],
    mute: true,
    moves: [
      strike('burn', '焼く', (w) => 7 + (foe(w).atk - 4) + 2 * (foe(w).st.heat ?? 0), {
        prior: () => 3,
      }),
      {
        id: 'heat',
        intent: () => ({ kind: 'guard', label: '出力を上げる' }),
        act: (tx) => {
          tx.emit({ type: 'foe', field: 'guard', n: 6 + foe(tx.w).def });
          tx.emit({ type: 'foe.st', key: 'heat', n: 1 });
        },
        prior: () => 2,
      },
      {
        id: 'vent',
        intent: () => ({ kind: 'mend', label: '排熱する' }),
        act: (tx) => {
          const f = foe(tx.w);
          tx.emit({ type: 'foe', field: 'hp', n: Math.min(6, f.maxHp - f.hp) });
          tx.emit({ type: 'foe.st', key: 'heat', n: -(f.st.heat ?? 0) });
        },
        cond: (w) => (foe(w).st.heat ?? 0) >= 2,
        prior: (w) => 1 + (foe(w).st.heat ?? 0),
        repeat: 1,
      },
    ],
    persona: { aggression: 0.8, deceit: 0, pride: 0, fear: 0.2, warmth: 0, cunning: 0.4 },
    rewards: { beaten: { coins: 18, item: 'brass' }, uncovered: { coins: 12 } },
    model: 'drone',
    desc: '止まったはずの製油所で、一台だけが巡回を続けている。',
    lines: {
      taunt: ['（熱の線が、袖を焦がした）', '（短い警告音）', '（赤い灯が、あなたに合わせて瞬く）'],
      mutter: [
        '（同じ円を、何度も巡回している）',
        '（ファンの音が、上がったり下がったりする）',
        '（レンズが、あなたの灯りに焦点を合わせなおす）',
      ],
    },
  },
  {
    id: 'geologist',
    name: '地質学者',
    stratum: 3,
    tier: 'danger',
    hp: 36,
    resolve: 32,
    need: 7,
    atk: 6,
    def: 3,
    wil: 5,
    int: 7,
    agi: 2,
    hostility: 5,
    tags: ['place', 'time', 'public'],
    weak: ['place', 'time'],
    guarded: ['public'],
    clues: ['core-sample', 'factory-smell', 'rival-notes'],
    take: ['factory-smell', 'rival-notes'],
    moves: [
      strike('hammer', 'ハンマー', 9, { prior: (w) => 1 + angry(w) }),
      threat('lecture', '講釈を垂れる', 6, { prior: () => 2 }),
      probe('sample', 'あなたを採取する', { prior: (w) => ((w.enc?.lies ?? 0) > 0 ? 4 : 1.5) }),
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
      greet: [
        'その層は千年前だ。踏むな。',
        '灯りを下げろ。琥珀が曇る。',
        'ちょうどいい。標本が足りなかった。',
      ],
      hurt: ['野蛮だな。', 'その手で、何層壊した。', '……骨にひびが入った。いい試料になる。'],
      trusted: [
        'もう一人の灯り持ちも、同じことを訊いた。',
        'この層の下に、階段がある。図面にはないがね。',
        'ルーペを貸そう。返さなくていい。',
      ],
      uncovered: [
        'この臭いを、どこで嗅いだ？',
        '製油所の層だ。あの年だけ、黒い。',
        'あいつの手帳を、私は読んだ。勝手にな。',
      ],
      taunt: ['硬度が足りないな。', '風化だよ。きみの。', 'ほら、割れた。'],
      mutter: [
        '（ルーペで、あなたの靴の泥を見ている）',
        '沈黙も、堆積する。',
        '……結論を急ぐのは、素人だ。',
      ],
    },
  },
  {
    id: 'insect',
    name: '琥珀の蟲',
    stratum: 3,
    tier: 'danger',
    hp: 28,
    resolve: 20,
    need: 99,
    atk: 6,
    def: 3,
    wil: 2,
    int: 0,
    agi: 4,
    hostility: 7,
    tags: ['body', 'time'],
    weak: ['body', 'gaze'],
    guarded: ['trust'],
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
    lines: {
      taunt: [
        '（針が、皮膚の下で冷たい）',
        '（羽音が、一段高くなる）',
        '（琥珀の欠片を散らして、宙で向きを変える）',
      ],
      mutter: [
        '（半分だけ自由な羽を、ゆっくり開いては閉じる）',
        '（複眼に、あなたの灯りが何百も映っている）',
        '（固まったほうの体を、引きずっている）',
      ],
    },
  },
  {
    id: 'hound',
    name: '化石の犬',
    stratum: 3,
    tier: 'danger',
    hp: 32,
    resolve: 16,
    need: 5,
    atk: 7,
    def: 2,
    wil: 2,
    int: 0,
    agi: 4,
    hostility: 7,
    tags: ['body', 'trust', 'memory'],
    weak: ['trust', 'memory'],
    guarded: ['institution'],
    clues: ['hurt-paw', 'hunger'],
    take: [],
    mute: true,
    moves: [
      strike('bite', '噛み砕く', 8, { prior: (w) => 1 + angry(w) }),
      threat('howl', '遠吠え', 5),
      guard('crouch', '身を伏せる', 6),
      {
        id: 'nuzzle',
        intent: () => ({ kind: 'confide', label: '鼻を寄せる' }),
        act: (tx) => trust(tx, 1),
        cond: (w) => foe(w).hostility <= 4,
        prior: (w) => 2 + foe(w).trust,
      },
    ],
    persona: { aggression: 0.7, deceit: 0, pride: 0.2, fear: 0.3, warmth: 0.6, cunning: 0.2 },
    rewards: { beaten: { coins: 10 }, trusted: { perm: 'dog-friend', help: true } },
    model: 'dog',
    desc: '骨の半分が琥珀になった犬。',
    lines: {
      greet: [
        '（骨が軋む音がする）',
        '（琥珀の目が、灯りを映して光る）',
        '（鼻先を上げて、空気を嗅いでいる）',
      ],
      again: [
        '（あなたの匂いを覚えている）',
        '（一度だけ、短く鼻を鳴らした）',
        '（前より少し近くで、待っていた）',
      ],
      trusted: [
        '（隣に座った）',
        '（あなたの手に、乾いた鼻を押しつけた）',
        '（先に立って、階段を一段下りた）',
      ],
      taunt: ['（低く唸る）', '（琥珀の牙が、灯りを弾く）', '（遠吠えが、地層に吸い込まれていく）'],
      mutter: [
        '（伏せたまま、尻尾の骨を一度だけ鳴らす）',
        '（あなたの靴の匂いを嗅いでいる）',
        '（耳だけが、上の階のほうを向く）',
      ],
    },
    shape: (w, f) => {
      if (w.you.perms.includes('dog-friend')) {
        f.trust = f.need - 1;
        f.hostility = 1;
      }
    },
    init: (tx) => {
      if (tx.w.you.perms.includes('dog-friend')) say(tx, 'voice', 'あの路地の犬だ。覚えている。');
    },
  },
  {
    id: 'volume',
    name: '体積',
    stratum: 3,
    tier: 'boss',
    hp: 60,
    resolve: 40,
    need: 10,
    atk: 6,
    def: 3,
    wil: 6,
    int: 6,
    agi: 3,
    hostility: 5,
    tags: ['memory', 'time', 'place', 'body'],
    weak: ['trust', 'memory'],
    guarded: [],
    clues: [],
    take: [],
    moves: [0, 1, 2]
      .map(
        (k): MoveDef => ({
          id: `echo-${k}`,
          intent: (w) => {
            const echo = echoOf(w, k);
            return { kind: echo.kind, label: echo.label, power: echo.power + w.stratum };
          },
          act: (tx) => {
            const echo = echoOf(tx.w, k);
            if (echo.kind === 'strike') hurt(tx, strikeValue(tx.w, echo.power + tx.w.stratum));
            else hurtMind(tx, threatValue(tx.w, echo.power + tx.w.stratum));
          },
          prior: () => 2,
        }),
      )
      .concat([
        guard('expand', '膨らむ', 8, { prior: (w) => (hpOf(w) < 0.5 ? 3 : 1) }),
        mend('settle', '沈殿する', 8, 6, { cond: (w) => hpOf(w) < 0.6 }),
        confide('accept', 'あなたの記憶を差し出す', 5),
      ]),
    persona: { aggression: 0.6, deceit: 0.4, pride: 0.5, fear: 0, warmth: 0.3, cunning: 0.9 },
    rewards: {},
    model: 'volume',
    desc: 'いちばん深いところに、立方体がある。一辺は、あなたが経験してきたことの数で決まる。',
    lines: {
      greet: [
        '（立方体の面に、あなたの夜が刻まれている）',
        '（立方体が、あなたの歩幅に合わせて大きくなる）',
        '（どの面にも、あなたの灯りが映っている）',
      ],
      hurt: [
        '（辺が、少し縮んだ）',
        '（角が欠けて、古い夜がこぼれる）',
        '（面の一つに、ひびが入った。あなたの記憶の形に）',
      ],
      low: [
        '（立方体が、あなたの声で話しはじめる）',
        'ここまで、よく運んできたね。',
        '（面が一枚、内側へ倒れかける）',
      ],
      trusted: [
        'ぜんぶ、持っていっていい。重さはそのままだけど。',
        '置いていってもいいんだよ。ここなら、誰も数えない。',
        '（立方体が、手で持てるくらいの大きさになる）',
      ],
      broken: [
        '（立方体は、ただの土に戻った）',
        '（辺がほどけて、ただの夜になる）',
        '（残ったのは、手のひらほどの琥珀だけ）',
      ],
      uncovered: [
        '（面の一つに、彼女の名前があった）',
        '（いちばん底の面に、事故の日付）',
        '（内側に、もう一つ小さな立方体）',
      ],
      taunt: [
        '（あなた自身の重さが、のしかかる）',
        'それも、あなたが持ってきたものだよ。',
        '（面に、さっきのあなたのしくじりが映る）',
      ],
      mutter: [
        '（立方体は、待つことに慣れている）',
        '（辺が、ほんの少しずつ伸びている）',
        '黙っていても、体積は変わらない。',
      ],
    },
    shape: (w, f) => {
      // 体積はあなたの履歴でできている。辺は経験の数、手がかりはあなたの永続カード。
      const mine = w.you.perms.filter((id) => id !== 'false-lead');
      const edge = 3 + Math.min(3, Math.floor(mine.length / 4));
      const k = PACE.tough * (1 + 0.1 * w.depth);
      f.hp = f.maxHp = Math.round((edge ** 3 / 2 + 20) * k);
      const memories = mine.filter((id) => permDef(id)?.kind === 'memory').length;
      f.resolve = f.maxResolve = Math.round((14 + 4 * memories) * k);
      const bonds = mine.filter((id) => permDef(id)?.kind === 'bond').length;
      f.need = Math.round(Math.max(6, 14 - 2 * bonds) * k);
      const her = (id: string) => (HER.includes(id) ? 1 : 0);
      const ordered = [...mine].sort((a, b) => her(b) - her(a));
      f.clues = ordered.slice(0, 6).map((id) => ({ id, shown: false }));
      f.st.edge = edge;
    },
  },
  // ─── もう一人の灯り持ち（数は遭遇のときにライバルの人物から入れる） ───
  {
    id: 'rival',
    name: 'もう一人の灯り持ち',
    stratum: 0,
    tier: 'danger',
    hp: 30,
    resolve: 26,
    need: 7,
    atk: 5,
    def: 2,
    wil: 4,
    int: 4,
    agi: 3,
    hostility: 4,
    tags: ['person', 'place', 'private'],
    weak: ['private', 'trust'],
    guarded: ['place'],
    clues: [],
    take: [],
    moves: [
      strike('lamp', '灯りを叩きつける', 6, { prior: (w) => 1 + angry(w) }),
      threat('taunt', '先に着くのは自分だ', 5, { prior: () => 2 }),
      probe('read', 'あなたを読む', { prior: () => 1.5 }),
      guard('dark', '灯りを消して暗がりに沈む', 6),
      confide('notes', '手帳を見せる', 4),
      flee('climb', '非常階段へ逃げる', (w) => hpOf(w) < 0.3),
    ],
    persona: { aggression: 0.5, deceit: 0.4, pride: 0.8, fear: 0.3, warmth: 0.3, cunning: 0.8 },
    rewards: {
      beaten: { coins: 20 },
      broken: { coins: 15 },
      trusted: { perm: 'rival-notes', help: true },
      uncovered: { coins: 15 },
    },
    model: 'rival',
    desc: 'あなたと同じ型の灯りを提げている。先を行っているぶん、少しだけ煤けている。',
    lines: {
      greet: [
        '同じ階段を下りてるとは思わなかった。',
        'その灯り、どこで手に入れた。……同じ店か。',
        '先に来たのは、俺だ。',
      ],
      again: [
        'また会ったな。今度は譲らない。',
        '階段は、一本しかないらしい。',
        '追いつかれるとはな。',
      ],
      hurt: ['……やるじゃないか。', '俺の手の癖まで、同じだな。', '痛いところを、よく知ってる。'],
      trusted: [
        '灯りは二つあったほうがいい。底で会おう。',
        'これを持っていけ。俺の手帳だ。お前なら読める。',
        '下へは、右の階段が近い。嘘じゃない。',
      ],
      broken: ['先に行け。', '……灯りが重い。今夜は、もう持てない。', '俺が見つけるはずだった。'],
      uncovered: [
        '俺も、彼女を探してる。',
        '助手席にいたのは、俺だと思ってた。',
        'お前の手帳と、同じことが書いてある。',
      ],
      fled: ['底で待ってる。', '（灯りが、非常階段を上へ遠ざかっていく）', '次の区画で。'],
      taunt: ['先に着くのは、俺だ。', '遅いな。', '知ってたよ。お前なら、そう動く。'],
      mutter: [
        '（灯りの芯を、あなたと同じ手つきで直している）',
        '迷うところまで、同じなんだな。',
        '……先に行くぞ。言ってみただけだ。',
      ],
    },
  },
];

/** 体積の手。あなたの記憶から 3 つを、その声で使う。 */
const HER = ['promise', 'saw-her', 'her-letter', 'her-file', 'truth'];

function echoOf(w: World, k: number): { label: string; kind: 'strike' | 'threat'; power: number } {
  const mine = w.you.perms.filter((id) => permDef(id)?.echo);
  const id = mine[(k * 3 + (foe(w).st.edge ?? 0)) % Math.max(1, mine.length)];
  const echo = id ? permDef(id)?.echo : undefined;
  return (
    echo ??
    (k % 2 === 0
      ? { label: '押し潰す', kind: 'strike', power: 7 }
      : { label: '沈黙で満たす', kind: 'threat', power: 6 })
  );
}
