import type { Archetype } from '../core/tags';
import { breakFoe, coins, refill, revealClue, trust } from '../sim/ops';
import type { PassiveSpec, TriggerSpec } from './defs';

/**
 * 伝承原型《アーキタイプ》の割り当てと、その働き。
 *
 *   割り当て  作品ごとのモチーフ（1〜2）と、人物の原型
 *   応答      あなたのカードの原型が、相手の原型に「答える」と ×1.4
 *   重なり    同じ原型を 2 枚・3 枚そろえると、規則が書き換わる
 */

export const WORK_ARCH: Readonly<Record<string, readonly Archetype[]>> = {
  joseph: ['saint', 'child'], agnus: ['saint'], airpump: ['observer', 'witness'], meninas: ['observer', 'sovereign'],
  delft: ['observer'], hunters: ['drifter', 'crowd'], wave: ['monster'], may3: ['witness', 'saint'],
  monk: ['drifter', 'observer'], isle: ['revenant'], icesea: ['drifter', 'revenant'], rain: ['machine'],
  cafe: ['drifter', 'crowd'], night: ['revenant', 'double'], prisons: ['gatekeeper', 'sovereign'], chirico: ['child', 'revenant'],
  empire: ['double', 'trickster'], karljohan: ['crowd', 'double'], vertigo: ['exile'], glove: ['double', 'observer'],
  pope: ['sovereign', 'monster'], nighthawks: ['drifter', 'witness'], interior: ['exile'], khnopff: ['exile', 'double'],
  bureau: ['gatekeeper', 'crowd'], lot49: ['detective', 'trickster'], correction: ['scribe', 'exile'], boris: ['witness', 'saint'],
  saturn: ['drifter', 'scribe'], falling: ['witness', 'saint'], cosmos: ['detective', 'trickster'], voice: ['observer', 'scribe'],
  w: ['child', 'exile'], merulana: ['detective', 'crowd'], distant: ['monster', 'scribe'], molloy: ['drifter', 'double'],
  ficciones: ['scribe', 'double'], crocodiles: ['child', 'revenant'], morel: ['double', 'machine'], policeman: ['gatekeeper', 'trickster'],
  labyrinth: ['drifter', 'witness'], paramo: ['revenant', 'exile'], map: ['detective', 'exile'], cities: ['scribe', 'drifter'],
  ice: ['drifter', 'monster'], ubik: ['revenant', 'machine'], android: ['machine', 'detective'], orwell: ['sovereign', 'observer'],
  miserables: ['saint', 'exile'], threebody: ['observer', 'monster'], chrome: ['trickster', 'machine'], solaris: ['revenant', 'observer'],
  picnic: ['drifter', 'witness'], dune: ['sovereign', 'saint'], leaves: ['scribe', 'exile'], ironman: ['machine'],
  darkknight: ['gatekeeper', 'monster'], pulp: ['trickster', 'crowd'], rim: ['machine', 'double'], jaws: ['monster', 'crowd'],
  t2: ['machine', 'child'], robocop: ['machine', 'gatekeeper'], alien: ['monster'], bladerunner: ['detective', 'machine'],
  thing: ['monster', 'double'], matrix: ['machine', 'double'], fightclub: ['double', 'trickster'], seven: ['detective', 'saint'],
  heat: ['double', 'exile'], children: ['child', 'saint'], odyssey: ['machine', 'observer'], brazil: ['scribe', 'gatekeeper'],
  conversation: ['observer', 'witness'], mulholland: ['double', 'revenant'], stalker: ['drifter', 'gatekeeper'], highlow: ['detective', 'sovereign'],
  dunes: ['exile', 'drifter'], cure: ['trickster', 'double'], akira: ['monster', 'child'], ghost: ['machine', 'detective'],
  federalist: ['sovereign', 'scribe'], objectivity: ['observer', 'scribe'], ethic: ['saint', 'crowd'], democracy: ['crowd', 'observer'],
  leviathan: ['sovereign', 'monster'], origins: ['witness', 'crowd'], discipline: ['gatekeeper', 'observer'], transformation: ['crowd', 'scribe'],
  seeing: ['sovereign', 'observer'], presentation: ['trickster', 'crowd'], metropolis: ['crowd', 'drifter'], revolutions: ['observer', 'scribe'],
  cybernetics: ['machine', 'observer'], artificial: ['machine', 'scribe'], vernacular: ['crowd'], jacobs: ['crowd', 'witness'],
  pattern: ['crowd', 'child'], image: ['drifter', 'observer'], space: ['crowd', 'sovereign'], delirious: ['monster', 'crowd'],
};

