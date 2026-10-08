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
        '懐中電灯を下ろせ。……いや、それは俺のほうか。',
      ],
      again: [
        'また、あんたか。',
        '巡回のたびに、あんたに会う。',
        '今夜は、これで何度目だ。',
        '前の晩も、その角に立ってたな。',
      ],
      heard: [
        '下の連中が言ってた。灯りを提げて、人の昔を掘るやつがいると。',
        '噂は聞いてる。手帳に書くほどじゃないがな。',
        'あんたか。北の階段を訊いて回ってるのは。',
        '名前は知らん。灯りの形だけは、聞いてる。',
      ],
      hurt: [
        '……公務執行妨害だぞ。',
        '膝に来た。古傷なんだ。',
        'やめろ。書類が増える。',
        '左だ。左を狙うな。……言わなきゃよかった。',
      ],
      low: [
        '待て、待ってくれ。',
        'わかった。少し、話そう。',
        '俺にも、家で待ってるやつがいる。',
        '財布だけは、やめてくれ。写真が入ってる。',
      ],
      trusted: [
        '……わかった。灯りを二度点けたら、行ってやる。',
        '娘の写真、見るか。……いや、いい。行け。',
        'あの夜、あの子を見た。北の階段だ。',
        '十一時過ぎだった。時計を見たから、覚えてる。',
      ],
      broken: [
        '持っていけ。どうせ俺には重すぎた。',
        '制服を脱いだら、俺には何が残る。',
        '……好きにしろ。',
        '番号は、削っておけ。俺の名前が出る。',
      ],
      beaten: [
        '…………',
        '（懐中電灯が、床を転がっていく）',
        '……報告は、しない。',
        '（膝を抱えて、座りこんだ）',
      ],
      uncovered: [
        'どこまで知ってる。……いや、いい。',
        '写真のことは、誰にも言うな。',
        '見たよ。見たが、止めなかった。',
        '娘と同じ年頃だった。だから、目を逸らした。',
      ],
      fled: [
        '（膝をかばいながら、巡回の道へ戻っていった）',
        '応援を呼んでくる。……戻るとは言ってない。',
        '（懐中電灯の輪が、角の向こうへ遠ざかる）',
        '今夜は、見なかったことにする。',
      ],
      caught: [
        '嘘は、顔に出る。二十年、見てきた。',
        'その話、調書と違うな。',
        '通行証の番号、さっきと違うぞ。',
        '嘘をつくなら、もっと短くしろ。',
      ],
      taunt: [
        '言ったろう。ここは通さない。',
        '夜は長いぞ。',
        'これも仕事だ。悪く思うな。',
        '膝が悪くても、腕は動く。',
      ],
      stagger: [
        '（よろめいて、左膝をついた）',
        '（懐中電灯が手から跳ねて、壁を照らした）',
        '（制帽が落ちる。拾う暇がない）',
        '待て、順番に──',
      ],
      mutter: [
        '（懐中電灯を、点けたり消したりしている）',
        '……膝が冷える。',
        '黙ってるなら、名前だけでも書いていけ。',
        '（財布を出しかけて、また戻した）',
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
      threat('closing', 'もう閉店だ', 3, { prior: (w) => 1 + Math.min(4, w.hour / 3) }),
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
        '（グラスを拭く手を止めずに、顎で席を示す）',
      ],
      again: [
        'また来たのか。席は空いてる。',
        'いつもの、でいいか。',
        '同じ席に座るんだな。あんたも。',
        '端から二つ目だろ。空けておいた。',
      ],
      heard: [
        '灯りの客の話は、聞いてる。払いはいいらしいな。',
        '噂じゃ、あんたは何でも訊くそうだ。',
        '下の階の連中が、あんたの話をしていった。',
        '探し物の客か。この店には、よく来る。',
      ],
      hurt: [
        'おい、店の中だぞ。',
        'グラスが割れる。',
        '……修理代は、つけておく。',
        '帽子に、染みがついた。',
      ],
      low: [
        '待ってくれ。レジの金なら、やる。',
        '店を閉めさせてくれ。それだけでいい。',
        'もう、拭くものがない。',
        '（帽子を胸に当てて、息を整えている）',
      ],
      trusted: [
        '奥の縦坑なら、鍵はここだ。持ってけ。',
        'お代はいい。今夜はもう、帳場を閉めた。',
        '冷めないうちに、飲んでいけ。',
        'あの子の煙草だ。一本、持っていけ。',
      ],
      broken: [
        'わかった、わかったよ。',
        '好きなだけ持っていけ。店は、もう終わりだ。',
        '……帽子を、取らせてくれ。',
        '灯りを消すのは、あんたがやってくれ。',
      ],
      beaten: [
        '（カウンターの内側に、ずるずると座りこんだ）',
        '……今夜は、閉店だ。',
        '（拭きかけのグラスが、床で回っている）',
        'レジは、開いてる。勝手にしろ。',
      ],
      uncovered: [
        '……煙草、同じのを吸ってたな。あの子も。',
        'あの子は、窓際の席だった。いつも。',
        '閉店の札を出したのは、俺だ。あの夜も。',
        '追い出したんだ。雨だったのに。',
      ],
      fled: [
        '（奥の厨房へ消えた。換気扇だけが回っている）',
        '仕入れに行ってくる。……朝までには戻る。',
        '（白い帽子だけが、カウンターに残った）',
        '店番、頼んだ。',
      ],
      caught: [
        'その話、前にも聞いた。別の客から。',
        '嘘をつくなら、コーヒーを頼んでからにしろ。',
        '嘘の客は、顔でわかる。皿を見ない。',
        'あんた、さっきは砂糖を入れなかったろう。',
      ],
      taunt: [
        '閉店だと言ったろう。',
        '勘定は、まだだぞ。',
        '悪いが、ここは俺の店だ。',
        '熱いのは、コーヒーだけじゃない。',
      ],
      stagger: [
        '（背中が棚に当たって、カップが三つ落ちた）',
        '（布巾が手から滑る。拾えない）',
        '待て、グラスが──',
        '（帽子がずれて、目が隠れた）',
      ],
      mutter: [
        '（同じグラスを、まだ拭いている）',
        'コーヒー、淹れなおすか。',
        '……迷ってるなら、座ればいい。',
        '（時計を見る。三度目だ）',
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
        '座れよ。そこ、息子の……いや、空いてる。',
      ],
      again: [
        'よう。……前にも会ったか？',
        'ああ、あんたか。たぶん。',
        '顔は覚えてる。名前は飲んじまった。',
        'また来たな。俺もだ。毎晩だ。',
      ],
      heard: [
        'あんたが、人の昔を掘ってるやつか。',
        '噂の灯り持ちか。掘っても、何も出ねえぞ。',
        '話は聞いた。……誰からだったかな。',
        '俺の話も、もう誰かから聞いたんだろ。',
      ],
      hurt: [
        'いてえな。',
        '酔いが、覚めちまうだろうが。',
        'おい、帽子が。',
        '血か。……酒より薄いな。',
      ],
      low: [
        '勘弁してくれ。',
        '悪かった。何が悪かったかは知らんが。',
        'もう飲まない。今夜は。',
        '息子の話なら、するから。殴るな。',
      ],
      trusted: [
        '奢るよ。一杯だけな。',
        'あんた、いいやつだな。息子に似てる。……似てないか。',
        '本当のことを言うとな。……やっぱり、明日にする。',
        'あの夜は、家にいた。一人で。誰も証明できない。',
      ],
      broken: [
        'わかったよ。全部、作り話だ。',
        '店の名前なんか、最初からなかった。',
        '（帽子を脱いだ。髪が、真っ白だった）',
        'もう一杯だけ。そしたら、帰る。',
      ],
      beaten: [
        '（椅子ごと、横に倒れた）',
        '……床が、回ってる。',
        '（グラスを握ったまま、眠ってしまった）',
        '勘定は、あんたに回しとく。',
      ],
      uncovered: [
        '息子がな。……いや、なんでもない。',
        'アリバイなんて、作り話だ。最初から。',
        'あいつは、帰ってこなかった。それだけだ。',
        'あの夜、あいつと喧嘩した。最後の言葉が、それだ。',
      ],
      fled: [
        '……帰る。',
        '勘定は、つけといてくれ。',
        '（帽子を押さえて、階段を上がっていった）',
        '（グラスを残して、千鳥足で出ていった）',
      ],
      caught: [
        'へえ。あんたも、店の名前を変えるくちか。',
        '嘘が下手だな。俺のほうが、年季が入ってる。',
        'その話、俺がさっき作ったやつだ。',
        '嘘をつくときは、目を逸らすな。俺みたいに。',
      ],
      taunt: [
        'ほら見ろ。',
        '酔っ払いを、なめるなよ。',
        'へへ。当たった。',
        '手が勝手に動くんだ。昔からな。',
      ],
      stagger: [
        '（よろけて、カウンターに顎を打った）',
        '（帽子が飛んだ。追いかけて、また転ぶ）',
        'おい、待て、床が──',
        '（グラスの中身が、全部顔にかかった）',
      ],
      mutter: [
        '（グラスの底を覗いている）',
        '黙ってると、酒がまずくなる。',
        '……で、何の話だったっけ。',
        '（空のグラスを、指で弾いている）',
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
        '（前足を一本、浮かせたまま立っている）',
      ],
      again: [
        '（あなたの匂いに、耳が一度だけ動いた）',
        '（前と同じ暗がりで、前と同じように待っていた）',
        '（唸りかけて、やめた）',
        '（尻尾が、迷うように半分だけ上がる）',
      ],
      hurt: [
        '（甲高く鳴いて、跳びのいた）',
        '（傷ついた前足を、さらに高く上げる）',
        '（歯を剥いたまま、震えている）',
        '（一歩退がる。腹が、大きく波打つ）',
      ],
      low: [
        '（腹を見せかけて、また起き上がる）',
        '（くうん、と細く鳴いた）',
        '（足を引きずって、壁際へ寄る）',
        '（唸り声が、途中でかすれた）',
      ],
      trusted: [
        '（尻尾を一度だけ振った）',
        '（あなたの手の匂いを、長いこと嗅いでいた）',
        '（少し離れて、ついてくる）',
        '（あなたの靴の上に、顎をのせた）',
      ],
      broken: [
        '（耳を伏せて、地面に伏せた）',
        '（尻尾を股に挟んで、動かない）',
        '（目を合わせなくなった）',
        '（鼻を鳴らして、路地の奥を見ている）',
      ],
      beaten: [
        '（横倒しになって、荒く息をしている）',
        '（起き上がろうとして、前足が崩れた）',
        '（小さく鳴いて、目を閉じた）',
        '（もう、唸らない）',
      ],
      uncovered: [
        '（前足の裏に、ガラスの欠片が刺さっていた）',
        '（あばらの下で、腹が鳴った）',
        '（首に、擦り切れた首輪の跡）',
        '（路地の奥に、空の皿が一つ置いてある）',
      ],
      fled: [
        '（闇へ消えた）',
        '（足を引きずりながら、路地の奥へ）',
        '（一度だけ振り返って、いなくなった）',
        '（爪の音が、階段を下りていった）',
      ],
      taunt: [
        '（低く唸る）',
        '（短く吠える）',
        '（歯を見せたまま、退がる）',
        '（袖を噛んで、首を振った）',
      ],
      stagger: [
        '（足がもつれて、ゴミ袋の山に突っ込んだ）',
        '（きゃん、と鳴いて、横に転がった）',
        '（後ずさりした先に、壁があった）',
        '（吠えようとして、むせた）',
      ],
      mutter: [
        '（前足の傷を舐めている）',
        '（座りこんで、あなたの灯りを見ている）',
        '（鼻を鳴らす）',
        '（ポケットのあたりを、じっと嗅いでいる）',
      ],
    },
  },
  {
    id: 'last-customer',
    name: '最後の客',
    stratum: 1,
    tier: 'boss',
    hp: 38,
    resolve: 34,
    need: 8,
    atk: 5,
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
      strike('mimic', 'あなたの真似をする', (w) => 2 + stat(w, 'ATK'), { prior: () => 2 }),
      threat('stare', '見つめ返す', 4, { prior: () => 2 }),
      mend('sip', 'コーヒーを啜る', 0, 7, { cond: (w) => resolveOf(w) < 0.6, prior: () => 3 }),
      strike('last-call', 'ラストオーダー', 9, {
        cond: (w) => hpOf(w) < 0.5,
        prior: () => 4,
        repeat: 1,
      }),
      lie(threat('smile', '微笑みで刺す', 4), 'wait', '微笑む'),
      confide('confess', '打ち明ける', 4),
    ],
    persona: { aggression: 0.5, deceit: 0.4, pride: 0.6, fear: 0.1, warmth: 0.4, cunning: 0.8 },
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
        '（窓ガラスの中で、先に振り向いた）',
      ],
      again: [
        'また同じ夜だ。',
        'きみは、何度ここに来れば気が済むのかな。',
        'さっきも、こんなふうに始まった。',
        '席は、前のときのままにしてある。',
      ],
      heard: [
        '噂は聞いてる。灯りを提げて、下へ行く人。',
        '彼女を探してるんだってね。僕も、昔はそうだった。',
        '給仕から聞いたよ。きみも、端の席に座るって。',
        'きみの話は、窓に映ってたよ。何度も。',
      ],
      hurt: [
        'そう来ると思った。',
        '痛いね。きみの手も、痛いだろう。',
        '……窓に映ってるよ。きみの顔。',
        '同じところだ。きみが昔、怪我をしたところ。',
      ],
      low: [
        'きみは、きみが思うより彼女に似ている。',
        '閉店の時間だ。僕の。',
        'もう少しだけ、ここにいさせて。',
        'コーヒーを、温めなおしてくれないか。',
      ],
      trusted: [
        '下へ行くといい。灯りは、点けたまま行って。',
        '彼女も、その席に座ってた。',
        'ありがとう。……いや、礼を言うのは変か。',
        '手紙は、きみが読むといい。僕は、もう覚えてる。',
      ],
      broken: [
        '……ああ。もう、待たなくていいのか。',
        '窓の外が、やっと暗くなった。',
        'カップを片づけてくれるかい。',
        '誰を待ってたのか、思い出せなくなった。',
      ],
      beaten: [
        '（窓ガラスに、ひびが一本走った）',
        '……いい手だ。僕のでもある。',
        '（カップが倒れて、冷めたコーヒーが広がる）',
        '（背もたれに沈んで、窓の外を見ている）',
      ],
      uncovered: [
        '手紙は、きみ宛てだった。',
        '封は切ってない。それが、僕にできた精一杯。',
        '鏡に映っていたのは、きみだよ。最初から。',
        '「深く掘っても、わたしはいない」。そう書いてあった。',
      ],
      fled: [
        '（気がつくと、席には冷めたカップだけ）',
        '先に出るよ。勘定は、済ませてある。',
        '（窓の中の姿だけが、まだ座っている）',
        'また、同じ夜に。',
      ],
      caught: [
        '嘘をつくときの癖まで、僕と同じだ。',
        'それは、僕が昔ついた嘘だよ。',
        '窓に映ってる。きみの、本当の顔。',
        'いいよ。僕も、彼女にそう言った。',
      ],
      taunt: [
        'ほら。きみの手だ。',
        '鏡みたいだろう。',
        'きみがそうするなら、僕もそうする。',
        '痛いのは、どっちだろうね。',
      ],
      stagger: [
        '（椅子ごと後ろへ傾いて、窓に背を打った）',
        '（真似が、一拍遅れた。初めて）',
        '待って、それは僕の──',
        '（窓の中の姿だけが、先に崩れた）',
      ],
      mutter: [
        '（カップの縁を、指でなぞっている）',
        '急がなくていい。電車は、もう来ない。',
        '……黙っているところまで、似てるんだね。',
        '（窓の外の、何もない通りを見ている）',
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
      greet: [
        '閲覧の目的は。',
        '閲覧票に、記入を。',
        'お探しの資料は、おそらく下の段です。',
        '灯りは、書架から一歩離してお持ちください。',
      ],
      again: [
        '前回の閲覧記録が残っています。',
        '再閲覧ですね。手数料は、前回と同じです。',
        'あなたのカードは、これで三枚目になりました。',
        'お帰りなさい。……失礼、記録上の挨拶です。',
      ],
      heard: [
        'あなたの名前は、すでに目録にあります。',
        '照会が来ています。灯りを持った閲覧者について。',
        '噂は記録しません。ただ、索引は作ります。',
        'あなたの件は、別綴じになっています。',
      ],
      hurt: [
        '記録しました。',
        '……損傷として、記録します。',
        '備品です。私も。',
        '頁が、一枚抜けました。',
      ],
      low: [
        'お待ちを。目録を、引き直します。',
        '番号のないものは、存在しないはずでした。',
        '私も、どこかの棚に綴じられるのでしょうか。',
        '……閲覧時間を、延長します。特例で。',
      ],
      trusted: [
        'これは、目録に載っていない棚の鍵です。',
        '貸出期限は、設けないでおきます。',
        '彼女の請求記号は、ここに。',
        'その頁の日付は、空けておきます。',
      ],
      broken: [
        '……記録を、訂正します。',
        '索引が、もう引けません。',
        'どうぞ、ご自由に閲覧を。',
        '番号を、全部忘れました。楽です。',
      ],
      beaten: [
        '（索引カードが、床一面に散らばった）',
        '……破損。修復不能。',
        '（眼鏡を拾い、かけずに握っている）',
        '閲覧を、許可します。不本意ですが。',
      ],
      uncovered: [
        '黒塗りの下を見ましたね。',
        'そのファイルは、廃棄済みのはずでした。',
        '……私が綴じました。命じられたとおりに。',
        '墨を引いたのは、彼女の名前の行だけです。',
      ],
      fled: [
        '（書架のあいだへ、足音もなく消えた）',
        '閉架へ下がります。追ってこないように。',
        '（開いたままの目録だけが残った）',
        '照会は、後日に。',
      ],
      caught: [
        '前回の記述と、一致しません。',
        'その日付は、記録にありません。',
        '訂正を求めます。あなたの発言の。',
        '照合しました。虚偽です。',
      ],
      taunt: [
        '規定どおりです。',
        '異議は、書面で。',
        '受理されません。',
        '記録に、残しておきます。',
      ],
      stagger: [
        '（カード箱が傾いて、索引が雪崩れた）',
        '待って、番号が、番号が──',
        '（眼鏡が飛んだ。書架の下へ）',
        '（綴じ紐がほどけて、頁が舞い上がる）',
      ],
      mutter: [
        '（索引カードを、一枚ずつ繰っている）',
        '閲覧時間は、限られています。',
        '……ご用件を、もう一度。',
        '（あなたの靴の泥を、記録している）',
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
        '（白い光の中に、輪郭だけが立っている）',
      ],
      again: [
        'また来たのか。同じ回だぞ。',
        '前の上映も、見ていったな。',
        '席を立たない客は、あんたくらいだ。',
        '巻き戻したのか。俺も、何度もやった。',
      ],
      heard: [
        '灯りを持った客の話は、フィルムの音で聞いた。',
        'あんたか。火を怖がらない客ってのは。',
        '下の映写機が、あんたを映したがってる。',
        '噂の灯りか。ずいぶん、ちらつかないな。',
      ],
      hurt: [
        '傷はつかないよ。もう、焼けたからな。',
        '（輪郭が、一瞬ぶれた）',
        'フィルムに、傷が入った。',
        '……熱い。まだ、熱い。',
      ],
      low: [
        '頼む。終わりだけ、見せてくれ。',
        '光が、薄くなってきた。',
        'まだ、最後の巻が残ってるんだ。',
        '（輪郭の端が、灰のように崩れていく）',
      ],
      trusted: [
        '最後のリールを、かけてくれるか。',
        '終わりを見たら、俺も行ける気がする。',
        'ピントは、あんたが合わせてくれ。',
        '缶の封は、あんたが切ってくれ。',
      ],
      broken: [
        '……もう、映すものがない。',
        '上映、終了。',
        '（光が、ゆっくり絞られていく）',
        '客席の灯りを、点けてくれ。',
      ],
      beaten: [
        '（映写機が止まり、輪郭が消えた）',
        '（スクリーンが、ただの白になった）',
        '……フィルム切れだ。',
        '（焦げた匂いだけが、部屋に残る）',
      ],
      uncovered: [
        '火は、俺のせいじゃなかった。……そう思いたい。',
        '煙草を、置いたままにした。あの晩だけ。',
        '扉の鍵を閉めたのは、誰だったんだろうな。',
        'ナイトレートは、水の中でも燃える。知ってたのに。',
      ],
      fled: [
        '（光の中に溶けた）',
        '（リールの音だけが残った）',
        '（スクリーンの白に紛れて、見えなくなった）',
        '次の回で、また。',
      ],
      caught: [
        'そのコマは、さっきのと繋がらない。',
        '嘘は、編集の跡でわかる。',
        '光を当てれば、透けて見えるぞ。',
        'その台詞は、台本にない。',
      ],
      taunt: [
        '目を逸らすな。',
        'これが、あの夜の光だ。',
        '熱いだろう。俺も、熱かった。',
        '焼きついたな。もう、消えないぞ。',
      ],
      stagger: [
        '（映像が飛んで、体が三コマぶん遅れた）',
        '（輪郭が二重にずれて、戻らない）',
        '待て、リールが外れ──',
        '（光がちらついて、半分だけ消えた）',
      ],
      mutter: [
        '（フィルムの端を、指で確かめている）',
        '……巻き取りが遅れてる。',
        'あんたも、終わりを待ってるのか。',
        '（煙草を探す手つきをして、やめた）',
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
        '（小声で）上映は、もう始まっています。',
      ],
      again: [
        '（あなたの顔を照らして、小さく頷いた）',
        'また、途中からですね。',
        '（前と同じ通路に、前と同じように立っている）',
        'お席は、前回と同じで。',
      ],
      heard: [
        '（小声で）灯りのお客様ですね。伺っています。',
        'お噂は。……ここでは、お静かに。',
        'G 列の方を、お探しだとか。',
        '（あなたの灯りを見て、自分の懐中電灯を下げた）',
      ],
      hurt: [
        '……上映中です。',
        'お客様。',
        '（懐中電灯の輪が、震えた）',
        '（声を立てずに、唇を噛んだ）',
      ],
      low: [
        '（小声で）どうか、明かりを点けないで。',
        '席を、お譲りします。ですから。',
        '（懐中電灯が、足元に落ちて転がる）',
        '……最終回まで、いさせてください。',
      ],
      trusted: [
        'G 列の 7 番へどうぞ。ずっと、空けてありました。',
        '途中からでも、構いません。どうぞ。',
        '終わるまで、お席はそのままに。',
        'この切符を。表の停留所から、下へ行けます。',
      ],
      broken: [
        '（懐中電灯を消して、通路に立ち尽くした）',
        'ご案内は、もう、できません。',
        '（制服の襟を、ゆっくりほどいた）',
        '空席は、ご自由にどうぞ。',
      ],
      beaten: [
        '（通路に膝をついた。音は立てなかった）',
        '（懐中電灯の輪が、天井を向いて止まった）',
        '……お静かに、願います。',
        '（客席の暗がりに、うずくまる）',
      ],
      uncovered: [
        'その席の人は、もう来ません。',
        '切符の半券は、私が持っています。',
        '最後に来たのは、雨の夜でした。',
        '最終回の、途中で立ったのです。灯りを持って。',
      ],
      fled: [
        '（懐中電灯が消えて、足音も消えた）',
        '休憩に、入ります。',
        '（非常口の緑の灯りの下を、くぐっていった）',
        '（通路の奥の暗がりに、輪が小さくなっていく）',
      ],
      caught: [
        'その半券は、日付が違います。',
        '（懐中電灯で、あなたの口元を照らした）',
        'その回は、上映していません。',
        'お客様。お静かに。嘘も、です。',
      ],
      taunt: [
        'お静かに。',
        '（まっすぐ、あなたの目を照らす）',
        'ほかのお客様の、ご迷惑です。',
        '通路は、走らないで。',
      ],
      stagger: [
        '（座席の肘掛けに躓いて、二列ぶん転げた）',
        '（懐中電灯が回って、天井を照らした）',
        '（小さな悲鳴を、手で押さえこんだ）',
        '（帽子が飛んで、客席に消えた）',
      ],
      mutter: [
        '（通路に立ったまま、動かない）',
        '……お席は、お決まりですか。',
        '（懐中電灯を、ゆっくり左右に振っている）',
        '（スクリーンのほうを、一度だけ振り返る）',
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
      greet: [
        '（書架の隙間から、銀色が溢れ出す）',
        '（床一面の紙屑が、いっせいに動いた）',
        '（頁の裏から、細い脚が何千と覗く）',
        '（灯りを避けて、群れが二つに割れる）',
      ],
      again: [
        '（群れの一部が、あなたの手帳の匂いを覚えている）',
        '（前より、少し数が多い）',
        '（前に追い払ったはずの棚に、また渦がある）',
        '（袖口の糊を目がけて、まっすぐ寄ってくる）',
      ],
      hurt: [
        '（群れの端が、ぱらぱらと崩れ落ちた）',
        '（潰れた銀色が、紙粉になって舞う）',
        '（渦が乱れて、一瞬、床が見えた）',
        '（かさかさ、という音が、ひとつ減った）',
      ],
      low: [
        '（残った群れが、一冊の本の中へ逃げこもうとする）',
        '（銀色の筋が、細く、まばらになる）',
        '（書架の隙間へ、ちりぢりに散っていく）',
        '（動きが、乾いた紙のように鈍くなった）',
      ],
      trusted: [
        '（群れが、あなたの足元を避けて流れていく）',
        '（一筋だけが、袖をかすめて去った）',
        '（灯りの輪の外で、静かに止まった）',
        '（食べかけの頁を一枚、あなたのほうへ残していった）',
      ],
      broken: [
        '（群れが、ばらばらの小さな虫に戻った）',
        '（渦がほどけて、ただの埃になる）',
        '（銀色が、書架の下へ一列になって退いていく）',
        '（もう、群れの形をとらない）',
      ],
      beaten: [
        '（床に、銀色の粉だけが残った）',
        '（最後の一匹が、頁の間に挟まって動かない）',
        '（かさかさという音が、止んだ）',
        '（食い荒らされた本が一冊、ぱたりと閉じた）',
      ],
      uncovered: [
        '（群れの通った跡に、文字だけが残っている）',
        '（食べ残しの頁に、あなたの名前の半分）',
        '（糊の匂いのする本だけを、選んで食べている）',
        '（巣の奥に、黒塗りの紙だけが食べられずに積まれていた）',
      ],
      fled: [
        '（群れが一つの線になって、床の割れ目へ流れこんだ）',
        '（書架の裏へ、銀色の川が引いていく）',
        '（ばらばらに散って、紙の中に消えた）',
        '（乾いた音が、遠くの棚へ移っていった）',
      ],
      taunt: [
        '（銀色の群れが、袖口から入り込む）',
        '（紙を食む、乾いた音）',
        '（群れが二つに分かれて、回りこむ）',
        '（手帳の角が、いつのまにか齧られている）',
      ],
      stagger: [
        '（渦が弾けて、群れが天井まで舞い上がった）',
        '（銀色の波が崩れて、互いに乗り上げる）',
        '（群れの真ん中に、穴が空いた）',
        '（散った群れが、元の形を思い出せずにいる）',
      ],
      mutter: [
        '（書架の影で、群れがゆっくり渦を巻く）',
        '（頁のめくれる音。誰も触れていない）',
        '（灯りの届かない端で、銀色が増えていく）',
        '（床の索引カードが、一枚ずつ薄くなっていく）',
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
      lie(strike('approve', '印で打ち据える', 9), 'wait', '許可する'),
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
        '灯りは困ります。見えなくていいものまで見える。',
      ],
      again: [
        'まだ、残っていましたか。あなたの場面。',
        '前回、確かに切ったはずですが。',
        '再審査ですね。結果は同じです。',
        '同じ場面を、二度は通しません。',
      ],
      heard: [
        'あなたの名前は、すでに塗ってあります。',
        '噂の灯り持ち。報告書が、三冊になりました。',
        '余計なものを掘り返すと、聞いています。',
        '彼女の件を、蒸し返しているそうですね。',
      ],
      hurt: [
        '……削除対象。',
        'その場面は、通しません。',
        '記録に残らない傷です。',
        '袖に、墨が。……許可していません。',
      ],
      low: [
        '待ちなさい。まだ、審査の途中です。',
        '鋏が、言うことを聞かない。',
        '一場面だけ。一場面だけなら、通します。',
        '黒が、足りない。塗っても塗っても。',
      ],
      trusted: [
        '一場面だけ、残しておきましょう。',
        '鋏を置きます。今夜だけは。',
        'この行は、塗らずにおきます。',
        'あなたの名前の行は、元に戻しました。',
      ],
      broken: [
        '……全部、通してしまえばいい。',
        '墨が乾いた。もう、引けない。',
        '（鋏が、机の上で開いたまま止まった）',
        '何を消していたのか、思い出せない。',
      ],
      beaten: [
        '（机が倒れて、墨が床に広がった）',
        '（切り取られたフィルムが、雪のように降る）',
        '……不適切、です。',
        '（判子を握ったまま、動かない）',
      ],
      uncovered: [
        '切らなかった場面が、ひとつだけある。',
        'あれは、私の母の顔でした。',
        '塗っても塗っても、下から滲んでくるのです。',
        '事故の記事も、私が切りました。一面ごと。',
      ],
      fled: [
        '審査は、延期します。',
        '（墨壺を抱えて、奥の扉に消えた）',
        '（黒い帯を一本、床に引き残していった）',
        'この場面は、なかったことに。',
      ],
      caught: [
        '虚偽。削除します。',
        'その台詞は、前の版と違う。',
        '嘘は塗りやすい。形が、はっきりしているから。',
        '私の前で、言葉を足さないでください。',
      ],
      taunt: [
        '削除しました。',
        '不適切です。',
        'ほら、なかったことになった。',
        '一行、短くなりましたね。',
      ],
      stagger: [
        '（鋏が手から跳ねて、机に突き立った）',
        '（墨壺が倒れて、自分の袖が黒く染まる）',
        '待ちなさい、まだ判を──',
        '（眼鏡がずれて、どこを塗るのか見失った）',
      ],
      mutter: [
        '（墨の筆先を、整えている）',
        '沈黙は結構。検閲の手間が省ける。',
        '……どこから、切りましょうか。',
        '（鋏の刃こぼれを、指で数えている）',
      ],
    },
  },
  {
    id: 'projector',
    name: '映写機',
    stratum: 2,
    tier: 'boss',
    hp: 44,
    resolve: 36,
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
        (w) =>
          3 + Math.min(3, w.you.perms.filter((id) => permDef(id)?.kind === 'memory').length) * 2,
        { prior: () => 3 },
      ),
      strike('glare', '光を浴びせる', 7, { prior: () => 2 }),
      mend('rewind', '巻き戻す', 6, 8, { cond: (w) => hpOf(w) < 0.7, prior: () => 3 }),
      guard('intermission', '幕間', 10),
      lie(threat('credits', 'エンドロールで刺す', 6), 'wait', 'エンドロール'),
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
        '（客席の灯りが、一つずつ落ちていく）',
      ],
      again: [
        '（スクリーンに、前回のあなたが映っている）',
        '（同じリールが、またかかる）',
        '（映写機が、あなたの足音で回りはじめた）',
        '（画面の隅に、前の上映の傷が残っている）',
      ],
      hurt: [
        '（フィルムが軋む）',
        '（画面が一瞬、白く飛んだ）',
        '（コマが一つ、抜け落ちた）',
        '（レンズに、ひびが入った）',
      ],
      low: [
        '（映像が、何度も同じ一秒を繰り返す）',
        '（光が弱まって、スクリーンが黄ばむ）',
        '（回転が落ちて、あなたの顔が間延びする）',
        '（焦げる匂い。どこかのコマが焼けている）',
      ],
      trusted: [
        '（光が、柔らかくなった）',
        '（スクリーンに、知らない誰かの笑顔が映る）',
        '（映写機が、ゆっくり回転を落とす）',
        '（最後のリールが、あなたの前で静かに止まった）',
      ],
      broken: [
        '（映像が、意味のない光の点になった）',
        '（フィルムが外れて、床でとぐろを巻く）',
        '（スクリーンに、何も映らなくなった）',
        '（空回りの音だけが、続いている）',
      ],
      beaten: [
        '（ランプが割れて、客席が真っ暗になった）',
        '（最後のコマが、スクリーンに焼きついたまま）',
        '（映写機が、長い息のような音で止まった）',
        '（フィルムの切れ端が、ひらひらと落ちる）',
      ],
      uncovered: [
        '（最後の場面で、フィルムが止まった）',
        '（焼けたコマの向こうに、彼女の背中）',
        '（映写窓の奥に、もう一台の映写機が見える）',
        '（スクリーンの中のあなたは、助手席に座っていた）',
      ],
      fled: [
        '（光が消え、客席の非常灯だけが残った）',
        '（リールが外れて、映写機が奥の闇へ引っこむ）',
        '（上映が、予告もなく打ち切られた）',
        '（スクリーンが巻き上がって、天井に消えた）',
      ],
      taunt: [
        '（忘れたかった場面が、大写しになる）',
        '（同じ場面が、もう一度かかる）',
        '（客席のどこかで、笑い声）',
        '（ブレーキの音が、場内に響く）',
      ],
      stagger: [
        '（フィルムが絡まって、映像が三重にぶれた）',
        '（コマ送りが狂って、あなたが逆さに走る）',
        '（光が跳ねて、スクリーンの外の壁を照らした）',
        '（ガタン、と映写機が台の上で跳ねた）',
      ],
      mutter: [
        '（スクリーンに、黙っているあなたが映る）',
        '（フィルムの端が、空回りしている）',
        '（光の中の埃だけが動いている）',
        '（客席に、あなたの座る席だけが空いている）',
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
        '（ピーという音のあとに、聞き慣れた咳払い）',
      ],
      again: [
        'また電話くれたのね。',
        '昨日も、声を聞いた気がする。',
        '何度でも、かけてきなさい。',
        'さっきの電話、途中で切れちゃったわね。',
      ],
      heard: [
        '近所の人から聞いたわよ。夜中に、灯りを持って歩いてるって。',
        'あなた、また探してるんでしょう。あの子のこと。',
        '噂になってるのよ。お母さん、恥ずかしいわ。',
        '誰に聞いたかは、言わないけど。',
      ],
      hurt: [
        '……どうして。',
        'そんな言い方、しなくても。',
        '……ごめんね。お母さん、何か言った？',
        '（受話器の向こうで、長い咳）',
      ],
      low: [
        '切らないで。もう少しだけ。',
        'お母さんね、本当は、少し……（咳）',
        '声が、遠いわね。あなたのほうが遠いの？',
        '怒ってないから。ね。',
      ],
      trusted: [
        'いいのよ。行ってらっしゃい。',
        '寒くないようにね。',
        '帰る場所は、ちゃんと置いておくから。',
        'ごはん、冷蔵庫に入ってるから。',
      ],
      broken: [
        '……そう。もう、帰ってこないのね。',
        '電話、切るわね。',
        '（発信音だけが続く）',
        '留守電、もう消しておくわね。',
      ],
      beaten: [
        '（受話器が落ちた音。それきり、何も）',
        '（ランプの点滅が、ゆっくりになって止まった）',
        '……ごめんなさい。',
        '（遠くで、やかんだけが鳴っている）',
      ],
      uncovered: [
        '病院のことは、黙っていてごめんね。',
        '検査の結果ね。……まだ、聞かないで。',
        'あの子のことも、知ってたのよ。お母さん。',
        '子守歌の続きはね、お母さんも忘れたの。',
      ],
      fled: [
        'あら、誰か来たみたい。またね。',
        '（通話が、ぷつりと切れた）',
        '用事を思い出したの。かけ直すわ。',
        '（ランプが消えた。録音は、残っていない）',
      ],
      caught: [
        '嘘をつくとき、昔から声が高くなるのよ。',
        'お母さんに、嘘は通じません。',
        'ごはん、食べてないでしょう。わかるのよ。',
        'そう。……いいのよ。お母さんも、ついてるから。',
      ],
      taunt: [
        'あなたのためを思って言ってるの。',
        'ほら、言わんこっちゃない。',
        '昔から、そうなんだから。',
        'お父さんにそっくり。',
      ],
      stagger: [
        '（受話器を取り落とす音。ごとん、と）',
        'ちょっと待って、今、鍋が──',
        '（混線して、知らない人の声が割りこむ）',
        '（咳きこんで、言葉が続かない）',
      ],
      mutter: [
        '……もしもし？　聞こえてる？',
        '（受話器の向こうで、やかんが鳴っている）',
        '黙ってても、わかるのよ。',
        '（子守歌を、小さく口ずさんでいる。節だけ）',
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
      greet: [
        '（赤い灯が、あなたを見つけて点滅を速めた）',
        '（ファンの音が、一段高くなる）',
        '（巡回の円を外れて、まっすぐこちらへ）',
        '（短い警告音が、三回）',
      ],
      again: [
        '（レンズが、あなたの顔を照合している）',
        '（前回の焦げ跡を、なぞるように近づく）',
        '（同じ警告音。前より少し、音程が低い）',
        '（巡回路の上に、あなたの位置が記録されている）',
      ],
      hurt: [
        '（装甲がへこんで、ファンが咳きこむ）',
        '（火花が散って、高度が一段落ちた）',
        '（赤い灯が、一つ消えた）',
        '（ノイズ混じりの警告音）',
      ],
      low: [
        '（装甲が赤く光りはじめる）',
        '（ローターの一枚が、不規則に鳴っている）',
        '（巡回路へ戻ろうとして、同じ場所を回る）',
        '（警告音が、途切れ途切れになる）',
      ],
      trusted: [
        '（赤い灯が、緑に変わった）',
        '（あなたを巡回路から外して、通り過ぎる）',
        '（レンズが、あなたから目を逸らした）',
        '（先に立って、出口の方角を照らした）',
      ],
      broken: [
        '（制御を失って、ゆっくり床に降りた）',
        '（ファンが止まり、余熱だけが揺らめく）',
        '（赤い灯が、意味のない間隔で瞬く）',
        '（同じ地点を、ただ見つめている）',
      ],
      beaten: [
        '（床に落ちて、ローターが空を切っている）',
        '（装甲の隙間から、黒い煙が細く上がる）',
        '（ファンが止まった。製油所が、静かになった）',
        '（赤い灯が、一度だけ点いて消えた）',
      ],
      uncovered: [
        '（装甲の裏に、刻印。RF-0327）',
        '（記録装置に、事故の夜の巡回記録が残っている）',
        '（冷却管が、一本だけ外れていた）',
        '（レンズの奥に、焦げた油の膜）',
      ],
      fled: [
        '（警告音を残して、配管の上へ逃げた）',
        '（排熱の煙に紛れて、見えなくなった）',
        '（巡回路へ戻っていく。何もなかったように）',
        '（ファンの音が、遠ざかっていく）',
      ],
      taunt: [
        '（熱の線が、袖を焦がした）',
        '（短い警告音）',
        '（赤い灯が、あなたに合わせて瞬く）',
        '（焦げた油の匂いが、喉に貼りつく）',
      ],
      stagger: [
        '（機体が傾いて、配管に脇腹を擦った）',
        '（ローターが壁を叩いて、火花が散る）',
        '（姿勢制御が追いつかず、宙で一回転した）',
        '（警告音が、裏返った）',
      ],
      mutter: [
        '（同じ円を、何度も巡回している）',
        '（ファンの音が、上がったり下がったりする）',
        '（レンズが、あなたの灯りに焦点を合わせなおす）',
        '（排熱口から、陽炎が立っている）',
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
      strike('hammer', 'ハンマーを振るう', 9, { prior: (w) => 1 + angry(w) }),
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
        '（ルーペ越しに、あなたを上から下まで見た）',
      ],
      again: [
        'また来たか。きみの層は、前より厚い。',
        '前の試料は、もう分析した。面白くなかった。',
        '同じ靴だ。泥だけが、深くなっている。',
        '二度目の採取だな。',
      ],
      heard: [
        '噂の灯り持ちか。もう一人と、見分けがつかんな。',
        'きみの話は、上の層から聞こえてきた。',
        '人の昔を掘る素人がいると聞いた。',
        '掘り方が乱暴だそうだな。',
      ],
      hurt: [
        '野蛮だな。',
        'その手で、何層壊した。',
        '……骨にひびが入った。いい試料になる。',
        'ルーペが割れた。弁償しろ。',
      ],
      low: [
        '待て。まだ、記録が終わっていない。',
        '地層は、崩れるときは一瞬だ。……知っていたがね。',
        'この試料だけは、持っていかせてくれ。',
        '素人に、ここまで掘られるとはな。',
      ],
      trusted: [
        'もう一人の灯り持ちも、同じことを訊いた。',
        'この層の下に、階段がある。図面にはないがね。',
        'ルーペを貸そう。返さなくていい。',
        'あの黒い縞から、下へ三尺。そこに道がある。',
      ],
      broken: [
        '結論は……出せない。',
        '千年分、全部、ただの土だ。',
        '（ハンマーを置いて、自分の手のひらを見ている）',
        '好きに掘れ。もう、どの層も同じだ。',
      ],
      beaten: [
        '（ルーペが転がって、琥珀の床で止まった）',
        '（試料の円柱を抱えて、うずくまる）',
        '……風化だ。私の。',
        '（ハンマーの柄が、きれいに折れていた）',
      ],
      uncovered: [
        'この臭いを、どこで嗅いだ？',
        '製油所の層だ。あの年だけ、黒い。',
        'あいつの手帳を、私は読んだ。勝手にな。',
        '焦げた油と、甘い薬品。事故の夜の臭いだ。',
      ],
      fled: [
        '調査は、中断する。',
        '（地層の割れ目へ、背中から滑りこんだ）',
        '（試料だけを抱えて、下の層へ下りていった）',
        '記録は持っていく。きみの分もな。',
      ],
      caught: [
        'その話には、層が一枚足りない。',
        '堆積の順が逆だ。嘘をつくなら、順を揃えろ。',
        '年代が合わない。',
        'ルーペを当てるまでもないな。',
      ],
      taunt: [
        '硬度が足りないな。',
        '風化だよ。きみの。',
        'ほら、割れた。',
        '断面が、きれいに出た。',
      ],
      stagger: [
        '（足元の層が崩れて、腰まで沈んだ）',
        '（ルーペが飛んだ。目をこすって、探している）',
        '待て、まだ測って──',
        '（ハンマーの重さに振られて、たたらを踏む）',
      ],
      mutter: [
        '（ルーペで、あなたの靴の泥を見ている）',
        '沈黙も、堆積する。',
        '……結論を急ぐのは、素人だ。',
        '（試料の円柱を、耳に当てている）',
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
      greet: [
        '（琥珀を軋ませて、羽を半分だけ広げた）',
        '（複眼が、あなたの灯りを捉えた）',
        '（低い羽音。壁ごと、震えている）',
        '（抜け出しかけた体を、こちらへねじる）',
      ],
      again: [
        '（前より、琥珀から多く抜け出している）',
        '（羽音の高さを、あなたに合わせてくる）',
        '（前に欠けた殻の跡が、もう固まっている）',
        '（複眼のどこかに、前のあなたが映っている）',
      ],
      hurt: [
        '（殻に、白いひびが走った）',
        '（羽の一枚が、根元から折れ曲がる）',
        '（樹脂の滴が、傷から垂れる）',
        '（羽音が、一瞬乱れた）',
      ],
      low: [
        '（琥珀の中へ、体を引き戻そうとしている）',
        '（羽音が、途切れ途切れになる）',
        '（固まったほうの体が、重く沈む）',
        '（脚が、宙を掻いている）',
      ],
      trusted: [
        '（羽を畳んで、壁に体を預けた）',
        '（複眼の中で、あなたの灯りが一つだけになる）',
        '（あなたの肩にとまって、すぐに離れた）',
        '（琥珀から、最後の脚を抜いて、静かに飛び去った）',
      ],
      broken: [
        '（羽が垂れて、もう震えない）',
        '（琥珀の中へ戻って、動かなくなった）',
        '（複眼の光が、くすんでいく）',
        '（羽音が、ただの空気の音になった）',
      ],
      beaten: [
        '（殻が割れて、中は空っぽだった）',
        '（床に落ちて、また琥珀に飲まれていく）',
        '（折れた羽だけが、ゆっくり舞い落ちる）',
        '（脚が、一本ずつ止まっていった）',
      ],
      uncovered: [
        '（殻の継ぎ目に、細い隙間を見つけた）',
        '（複眼の奥で、閉じ込められた羽が動いている）',
        '（腹の中に、もう一匹。もっと古い蟲）',
        '（琥珀の中に、焦げた油の泡が一つ）',
      ],
      fled: [
        '（羽音を残して、天井の暗がりへ）',
        '（琥珀の壁に潜りこんで、見えなくなった）',
        '（半分の体のまま、よろよろと飛んでいった）',
        '（欠けた殻だけが、床に残った）',
      ],
      taunt: [
        '（針が、皮膚の下で冷たい）',
        '（羽音が、一段高くなる）',
        '（琥珀の欠片を散らして、宙で向きを変える）',
        '（刺された跡が、蜂蜜色に固まっていく）',
      ],
      stagger: [
        '（羽がもつれて、壁にぶつかった）',
        '（殻が割れて、体が半分こぼれ出る）',
        '（宙で傾いて、床すれすれで持ち直す）',
        '（羽音が裏返って、きいん、と鳴った）',
      ],
      mutter: [
        '（半分だけ自由な羽を、ゆっくり開いては閉じる）',
        '（複眼に、あなたの灯りが何百も映っている）',
        '（固まったほうの体を、引きずっている）',
        '（触角で、空気の温度を測っている）',
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
        '（半分だけの肉の下で、琥珀の肋骨が光る）',
      ],
      again: [
        '（あなたの匂いを覚えている）',
        '（一度だけ、短く鼻を鳴らした）',
        '（前より少し近くで、待っていた）',
        '（尻尾の骨が、一度だけ鳴った）',
      ],
      hurt: [
        '（骨の欠ける音。琥珀の粉が散った）',
        '（鳴き声が、地層の奥に吸いこまれた）',
        '（前足が、からんと乾いた音を立てる）',
        '（退がりながら、まだ唸っている）',
      ],
      low: [
        '（伏せたまま、肩で息をしている）',
        '（琥珀の目が、曇りはじめる）',
        '（くうん、と古い声で鳴いた）',
        '（傷ついた前足を、そっと舐めている）',
      ],
      trusted: [
        '（隣に座った）',
        '（あなたの手に、乾いた鼻を押しつけた）',
        '（先に立って、階段を一段下りた）',
        '（路地のときと同じ距離で、ついてくる）',
      ],
      broken: [
        '（耳を伏せて、骨の体を丸めた）',
        '（遠吠えをやめて、床に顎をつけた）',
        '（目を逸らして、動かない）',
        '（尻尾の骨が、垂れたまま）',
      ],
      beaten: [
        '（崩れて、骨と琥珀の山になった）',
        '（横たわったまま、あなたの靴を見ている）',
        '（息が止まり、琥珀の目だけが光っている）',
        '（もう一度起き上がろうとして、やめた）',
      ],
      uncovered: [
        '（前足の骨に、古いガラスの欠片が埋まっている）',
        '（首に、擦り切れた首輪の跡。見覚えがある）',
        '（琥珀の胃の中に、何も入っていない）',
        '（骨に刻まれた歯形。もっと大きな何かの）',
      ],
      fled: [
        '（骨を鳴らしながら、地層の奥へ）',
        '（遠吠えだけを残して、闇に消えた）',
        '（一度振り返り、琥珀の目を光らせて去った）',
        '（足音が、上の階のほうへ遠ざかる）',
      ],
      taunt: [
        '（低く唸る）',
        '（琥珀の牙が、灯りを弾く）',
        '（遠吠えが、地層に吸い込まれていく）',
        '（袖を噛んで、引き倒そうとする）',
      ],
      stagger: [
        '（骨の脚がもつれて、横ざまに倒れた）',
        '（琥珀の欠片を撒き散らして、壁に跳ねた）',
        '（きゃん、と若い犬の声で鳴いた）',
        '（起き上がろうとして、骨が噛み合わない）',
      ],
      mutter: [
        '（伏せたまま、尻尾の骨を一度だけ鳴らす）',
        '（あなたの靴の匂いを嗅いでいる）',
        '（耳だけが、上の階のほうを向く）',
        '（空の皿を探すように、床を嗅ぎまわる）',
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
        '（近づくほど、肩の荷が重くなる）',
      ],
      again: [
        '（面の傷が、前より一つ増えている）',
        '（前に欠けた角が、あなたの形で埋まっている）',
        '（辺の長さが、前と違う。あなたが変わったぶんだけ）',
        '（同じ場所に、同じ重さで待っていた）',
      ],
      hurt: [
        '（辺が、少し縮んだ）',
        '（角が欠けて、古い夜がこぼれる）',
        '（面の一つに、ひびが入った。あなたの記憶の形に）',
        '（内側から、何かが崩れる音）',
      ],
      low: [
        '（立方体が、あなたの声で話しはじめる）',
        '（あなたの声で、「ここまで、よく運んできたね」）',
        '（面が一枚、内側へ倒れかける）',
        '（辺が軋んで、角が丸くなっていく）',
      ],
      trusted: [
        '（あなたの声で、「ぜんぶ、持っていっていい」）',
        '（あなたの声で、「置いていってもいい。誰も数えない」）',
        '（立方体が、手で持てるくらいの大きさになる）',
        '（面が開いて、中は温かかった）',
      ],
      broken: [
        '（立方体は、ただの土に戻った）',
        '（辺がほどけて、ただの夜になる）',
        '（残ったのは、手のひらほどの琥珀だけ）',
        '（重さが、ふっと消えた）',
      ],
      beaten: [
        '（面が一枚ずつ剥がれて、床に伏せていく）',
        '（立方体が潰れて、平たい一枚の地図になった）',
        '（崩れた辺のあいだから、冷たい風が吹きあがる）',
        '（角だけが残って、灯りの中で光っている）',
      ],
      uncovered: [
        '（面の一つに、彼女の名前があった）',
        '（いちばん底の面に、事故の日付）',
        '（内側に、もう一つ小さな立方体）',
        '（小さな立方体の面に、助手席が描かれていた）',
      ],
      fled: [
        '（立方体が、床の下へ沈んでいった）',
        '（気がつくと、四角い跡だけが残っていた）',
        '（立方体が、暗がりの奥へ一辺ぶん退がった）',
        '（重さだけを残して、形が消えた）',
      ],
      taunt: [
        '（あなた自身の重さが、のしかかる）',
        '（あなたの声で、「それも、あなたが持ってきたもの」）',
        '（面に、さっきのあなたのしくじりが映る）',
        '（辺が伸びて、逃げ場を塞ぐ）',
      ],
      stagger: [
        '（面が大きくたわんで、辺が一本外れた）',
        '（立方体が傾いて、角で床を打った）',
        '（内側の重さが片寄り、ぐらりと揺れる）',
        '（面に刻まれた夜が、順番を失ってずれていく）',
      ],
      mutter: [
        '（立方体は、待つことに慣れている）',
        '（辺が、ほんの少しずつ伸びている）',
        '（あなたの声で、「黙っていても、体積は変わらない」）',
        '（面に、黙っているあなたの顔が刻まれていく）',
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
        '（灯りを掲げる。あなたと同じ高さに）',
      ],
      again: [
        'また会ったな。今度は譲らない。',
        '階段は、一本しかないらしい。',
        '追いつかれるとはな。',
        '前の階で、お前の足跡を踏んだ。',
      ],
      heard: [
        '噂は聞いてる。俺の噂だと思ってた。',
        '灯り持ちがもう一人いると、上の連中が言ってた。',
        '夜警から聞いた。お前も、北の階段を訊いたって。',
        'お前の話は、どれも俺の話に似てる。',
      ],
      hurt: [
        '……やるじゃないか。',
        '俺の手の癖まで、同じだな。',
        '痛いところを、よく知ってる。',
        '煤が、目に入った。',
      ],
      low: [
        '待て。灯りが、消える。',
        '先に行かせてくれ。頼む。',
        'あと少しで、届くんだ。',
        'お前に負けるなら、俺は誰だったんだ。',
      ],
      trusted: [
        '灯りは二つあったほうがいい。底で会おう。',
        'これを持っていけ。俺の手帳だ。お前なら読める。',
        '下へは、右の階段が近い。嘘じゃない。',
        '彼女を見つけたら、俺の分も言っておいてくれ。',
      ],
      broken: [
        '先に行け。',
        '……灯りが重い。今夜は、もう持てない。',
        '俺が見つけるはずだった。',
        '手帳の字が、お前の字に見えてきた。',
      ],
      beaten: [
        '（灯りが割れて、煤だけが舞った）',
        '……同じ灯りでも、持つ手が違ったか。',
        '（壁にもたれて、消えた芯を見ている）',
        '行けよ。俺は、少し休む。',
      ],
      uncovered: [
        '俺も、彼女を探してる。',
        '助手席にいたのは、俺だと思ってた。',
        'お前の手帳と、同じことが書いてある。',
        '灯りは、あの夜の車から持ってきた。お前もか。',
      ],
      fled: [
        '底で待ってる。',
        '（灯りが、非常階段を上へ遠ざかっていく）',
        '次の区画で。',
        '（灯りを消した。暗がりのどこにいるか、もうわからない）',
      ],
      caught: [
        '嘘だな。俺も、同じ嘘をついた。',
        'その手口は、俺が先に使った。',
        '目が泳いでる。鏡で見たことがある。',
        '手帳には、そう書いてなかった。',
      ],
      taunt: [
        '先に着くのは、俺だ。',
        '遅いな。',
        '知ってたよ。お前なら、そう動く。',
        '同じ手だ。俺のほうが、一度多く使ってる。',
      ],
      stagger: [
        '（灯りが大きく揺れて、自分の影に足を取られた）',
        '（階段を二段、踏み外した）',
        '待て、そんな手は、俺は──',
        '（煤けた灯りが手から離れかけ、慌てて掴む）',
      ],
      mutter: [
        '（灯りの芯を、あなたと同じ手つきで直している）',
        '迷うところまで、同じなんだな。',
        '……先に行くぞ。言ってみただけだ。',
        '（手帳を開いて、あなたの顔と見比べている）',
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
