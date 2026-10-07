import type { ActiveDef } from './defs';
import {
  breakNpc,
  chanceOf,
  coins,
  cost,
  end,
  gainPerm,
  has,
  healYou,
  hitNpc,
  hostile,
  hurtYou,
  loseItem,
  revealClue,
  roll,
  say,
  seeIntent,
  stat,
  trust,
} from './enc';
import { permDef } from './registry';
import { int } from './rng';
import type { Encounter } from './types';

/**
 * ACTIVE のカード。どれも READY（回数がある）と SPENT（0 回）の二つの顔を
 * 持つ。SPENT は死んだカードではなく、代償つきの非常手段。
 *
 * 休ませて回復させ続けると健全に（care）、0 回のまま酷使すると歪んで
 * （overuse）別のカードへ変わる。記憶の組み合わせでしか開かない先もある。
 */

const closed = (e: Encounter) => (e.npc.st.closed ?? 0) * 5;
const memories = (e: Encounter) =>
  [...e.permanents, ...e.gained].filter((id) => permDef(id)?.kind === 'memory').length;
const first = (e: Encounter, slot: number, perm: string) => {
  if ((e.cards[slot]?.marks.used ?? 0) <= 1) gainPerm(e, perm);
};
const lie = (e: Encounter, gain: number, bonus: number) => {
  e.log.lies++;
  const wary = 10 * (e.npc.st.wary ?? 0);
  if (roll(e, 'INT', chanceOf(e, 'INT', 50 - 8 * e.npc.int + bonus - wary, 'lie'))) {
    trust(e, gain);
    return true;
  }
  e.log.liesCaught++;
  say(e, 'npc', '……嘘だな。');
  hostile(e, 3);
  trust(e, -2);
  return false;
};