export const FOE_ARCH: Readonly<Record<string, readonly Archetype[]>> = {
  watchman: ['gatekeeper'], counterman: ['witness'], regular: ['drifter'], 'stray-dog': ['exile'],
  'last-customer': ['double', 'witness'], archivist: ['scribe', 'gatekeeper'], ghost: ['revenant'], usher: ['gatekeeper'],
  silverfish: ['crowd', 'monster'], censor: ['sovereign', 'gatekeeper'], projector: ['machine', 'observer'], mother: ['saint'],
  drone: ['machine'], geologist: ['observer', 'scribe'], insect: ['monster'], hound: ['revenant', 'monster'],
  volume: ['double', 'sovereign'], rival: ['double', 'drifter'],
};

/** 応答。相手の原型（キー）に、どの原型が答えるか。 */
export const ANSWERS: Readonly<Record<Archetype, readonly Archetype[]>> = {
  gatekeeper: ['trickster', 'witness'],
  sovereign: ['saint', 'crowd'],
  monster: ['child', 'saint'],
  trickster: ['detective', 'observer'],
  detective: ['double', 'revenant'],
  revenant: ['witness', 'scribe'],
  machine: ['child', 'revenant'],
  drifter: ['child', 'crowd'],
  exile: ['saint', 'child'],
  crowd: ['sovereign', 'monster'],
  observer: ['trickster', 'double'],
  witness: ['sovereign', 'gatekeeper'],
  double: ['observer', 'detective'],
  scribe: ['trickster', 'revenant'],
  child: ['monster', 'sovereign'],
  saint: ['monster', 'exile'],
};

export interface ArchSet {
  arch: Archetype;
  at: 2 | 3;
  text: string;
  passive?: readonly PassiveSpec[];
  triggers?: readonly TriggerSpec[];
}

const mine = (w: { enc?: { who: string } | null }) => w.enc?.who === 'you';