export const ACTIVE_LIST: readonly ActiveDef[] = [
  // ─── 観察の系統 ─────────────────────────────────────────────
  {
    id: 'observe',
    name: '観察',
    cat: 'look',
    stats: ['INT'],
    uses: 3,
    text: '本当の予告を見る。INT 判定に成功すると、手がかりを 1 つ見る。',
    chance: (e) => chanceOf(e, 'INT', 30 - closed(e), 'observe'),
    ready: (e) => {
      seeIntent(e);
      if (roll(e, 'INT', chanceOf(e, 'INT', 30 - closed(e), 'observe'))) revealClue(e);
      else say(e, 'voice', '何も掴めない。');
    },
    spentName: '凝視',
    spentText: 'かならず手がかりを 1 つ見る。ただし INT 判定に失敗すると《思い込み》を得る。',
    spentChance: (e) => chanceOf(e, 'INT', 30 - closed(e), 'observe'),
    spent: (e) => {
      seeIntent(e);
      revealClue(e);
      if (!roll(e, 'INT', chanceOf(e, 'INT', 30 - closed(e), 'observe'))) gainPerm(e, 'belief');
    },
    recover: { on: [], text: '休ませるほかに回復しない。' },
    alter: {
      care: { to: 'insight', need: 2 },
      overuse: { to: 'stare', need: 2 },
      secret: { to: 'deja-vu', perms: ['suspicion', 'habit-observe'] },
    },
    shift: { on: 'rested', every: 3, cap: 5, perm: 'habit-observe' },
    tier: 0,
    flavor: '見ることは、相手に触れずに掘ることだ。',
  },
  {
    id: 'stare',
    name: '凝視',
    cat: 'look',
    stats: ['INT'],
    uses: 3,
    text: 'かならず手がかりを 1 つ見る。相手の敵意 +1。',
    ready: (e) => {
      seeIntent(e);
      revealClue(e);
      hostile(e, 1);
    },
    spentName: '睨めつける',
    spentText: '手がかりを 1 つ見る。精神 −2、敵意 +2。',
    spent: (e) => {
      revealClue(e);
      hostile(e, 2);
      cost(e, 0, 2);
    },
    recover: { on: [], text: '休ませるほかに回復しない。' },
    alter: { care: { to: 'insight', need: 3 }, overuse: { to: 'obsession', need: 2 } },
    tier: 1,
    flavor: '目を逸らせなくなっている。',
  },
  {
    id: 'obsession',
    name: '執着',
    cat: 'look',
    stats: ['INT', 'WIL'],
    uses: 4,
    text: '隠された手がかりを 2 つ見る。ただし誤った手がかりが混じることがある。',
    ready: (e) => {
      seeIntent(e);
      revealClue(e, true);
      revealClue(e, true);
    },
    spentName: '取り憑かれる',
    spentText: '手がかりを 2 つ見る（誤りが混じる）。精神 −3。',
    spent: (e) => {
      revealClue(e, true);
      revealClue(e, true);
      cost(e, 0, 3);
    },
    recover: { on: ['uncover'], text: '暴くと +1。休ませても戻らない。' },
    tier: 2,
    flavor: '強くなった。人としては、悪くなった。',
  },
  {
    id: 'insight',
    name: '洞察',
    cat: 'look',
    stats: ['INT'],
    uses: 3,
    text: '本当の予告と、手がかりを 1 つ見る。INT 判定に成功すると、さらに 1 つ。相手の意志を INT/2 削る。',
    chance: (e) => chanceOf(e, 'INT', 25 - closed(e), 'observe'),
    ready: (e) => {
      seeIntent(e);
      revealClue(e);
      if (roll(e, 'INT', chanceOf(e, 'INT', 25 - closed(e), 'observe'))) revealClue(e);
      breakNpc(e, Math.floor(stat(e, 'INT') / 2));
    },
    spentName: '見透かす',
    spentText: '手がかりを 1 つ見る。敵意 +2。',
    spent: (e) => {
      seeIntent(e);
      revealClue(e);
      hostile(e, 2);
    },
    recover: { on: ['uncover'], text: '暴くと +1。' },
    tier: 1,
    flavor: '見えたものを、見えたとおりに受け取る。',
  },
  {
    id: 'deja-vu',
    name: '既視感',
    cat: 'look',
    stats: ['INT', 'WIL'],
    uses: 2,
    text: '本当の予告と、手がかりを 2 つ見る。前にも見た気がする。',
    ready: (e) => {
      seeIntent(e);
      revealClue(e);
      revealClue(e);
    },
    spentName: '思い違い',
    spentText: '手がかりを 1 つ見る。精神 −1。',
    spent: (e) => {
      revealClue(e);
      cost(e, 0, 1);
    },
    recover: { on: ['newPlace'], text: '新しい場所を訪れると +1。' },
    tier: 1,
    flavor: '疑うことと、慣れることが重なった場所に開く。',
  },
  // ─── 威圧の系統 ─────────────────────────────────────────────
  {
    id: 'intimidate',
    name: '威圧',
    cat: 'force',
    stats: ['ATK', 'WIL'],
    uses: 2,
    text: '相手の意志を 3 + ATK + WIL/2 削る。敵意 +2。',
    ready: (e) => {
      breakNpc(e, 3 + stat(e, 'ATK') + Math.floor(stat(e, 'WIL') / 2));
      hostile(e, 2);
      trust(e, -1);
    },
    spentName: '怒鳴る',
    spentText:
      'ATK 判定 +20。成功すると意志を 1.5 倍削る。ただし関係の悪化は確定（信頼 −3、敵意 +3）。',
    spentChance: (e) => chanceOf(e, 'ATK', 50, 'intimidate'),
    spent: (e) => {
      const base = 3 + stat(e, 'ATK') + Math.floor(stat(e, 'WIL') / 2);
      if (roll(e, 'ATK', chanceOf(e, 'ATK', 50, 'intimidate'))) breakNpc(e, Math.round(base * 1.5));
      trust(e, -3);
      hostile(e, 3);
    },
    recover: { on: ['win', 'broken'], text: '倒すか折ると +1。' },
    alter: { care: { to: 'dignity', need: 2 }, overuse: { to: 'tyranny', need: 2 } },
    tier: 0,
    flavor: '声を大きくすれば、相手は小さくなる。たいていは。',
  },
  {
    id: 'dignity',
    name: '威厳',
    cat: 'force',
    stats: ['WIL'],
    uses: 3,
    text: '相手の意志を 4 + WIL 削る。敵意は上がらない。',
    ready: (e) => {
      breakNpc(e, 4 + stat(e, 'WIL'));
    },
    spentName: '凄む',
    spentText: '意志を WIL 削る。精神 −1。',
    spent: (e) => {
      breakNpc(e, stat(e, 'WIL'));
      cost(e, 0, 1);
    },
    recover: { on: ['broken'], text: '折ると +1。' },
    tier: 1,
    flavor: '黙って立っているだけで、話が終わる。',
  },
  {
    id: 'tyranny',
    name: '暴威',
    cat: 'force',
    stats: ['ATK', 'WIL'],
    uses: 3,
    text: '意志を 6 + ATK + WIL、体力を ATK/2 削る。敵意 +3。初めて使うと《短気》を得る。',
    ready: (e, slot) => {
      breakNpc(e, 6 + stat(e, 'ATK') + stat(e, 'WIL'));
      hitNpc(e, Math.floor(stat(e, 'ATK') / 2));
      hostile(e, 3);
      first(e, slot, 'temper');
    },
    spentName: '荒れ狂う',
    spentText: '意志と体力を大きく削る。自分の体力 −3、敵意は最大に。',
    spent: (e) => {
      breakNpc(e, 8 + stat(e, 'ATK') + stat(e, 'WIL'));
      hitNpc(e, stat(e, 'ATK'));
      hurtYou(e, 3);
      hostile(e, 10);
    },
    recover: { on: ['win', 'broken'], text: '倒すか折ると +1。' },
    tier: 1,
    flavor: '怒鳴るのに慣れた声は、もう小さくならない。',
  },
  // ─── 逃走の系統 ─────────────────────────────────────────────
  {
    id: 'flee',
    name: '逃走',
    cat: 'flee',
    stats: ['AGI'],
    uses: 1,
    text: 'かならず立ち去る。',
    ready: (e) => end(e, 'left'),
    spentName: '逃げ出す',
    spentText: 'かならず逃げられる。ただし所持品をランダムに 1 つ失う。',
    spent: (e) => {
      loseItem(e);
      end(e, 'left');
    },
    recover: { on: [], text: '安全な場所（食堂）で休むまで回復しない。', restOnly: true },
    alter: { care: { to: 'retreat', need: 2 }, overuse: { to: 'cowardice', need: 2 } },
    tier: 0,
    flavor: '出口の場所を、最初に確かめておく。',
  },
  {
    id: 'retreat',
    name: '撤退',
    cat: 'flee',
    stats: ['AGI', 'INT'],
    uses: 2,
    text: '手がかりを 1 つ見てから、かならず立ち去る。',
    ready: (e) => {
      revealClue(e);
      end(e, 'left');
    },
    spentName: '退く',
    spentText: '立ち去る。体力 −2。',
    spent: (e) => {
      hurtYou(e, 2);
      end(e, 'left');
    },
    recover: { on: [], text: '安全な場所（食堂）で休むまで回復しない。', restOnly: true },
    tier: 1,
    flavor: '退くときにも、振り返って見ておく。',
  },
  {
    id: 'cowardice',
    name: '臆病',
    cat: 'flee',
    stats: ['AGI'],
    uses: 2,
    text: 'かならず立ち去る。初めて使うと《逃げ癖》を得る。',
    ready: (e, slot) => {
      first(e, slot, 'runaway');
      end(e, 'left');
    },
    spentName: '這って逃げる',
    spentText: '立ち去る。所持品を 1 つ失い、精神 −2。',
    spent: (e) => {
      loseItem(e);
      cost(e, 0, 2);
      end(e, 'left');
    },
    recover: { on: ['newPlace'], text: '新しい場所を訪れると +1。' },
    tier: 1,
    flavor: '逃げることが、上手になってしまった。',
  },
  // ─── 沈黙の系統 ─────────────────────────────────────────────
  {
    id: 'silence',
    name: '沈黙',
    cat: 'mind',
    stats: ['WIL'],
    uses: 4,
    text: '敵意 −2、信頼 +1。心の構え 3 + WIL/2。',
    ready: (e) => {
      hostile(e, -2);
      trust(e, 1);
      e.you.calm += 3 + Math.floor(stat(e, 'WIL') / 2);
    },
    spentName: '押し黙る',
    spentText:
      '信頼が半ばを越えていれば、相手が手がかりを 1 つ打ち明ける。越えていなければ敵意 +1。',
    spent: (e) => {
      if (e.npc.trust * 2 >= e.npc.trustNeed) {
        say(e, 'npc', '……実はな。');
        revealClue(e);
      } else hostile(e, 1);
      e.you.calm += 2;
    },
    recover: { on: ['quiet'], text: 'カードを使わずに遭遇を終えると +1。' },
    alter: { care: { to: 'listen', need: 2 }, overuse: { to: 'wall', need: 2 } },
    tier: 0,
    flavor: '言わないことも、言葉のうちだ。',
  },
  {
    id: 'listen',
    name: '傾聴',
    cat: 'mind',
    stats: ['WIL', 'INT'],
    uses: 4,
    text: '信頼 +2、敵意 −1。信頼が半ばを越えていれば、手がかりを 1 つ打ち明けられる。',
    ready: (e) => {
      trust(e, 2);
      hostile(e, -1);
      if (e.npc.trust * 2 >= e.npc.trustNeed) revealClue(e);
    },
    spentName: '聞き流す',
    spentText: '信頼 +1。精神 −1。',
    spent: (e) => {
      trust(e, 1);
      cost(e, 0, 1);
    },
    recover: { on: ['quiet', 'trusted'], text: 'カードを使わずに終えるか、打ち解けると +1。' },
    tier: 1,
    flavor: '相手が話し終えるまで、待つ。',
  },
  {
    id: 'wall',
    name: '壁',
    cat: 'mind',
    stats: ['WIL', 'DEF'],
    uses: 5,
    text: '心の構え 6 + WIL、守り DEF。敵意 −2。初めて使うと《閉ざした心》を得る。',
    ready: (e, slot) => {
      e.you.calm += 6 + stat(e, 'WIL');
      e.you.guard += stat(e, 'DEF');
      hostile(e, -2);
      first(e, slot, 'closed-heart');
    },
    spentName: '閉じこもる',
    spentText: '心の構え 8。信頼 −2。',
    spent: (e) => {
      e.you.calm += 8;
      trust(e, -2);
    },
    recover: { on: ['quiet'], text: 'カードを使わずに遭遇を終えると +1。' },
    tier: 1,
    flavor: '何も入ってこない。何も出ていかない。',
  },
  // ─── 思い出すの系統 ─────────────────────────────────────────
  {
    id: 'remember',
    name: '思い出す',
    cat: 'mind',
    stats: ['WIL'],
    uses: 1,
    text: '精神を 3 + 記憶の数だけ取り戻す。',
    ready: (e) => healYou(e, 0, 3 + memories(e)),
    spentName: '反芻',
    spentText: '精神を 2 取り戻す。体力 −2。',
    spent: (e) => {
      healYou(e, 0, 2);
      hurtYou(e, 2);
    },
    recover: { on: ['newPlace'], text: '新しい場所を訪れると +1。' },
    alter: { care: { to: 'flashback', need: 2 }, overuse: { to: 'captive', need: 3 } },
    shift: { on: 'rested', every: 2, cap: 3 },
    tier: 0,
    flavor: '同じ夜を、何度でも。',
  },
  {
    id: 'flashback',
    name: '回想',
    cat: 'mind',
    stats: ['WIL', 'INT'],
    uses: 2,
    text: '精神を 3 + 記憶の数だけ取り戻し、相手の意志を 2 × 記憶の数だけ削る。',
    ready: (e) => {
      healYou(e, 0, 3 + memories(e));
      breakNpc(e, 2 * memories(e));
    },
    spentName: '割り込む記憶',
    spentText: '相手の意志を記憶の数だけ削る。体力 −1。',
    spent: (e) => {
      breakNpc(e, memories(e));
      hurtYou(e, 1);
    },
    recover: { on: ['newPlace'], text: '新しい場所を訪れると +1。' },
    tier: 1,
    flavor: '思い出は、いまに向けて撃てる。',
  },
  {
    id: 'captive',
    name: '囚われる',
    cat: 'mind',
    stats: ['WIL'],
    uses: 2,
    text: '精神を 6 + 記憶の数だけ取り戻す。初めて使うと《過去に囚われる》を得る。',
    ready: (e, slot) => {
      healYou(e, 0, 6 + memories(e));
      first(e, slot, 'past-bound');
    },
    spentName: '沈む',
    spentText: '精神を 4 取り戻す。相手の敵意 +2（上の空に見える）。',
    spent: (e) => {
      healYou(e, 0, 4);
      hostile(e, 2);
    },
    recover: { on: ['newPlace'], text: '新しい場所を訪れると +1。' },
    tier: 1,
    flavor: 'ここにいながら、ずっと向こうにいる。',
  },
  // ─── 嘘の系統 ───────────────────────────────────────────────
  {
    id: 'lie',
    name: '嘘',
    cat: 'talk',
    stats: ['INT'],
    uses: 3,
    text: 'INT 判定（相手の INT と比べる）。成功で信頼 +3。ばれると敵意 +3、信頼 −2。',
    chance: (e) => chanceOf(e, 'INT', 50 - 8 * e.npc.int, 'lie'),
    ready: (e) => {
      lie(e, 3, 0);
    },
    spentName: '大嘘',
    spentText:
      'INT 判定 +10。成功で信頼 +4。ばれると敵意 +4。使うたびに最大回数が増え、《虚言癖》がつく。',
    spentChance: (e) => chanceOf(e, 'INT', 60 - 8 * e.npc.int, 'lie'),
    spent: (e) => {
      if (!lie(e, 4, 10)) hostile(e, 1);
    },
    recover: { on: ['lieKept'], text: '嘘がばれずに遭遇を終えると +1。' },
    alter: { care: { to: 'white-lie', need: 2 }, overuse: { to: 'fabrication', need: 4 } },
    shift: { on: 'spent', every: 1, cap: 5, perm: 'liar' },
    tier: 0,
    flavor: '本当のことを言っても、信じてもらえない夜がある。',
  },
  {
    id: 'white-lie',
    name: '方便',
    cat: 'talk',
    stats: ['INT', 'WIL'],
    uses: 3,
    text: '信頼 +2。信頼が 1 以上ならばれない。',
    ready: (e) => {
      if (e.npc.trust > 0) trust(e, 2);
      else lie(e, 2, 10);
    },
    spentName: '言い繕う',
    spentText: '信頼 +1。',
    spent: (e) => trust(e, 1),
    recover: { on: ['lieKept', 'trusted'], text: '嘘がばれずに終えるか、打ち解けると +1。' },
    tier: 1,
    flavor: '相手のためについた嘘は、嘘のうちに入らない。と、思うことにする。',
  },
  {
    id: 'fabrication',
    name: '作り話',
    cat: 'talk',
    stats: ['INT', 'AGI'],
    uses: 4,
    text: 'INT 判定 +20。成功で信頼 +4。',
    chance: (e) => chanceOf(e, 'INT', 70 - 8 * e.npc.int, 'lie'),
    ready: (e) => {
      lie(e, 4, 20);
    },
    spentName: '物語る',
    spentText: 'かならず信頼 +5。《虚言癖》がなければ得る。',
    spent: (e) => {
      e.log.lies++;
      trust(e, 5);
      gainPerm(e, 'liar');
    },
    recover: { on: ['lieKept'], text: '嘘がばれずに遭遇を終えると +1。' },
    tier: 1,
    flavor: 'もう、どこまでが本当だったか覚えていない。',
  },
  // ─── 殴るの系統 ─────────────────────────────────────────────
  {
    id: 'strike',
    name: '殴る',
    cat: 'force',
    stats: ['ATK'],
    uses: 3,
    text: '体力を 4 + 1.5 × ATK 削る。敵意 +2。',
    ready: (e) => {
      hitNpc(e, 4 + Math.floor(1.5 * stat(e, 'ATK')));
      hostile(e, 2);
    },
    spentName: '振り回す',
    spentText: 'ATK 判定 +20。成功すると 2 倍。自分の体力 −2、敵意 +2。',
    spentChance: (e) => chanceOf(e, 'ATK', 50, 'strike'),
    spent: (e) => {
      const base = 4 + Math.floor(1.5 * stat(e, 'ATK'));
      hitNpc(e, roll(e, 'ATK', chanceOf(e, 'ATK', 50, 'strike')) ? base * 2 : Math.floor(base / 2));
      hurtYou(e, 2);
      hostile(e, 2);
    },
    recover: { on: ['win'], text: '倒すと +1。' },
    alter: { care: { to: 'precise', need: 2 }, overuse: { to: 'beast', need: 2 } },
    tier: 0,
    flavor: '話が通じないなら、通じる言葉で。',
  },
  {
    id: 'precise',
    name: '正拳',
    cat: 'force',
    stats: ['ATK', 'AGI'],
    uses: 3,
    text: '守りを無視して、体力を 5 + 1.5 × ATK 削る。',
    ready: (e) => {
      hitNpc(e, 5 + Math.floor(1.5 * stat(e, 'ATK')), true);
      hostile(e, 1);
    },
    spentName: '打ち込む',
    spentText: '守りを無視して、体力を ATK 削る。',
    spent: (e) => {
      hitNpc(e, stat(e, 'ATK'), true);
    },
    recover: { on: ['win'], text: '倒すと +1。' },
    tier: 1,
    flavor: '一番短い線で。',
  },
  {
    id: 'beast',
    name: '獣',
    cat: 'force',
    stats: ['ATK', 'VIT'],
    uses: 3,
    text: '体力を 6 + 2 × ATK 削る。初めて使うと《血の味》を得る。',
    ready: (e, slot) => {
      hitNpc(e, 6 + 2 * stat(e, 'ATK'));
      hostile(e, 3);
      first(e, slot, 'blood');
    },
    spentName: '食らいつく',
    spentText: '体力を 8 + 2 × ATK 削る。自分の体力 −3。',
    spent: (e) => {
      hitNpc(e, 8 + 2 * stat(e, 'ATK'));
      hurtYou(e, 3);
      hostile(e, 3);
    },
    recover: { on: ['win'], text: '倒すと +1。' },
    tier: 1,
    flavor: '殴るたびに、少しずつ人の形から外れる。',
  },
  // ─── 掘るの系統 ─────────────────────────────────────────────
  {
    id: 'dig',
    name: '掘る',
    cat: 'look',
    stats: ['VIT', 'INT'],
    uses: 2,
    text: 'VIT・INT 判定で手がかりを 1 つ掘り当てる。金も少し出てくる。',
    chance: (e) => chanceOf(e, ['VIT', 'INT'], 35 - closed(e), 'dig'),
    ready: (e) => {
      if (roll(e, ['VIT', 'INT'], chanceOf(e, ['VIT', 'INT'], 35 - closed(e), 'dig')))
        revealClue(e);
      coins(e, int(e.rng, 3, 9));
    },
    spentName: '掘り返す',
    spentText: 'かならず手がかりを 1 つ掘り当てる。体力 −3。',
    spent: (e) => {
      revealClue(e);
      cost(e, 3);
    },
    recover: { on: ['uncover'], text: '暴くと +1。' },
    alter: { care: { to: 'excavate', need: 2 }, overuse: { to: 'grave-robber', need: 2 } },
    tier: 0,
    flavor: '地面も人も、掘れば何か出てくる。',
  },
  {
    id: 'excavate',
    name: '発掘',
    cat: 'look',
    stats: ['VIT', 'INT'],
    uses: 2,
    text: '手がかりを 2 つ掘り当てる。金も出てくる。',
    ready: (e) => {
      revealClue(e);
      revealClue(e);
      coins(e, int(e.rng, 5, 12));
    },
    spentName: '掘り進む',
    spentText: '手がかりを 1 つ。体力 −2。',
    spent: (e) => {
      revealClue(e);
      cost(e, 2);
    },
    recover: { on: ['uncover'], text: '暴くと +1。' },
    tier: 1,
    flavor: '刷毛で、少しずつ。',
  },
  {
    id: 'grave-robber',
    name: '墓暴き',
    cat: 'look',
    stats: ['VIT', 'INT'],
    uses: 2,
    text: '手がかりをすべて掘り出す。初めて使うと《罪悪感》を得る。',
    ready: (e, slot) => {
      first(e, slot, 'guilt');
      for (let i = 0; i < 6; i++) if (!revealClue(e)) break;
    },
    spentName: '掘り荒らす',
    spentText: '手がかりを 2 つ。精神 −3。',
    spent: (e) => {
      revealClue(e);
      revealClue(e);
      cost(e, 0, 3);
    },
    recover: { on: ['uncover'], text: '暴くと +1。' },
    tier: 1,
    flavor: '眠っていたものを、起こしてしまう。',
  },
  // ─── 道中で手に入るカード ───────────────────────────────────
  {
    id: 'bargain',
    name: '取引',
    cat: 'talk',
    stats: ['INT'],
    uses: 3,
    text: '金 10 を払い、信頼 +2。INT 判定に成功すると手がかりも 1 つ。',
    chance: (e) => chanceOf(e, 'INT', 30, 'bargain'),
    ready: (e) => {
      coins(e, -10);
      trust(e, 2);
      if (roll(e, 'INT', chanceOf(e, 'INT', 30, 'bargain'))) revealClue(e);
    },
    spentName: '買い叩く',
    spentText: '金 20 を払い、信頼 +3。敵意 +1。',
    spent: (e) => {
      coins(e, -20);
      trust(e, 3);
      hostile(e, 1);
    },
    recover: { on: ['trusted'], text: '打ち解けると +1。' },
    tier: 0,
    flavor: '値段のつく話は、早く終わる。',
  },
  {
    id: 'mend',
    name: '手当て',
    cat: 'body',
    stats: ['VIT'],
    uses: 2,
    text: '体力を 5 + VIT 取り戻す。',
    ready: (e) => healYou(e, 5 + stat(e, 'VIT')),
    spentName: '縫い合わせる',
    spentText: '体力を 4 取り戻す。精神 −2。',
    spent: (e) => {
      healYou(e, 4);
      cost(e, 0, 2);
    },
    recover: { on: [], text: '休ませるほかに回復しない。' },
    tier: 0,
    flavor: '包帯は、いつも少し足りない。',
  },
  {
    id: 'shield',
    name: '庇う',
    cat: 'body',
    stats: ['DEF'],
    uses: 3,
    text: '守り 5 + 2 × DEF。',
    ready: (e) => {
      e.you.guard += 5 + 2 * stat(e, 'DEF');
    },
    spentName: '身を挺す',
    spentText: '守り 3 + DEF。体力 −1。',
    spent: (e) => {
      e.you.guard += 3 + stat(e, 'DEF');
      cost(e, 1);
    },
    recover: { on: ['win'], text: '倒すと +1。' },
    tier: 0,
    flavor: '殴られるのは、慣れている。',
  },
  {
    id: 'steal',
    name: '掠め取る',
    cat: 'flee',
    stats: ['AGI'],
    uses: 2,
    text: 'AGI 判定（相手の AGI と比べる）。成功で金と手がかり。失敗で敵意 +3。',
    chance: (e) => chanceOf(e, 'AGI', 50 - 8 * e.npc.agi, 'steal'),
    ready: (e) => {
      if (roll(e, 'AGI', chanceOf(e, 'AGI', 50 - 8 * e.npc.agi, 'steal'))) {
        coins(e, int(e.rng, 8, 16));
        revealClue(e);
      } else hostile(e, 3);
    },
    spentName: 'ひったくる',
    spentText: 'かならず金を奪う。敵意 +5。',
    spent: (e) => {
      coins(e, int(e.rng, 8, 16));
      hostile(e, 5);
    },
    recover: { on: ['left'], text: '気づかれずに立ち去ると +1。' },
    tier: 0,
    flavor: 'ポケットの中身は、持ち主の記憶でもある。',
  },
  {
    id: 'pray',
    name: '祈る',
    cat: 'mind',
    stats: ['WIL'],
    uses: 2,
    text: '精神を 4 + WIL/2 取り戻す。敵意 −1。',
    ready: (e) => {
      healYou(e, 0, 4 + Math.floor(stat(e, 'WIL') / 2));
      hostile(e, -1);
    },
    spentName: 'すがる',
    spentText: '精神を 3 取り戻す。体力 −2。',
    spent: (e) => {
      healYou(e, 0, 3);
      cost(e, 2);
    },
    recover: { on: ['quiet'], text: 'カードを使わずに遭遇を終えると +1。' },
    tier: 0,
    flavor: '誰に、とは決めていない。',
  },
];

export { has };