/** 重なり。同じ原型を 2 枚・3 枚、枠にそろえると効く。 */
export const ARCH_SETS: readonly ArchSet[] = [
  { arch: 'saint', at: 2, text: '0 回で使うと信頼 +1（差し出すことで信じてもらう）', triggers: [{ on: 'card.use', when: (ev, w) => ev.type === 'card.use' && ev.spent && mine(w), run: (tx) => trust(tx, 1), text: '0 回で使うと信頼 +1' }] },
  { arch: 'saint', at: 3, text: '代償を払わない', passive: [{ rule: 'selfCost', fn: () => 0, text: '代償なし' }] },
  { arch: 'gatekeeper', at: 2, text: '毎手番 守り +2', passive: [{ rule: 'turnGuard', fn: (_c, v) => v + 2, text: '毎手番 守り +2' }] },
  { arch: 'gatekeeper', at: 3, text: '遭遇の初めの敵意 −2', passive: [{ rule: 'startHostility', fn: (_c, v) => v - 2, text: '初めの敵意 −2' }] },
  { arch: 'drifter', at: 2, text: '着くたび、［場所］のカードの回数 +1', triggers: [{ on: 'moved', run: (tx) => refill(tx, 1, 'place', 'you'), text: '着くたび［場所］+1' }] },
  { arch: 'drifter', at: 3, text: '出来事の判定 +15%', passive: [{ rule: 'storyChance', fn: (_c, v) => v + 15, text: '出来事 +15%' }] },
  { arch: 'observer', at: 2, text: '予告が嘘でも見える', passive: [{ rule: 'intentVisible', fn: () => 1, text: '予告が見える' }] },
  { arch: 'observer', at: 3, text: '遭遇の初めに手がかりを 1 つ', triggers: [{ on: 'enc.start', when: (ev) => ev.type === 'enc.start' && ev.who === 'you', run: (tx) => void revealClue(tx), text: '初めに手がかり 1' }] },
  { arch: 'exile', at: 2, text: '噂に構えられない（初めの敵意 −2）', passive: [{ rule: 'startHostility', fn: (_c, v) => v - 2, text: '初めの敵意 −2' }] },
  { arch: 'exile', at: 3, text: '0 回で使うカード ×1.5', passive: [{ rule: 'mult', when: (c) => !!c.spent, fn: (_c, v) => v * 1.5, text: '0 回のカード ×1.5' }] },
  { arch: 'witness', at: 2, text: '誤った手がかり −15%', passive: [{ rule: 'falseChance', fn: (_c, v) => v - 15, text: '誤り −15%' }] },
  { arch: 'witness', at: 3, text: '手がかりを見るたび、相手の意志 −2', triggers: [{ on: 'clue', when: (ev, w) => ev.type === 'clue' && ev.shown && !ev.false && mine(w), run: (tx) => void breakFoe(tx, 2), text: '手がかりで意志 −2' }] },
  { arch: 'machine', at: 2, text: '［技術］のカード ×1.25', passive: [{ rule: 'mult', when: (c) => !!c.tags?.includes('tech'), fn: (_c, v) => v * 1.25, text: '［技術］×1.25' }] },
  { arch: 'machine', at: 3, text: '3 枚目ごとのカードは回数を減らさない', passive: [{ rule: 'useSpend', when: (c) => ((c.enc?.cards ?? 0) + 1) % 3 === 0, fn: () => 0, text: '3 枚目ごとにただ' }] },
  { arch: 'detective', at: 2, text: 'INT 判定 +10%', passive: [{ rule: 'checkChance', when: (c) => !!c.stat?.includes('INT'), fn: (_c, v) => v + 10, text: 'INT +10%' }] },
  { arch: 'detective', at: 3, text: '暴くと金 15', triggers: [{ on: 'enc.end', when: (ev, w) => ev.type === 'enc.end' && ev.outcome === 'uncovered' && mine(w), run: (tx) => coins(tx, 15, 'you'), text: '暴くと金 15' }] },
  { arch: 'trickster', at: 2, text: '嘘 +15%', passive: [{ rule: 'lieChance', fn: (_c, v) => v + 15, text: '嘘 +15%' }] },
  { arch: 'trickster', at: 3, text: '嘘がばれると、かえって信頼 +3（憎めない）', triggers: [{ on: 'caught', when: (_ev, w) => mine(w), run: (tx) => trust(tx, 5), text: 'ばれると信頼 +3' }] },
  { arch: 'revenant', at: 2, text: '精神への傷 −1', passive: [{ rule: 'threatTaken', fn: (_c, v) => Math.max(0, v - 1), text: '精神への傷 −1' }] },
  { arch: 'revenant', at: 3, text: '毎手番 心の構え +3', passive: [{ rule: 'turnCalm', fn: (_c, v) => v + 3, text: '毎手番 構え +3' }] },
  { arch: 'double', at: 2, text: '連鎖 ×1.4 以上', passive: [{ rule: 'chain', fn: (_c, v) => (v > 1 ? Math.max(v, 1.4) : v), text: '連鎖 ×1.4' }] },
  { arch: 'double', at: 3, text: '真似るが元より強い（×1.3）', passive: [{ rule: 'mult', when: (c) => c.card === 'mimic', fn: (_c, v) => v * 1.3, text: '真似る ×1.3' }] },
  { arch: 'monster', at: 2, text: '体力を削る量 +2', passive: [{ rule: 'hit', fn: (_c, v) => v + 2, text: '体力 +2' }] },
  { arch: 'monster', at: 3, text: '体力を削る量 ×1.3。ただし初めの敵意 +2', passive: [{ rule: 'hit', fn: (_c, v) => v * 1.3, text: '体力 ×1.3' }, { rule: 'startHostility', fn: (_c, v) => v + 2, text: '初めの敵意 +2' }] },
  { arch: 'sovereign', at: 2, text: '意志を削る量 ×1.25', passive: [{ rule: 'break', fn: (_c, v) => v * 1.25, text: '意志 ×1.25' }] },
  { arch: 'sovereign', at: 3, text: '［制度］の相手の意志 ×1.5', passive: [{ rule: 'break', when: (c) => !!c.enc?.foe.tags.includes('institution'), fn: (_c, v) => v * 1.5, text: '［制度］×1.5' }] },
  { arch: 'scribe', at: 2, text: '出来事の判定 +10%', passive: [{ rule: 'storyChance', fn: (_c, v) => v + 10, text: '出来事 +10%' }] },
  { arch: 'scribe', at: 3, text: '書き留めた次のカードが ×2', passive: [{ rule: 'mult', when: (c) => (c.enc?.st.noted ?? 0) > 0, fn: (_c, v) => (v * 2) / 1.5, text: '書き留め ×2' }] },
  { arch: 'child', at: 2, text: '初めから信頼 +1', passive: [{ rule: 'startTrust', fn: (_c, v) => v + 1, text: '初めから信頼 +1' }] },
  { arch: 'child', at: 3, text: '信頼の伸び +1', passive: [{ rule: 'trust', fn: (_c, v) => (v > 0 ? v + 1 : v), text: '信頼 +1' }] },
  { arch: 'crowd', at: 2, text: 'カードの効き目 ×1.1', passive: [{ rule: 'mult', fn: (_c, v) => v * 1.1, text: '×1.1' }] },
  { arch: 'crowd', at: 3, text: '金の入り ×1.2', passive: [{ rule: 'coins', fn: (_c, v) => Math.round(v * 1.2), text: '金 ×1.2' }] },
];
