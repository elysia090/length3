import type { Archetype } from '../core/tags';
import { breakFoe, coins, heal, refill, revealClue, stun, trust } from '../sim/ops';
import type { PassiveSpec, TriggerSpec } from './defs';

/**
 * 伝承原型《アーキタイプ》の割り当てと、その働き。
 *
 *   割り当て  作品ごとのモチーフ（1〜2）と、人物の原型
 *   応答      あなたのカードの原型が、相手の原型に「答える」と ×1.4
 *   重なり    同じ原型を 2 枚・3 枚そろえると、規則が書き換わる
 */

export const WORK_ARCH: Readonly<Record<string, readonly Archetype[]>> = {
  joseph: ['saint', 'child'],
  agnus: ['saint'],
  airpump: ['observer', 'witness'],
  meninas: ['observer', 'sovereign'],
  delft: ['observer'],
  hunters: ['hunter', 'crowd'],
  wave: ['monster'],
  may3: ['witness', 'judge'],
  monk: ['drifter', 'observer'],
  isle: ['revenant'],
  icesea: ['drifter', 'survivor'],
  rain: ['machine'],
  cafe: ['drifter', 'crowd'],
  night: ['revenant', 'double'],
  prisons: ['prisoner', 'gatekeeper'],
  chirico: ['child', 'revenant'],
  empire: ['double', 'trickster'],
  karljohan: ['crowd', 'double'],
  vertigo: ['exile', 'lover'],
  glove: ['double', 'observer'],
  pope: ['sovereign', 'monster'],
  nighthawks: ['drifter', 'witness'],
  interior: ['exile', 'prisoner'],
  khnopff: ['double', 'lover'],
  bureau: ['gatekeeper', 'crowd'],
  lot49: ['detective', 'trickster'],
  correction: ['scribe', 'prisoner'],
  boris: ['witness', 'saint'],
  saturn: ['drifter', 'scribe'],
  falling: ['witness', 'saint'],
  cosmos: ['detective', 'trickster'],
  voice: ['observer', 'scribe'],
  w: ['child', 'exile'],
  merulana: ['detective', 'crowd'],
  distant: ['monster', 'scribe'],
  molloy: ['drifter', 'double'],
  ficciones: ['scribe', 'double'],
  crocodiles: ['child', 'revenant'],
  morel: ['double', 'lover'],
  policeman: ['gatekeeper', 'trickster'],
  labyrinth: ['architect', 'drifter'],
  paramo: ['revenant', 'exile'],
  map: ['detective', 'exile'],
  cities: ['scribe', 'architect'],
  ice: ['drifter', 'survivor'],
  ubik: ['revenant', 'machine'],
  android: ['machine', 'detective'],
  orwell: ['sovereign', 'prisoner'],
  miserables: ['saint', 'exile'],
  threebody: ['observer', 'prophet'],
  chrome: ['trickster', 'machine'],
  solaris: ['revenant', 'lover'],
  picnic: ['drifter', 'survivor'],
  dune: ['sovereign', 'prophet'],
  leaves: ['scribe', 'exile'],
  ironman: ['machine'],
  darkknight: ['gatekeeper', 'judge'],
  pulp: ['trickster', 'crowd'],
  rim: ['machine', 'double'],
  jaws: ['monster', 'hunter'],
  t2: ['machine', 'child'],
  robocop: ['machine', 'judge'],
  alien: ['monster', 'survivor'],
  bladerunner: ['detective', 'hunter'],
  thing: ['monster', 'double'],
  matrix: ['machine', 'double'],
  fightclub: ['double', 'traitor'],
  seven: ['detective', 'judge'],
  heat: ['double', 'hunter'],
  children: ['child', 'survivor'],
  odyssey: ['machine', 'prophet'],
  brazil: ['scribe', 'prisoner'],
  conversation: ['observer', 'witness'],
  mulholland: ['double', 'traitor'],
  stalker: ['drifter', 'gatekeeper'],
  highlow: ['detective', 'traitor'],
  dunes: ['exile', 'drifter'],
  cure: ['trickster', 'traitor'],
  akira: ['monster', 'prophet'],
  ghost: ['machine', 'detective'],
  federalist: ['sovereign', 'judge'],
  objectivity: ['observer', 'scribe'],
  ethic: ['saint', 'crowd'],
  democracy: ['crowd', 'judge'],
  leviathan: ['sovereign', 'monster'],
  origins: ['witness', 'crowd'],
  discipline: ['gatekeeper', 'prisoner'],
  transformation: ['crowd', 'scribe'],
  seeing: ['sovereign', 'observer'],
  presentation: ['trickster', 'crowd'],
  metropolis: ['crowd', 'architect'],
  revolutions: ['prophet', 'scribe'],
  cybernetics: ['machine', 'observer'],
  artificial: ['machine', 'scribe'],
  vernacular: ['crowd', 'architect'],
  jacobs: ['crowd', 'architect'],
  pattern: ['architect', 'child'],
  image: ['drifter', 'architect'],
  space: ['architect', 'sovereign'],
  delirious: ['monster', 'architect'],
};

export const FOE_ARCH: Readonly<Record<string, readonly Archetype[]>> = {
  watchman: ['gatekeeper', 'judge'],
  counterman: ['witness'],
  regular: ['drifter', 'traitor'],
  'stray-dog': ['exile', 'survivor'],
  'last-customer': ['double', 'witness'],
  archivist: ['scribe', 'prisoner'],
  ghost: ['revenant', 'lover'],
  usher: ['gatekeeper', 'architect'],
  silverfish: ['crowd', 'monster'],
  censor: ['sovereign', 'judge'],
  projector: ['machine', 'prophet'],
  mother: ['saint', 'lover'],
  drone: ['machine'],
  geologist: ['observer', 'prophet'],
  insect: ['monster', 'survivor'],
  hound: ['revenant', 'hunter'],
  volume: ['double', 'sovereign'],
  rival: ['double', 'hunter'],
};

/** 応答。相手の原型（キー）に、どの原型が答えるか。 */
export const ANSWERS: Readonly<Record<Archetype, readonly Archetype[]>> = {
  gatekeeper: ['trickster', 'witness', 'prisoner'],
  sovereign: ['saint', 'crowd', 'traitor'],
  monster: ['child', 'saint', 'hunter'],
  trickster: ['detective', 'observer'],
  detective: ['double', 'revenant'],
  revenant: ['witness', 'scribe'],
  machine: ['child', 'revenant', 'survivor'],
  drifter: ['child', 'crowd', 'architect'],
  exile: ['saint', 'child', 'lover'],
  crowd: ['sovereign', 'monster', 'prophet'],
  observer: ['trickster', 'double'],
  witness: ['sovereign', 'gatekeeper'],
  double: ['observer', 'detective', 'judge'],
  scribe: ['trickster', 'revenant'],
  child: ['monster', 'sovereign'],
  saint: ['monster', 'exile'],
  prophet: ['trickster', 'scribe'],
  hunter: ['survivor', 'trickster'],
  prisoner: ['architect', 'lover'],
  architect: ['crowd', 'monster'],
  traitor: ['judge', 'witness'],
  lover: ['revenant', 'child'],
  survivor: ['lover', 'child'],
  judge: ['saint', 'prisoner'],
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
  {
    arch: 'saint',
    at: 2,
    text: '0 回で使うと信頼 +1（差し出すことで信じてもらう）',
    triggers: [
      {
        on: 'card.use',
        when: (ev, w) => ev.type === 'card.use' && ev.spent && mine(w),
        run: (tx) => trust(tx, 1),
        text: '0 回で使うと信頼 +1',
      },
    ],
  },
  {
    arch: 'saint',
    at: 3,
    text: '代償を払わない',
    passive: [{ rule: 'selfCost', fn: () => 0, text: '代償なし' }],
  },
  {
    arch: 'gatekeeper',
    at: 2,
    text: '毎手番 守り +2',
    passive: [{ rule: 'turnGuard', fn: (_c, v) => v + 2, text: '毎手番 守り +2' }],
  },
  {
    arch: 'gatekeeper',
    at: 3,
    text: '遭遇の初めの敵意 −2',
    passive: [{ rule: 'startHostility', fn: (_c, v) => v - 2, text: '初めの敵意 −2' }],
  },
  {
    arch: 'drifter',
    at: 2,
    text: '着くたび、［場所］のカードの回数 +1',
    triggers: [
      { on: 'moved', run: (tx) => refill(tx, 1, 'place', 'you'), text: '着くたび［場所］+1' },
    ],
  },
  {
    arch: 'drifter',
    at: 3,
    text: '出来事の判定 +15%',
    passive: [{ rule: 'storyChance', fn: (_c, v) => v + 15, text: '出来事 +15%' }],
  },
  {
    arch: 'observer',
    at: 2,
    text: '予告が嘘でも見える',
    passive: [{ rule: 'intentVisible', fn: () => 1, text: '予告が見える' }],
  },
  {
    arch: 'observer',
    at: 3,
    text: '遭遇の初めに手がかりを 1 つ',
    triggers: [
      {
        on: 'enc.start',
        when: (ev) => ev.type === 'enc.start' && ev.who === 'you',
        run: (tx) => void revealClue(tx),
        text: '初めに手がかり 1',
      },
    ],
  },
  {
    arch: 'exile',
    at: 2,
    text: '噂に構えられない（初めの敵意 −2）',
    passive: [{ rule: 'startHostility', fn: (_c, v) => v - 2, text: '初めの敵意 −2' }],
  },
  {
    arch: 'exile',
    at: 3,
    text: '0 回で使うカード ×1.5',
    passive: [
      { rule: 'mult', when: (c) => !!c.spent, fn: (_c, v) => v * 1.5, text: '0 回のカード ×1.5' },
    ],
  },
  {
    arch: 'witness',
    at: 2,
    text: '誤った手がかり −15%',
    passive: [{ rule: 'falseChance', fn: (_c, v) => v - 15, text: '誤り −15%' }],
  },
  {
    arch: 'witness',
    at: 3,
    text: '手がかりを見るたび、相手の意志 −2',
    triggers: [
      {
        on: 'clue',
        when: (ev, w) => ev.type === 'clue' && ev.shown && !ev.false && mine(w),
        run: (tx) => void breakFoe(tx, 2),
        text: '手がかりで意志 −2',
      },
    ],
  },
  {
    arch: 'machine',
    at: 2,
    text: '［技術］のカード ×1.25',
    passive: [
      {
        rule: 'mult',
        when: (c) => !!c.tags?.includes('tech'),
        fn: (_c, v) => v * 1.25,
        text: '［技術］×1.25',
      },
    ],
  },
  {
    arch: 'machine',
    at: 3,
    text: '3 枚目ごとのカードは回数を減らさない',
    passive: [
      {
        rule: 'useSpend',
        when: (c) => ((c.enc?.cards ?? 0) + 1) % 3 === 0,
        fn: () => 0,
        text: '3 枚目ごとにただ',
      },
    ],
  },
  {
    arch: 'detective',
    at: 2,
    text: 'INT 判定 +10%',
    passive: [
      {
        rule: 'checkChance',
        when: (c) => !!c.stat?.includes('INT'),
        fn: (_c, v) => v + 10,
        text: 'INT +10%',
      },
    ],
  },
  {
    arch: 'detective',
    at: 3,
    text: '暴くと金 15',
    triggers: [
      {
        on: 'enc.end',
        when: (ev, w) => ev.type === 'enc.end' && ev.outcome === 'uncovered' && mine(w),
        run: (tx) => coins(tx, 15, 'you'),
        text: '暴くと金 15',
      },
    ],
  },
  {
    arch: 'trickster',
    at: 2,
    text: '嘘 +15%',
    passive: [{ rule: 'lieChance', fn: (_c, v) => v + 15, text: '嘘 +15%' }],
  },
  {
    arch: 'trickster',
    at: 3,
    text: '嘘がばれると、かえって信頼 +3（憎めない）',
    triggers: [
      {
        on: 'caught',
        when: (_ev, w) => mine(w),
        run: (tx) => trust(tx, 3),
        text: 'ばれると信頼 +3',
      },
    ],
  },
  {
    arch: 'revenant',
    at: 2,
    text: '精神への傷 −1',
    passive: [{ rule: 'threatTaken', fn: (_c, v) => Math.max(0, v - 1), text: '精神への傷 −1' }],
  },
  {
    arch: 'revenant',
    at: 3,
    text: '毎手番 心の構え +3',
    passive: [{ rule: 'turnCalm', fn: (_c, v) => v + 3, text: '毎手番 構え +3' }],
  },
  {
    arch: 'double',
    at: 2,
    text: '連鎖 +1',
    passive: [{ rule: 'chain', fn: (_c, v) => (v > 0 ? v + 1 : v), text: '連鎖 +1' }],
  },
  {
    arch: 'double',
    at: 3,
    text: '真似るが元より強い（×1.3）',
    passive: [
      {
        rule: 'mult',
        when: (c) => c.card === 'mimic',
        fn: (_c, v) => v * 1.3,
        text: '真似る ×1.3',
      },
    ],
  },
  {
    arch: 'monster',
    at: 2,
    text: '体力を削る量 +2',
    passive: [{ rule: 'hit', fn: (_c, v) => v + 2, text: '体力 +2' }],
  },
  {
    arch: 'monster',
    at: 3,
    text: '体力を削る量 ×1.3。ただし初めの敵意 +2',
    passive: [
      { rule: 'hit', fn: (_c, v) => v * 1.3, text: '体力 ×1.3' },
      { rule: 'startHostility', fn: (_c, v) => v + 2, text: '初めの敵意 +2' },
    ],
  },
  {
    arch: 'sovereign',
    at: 2,
    text: '意志を削る量 ×1.25',
    passive: [{ rule: 'break', fn: (_c, v) => v * 1.25, text: '意志 ×1.25' }],
  },
  {
    arch: 'sovereign',
    at: 3,
    text: '［制度］の相手の意志 ×1.5',
    passive: [
      {
        rule: 'break',
        when: (c) => !!c.enc?.foe.tags.includes('institution'),
        fn: (_c, v) => v * 1.5,
        text: '［制度］×1.5',
      },
    ],
  },
  {
    arch: 'scribe',
    at: 2,
    text: '出来事の判定 +10%',
    passive: [{ rule: 'storyChance', fn: (_c, v) => v + 10, text: '出来事 +10%' }],
  },
  {
    arch: 'scribe',
    at: 3,
    text: '書き留めた次のカードが ×2',
    passive: [
      {
        rule: 'mult',
        when: (c) => (c.enc?.st.noted ?? 0) > 0,
        fn: (_c, v) => (v * 2) / 1.5,
        text: '書き留め ×2',
      },
    ],
  },
  {
    arch: 'child',
    at: 2,
    text: '初めから信頼 +1',
    passive: [{ rule: 'startTrust', fn: (_c, v) => v + 1, text: '初めから信頼 +1' }],
  },
  {
    arch: 'child',
    at: 3,
    text: '信頼の伸び +1',
    passive: [{ rule: 'trust', fn: (_c, v) => (v > 0 ? v + 1 : v), text: '信頼 +1' }],
  },
  {
    arch: 'crowd',
    at: 2,
    text: 'カードの効き目 ×1.1',
    passive: [{ rule: 'mult', fn: (_c, v) => v * 1.1, text: '×1.1' }],
  },
  {
    arch: 'crowd',
    at: 3,
    text: '金の入り ×1.2',
    passive: [{ rule: 'coins', fn: (_c, v) => Math.round(v * 1.2), text: '金 ×1.2' }],
  },
  // ─── 預言者・狩人・囚人・建築家・裏切り者・恋人・生き残り・裁く者 ───
  {
    arch: 'prophet',
    at: 2,
    text: '予告が見え、嘘の予告の手番はカード ×1.3',
    passive: [
      { rule: 'intentVisible', fn: () => 1, text: '予告が見える' },
      {
        rule: 'mult',
        when: (c) => !!c.enc?.foe.intent?.lie,
        fn: (_c, v) => v * 1.3,
        text: '嘘の手番 ×1.3',
      },
    ],
  },
  {
    arch: 'prophet',
    at: 3,
    text: '遭遇の初め、相手は 1 手番うごけない',
    triggers: [
      {
        on: 'enc.start',
        when: (ev) => ev.type === 'enc.start' && ev.who === 'you',
        run: (tx) => stun(tx),
        text: '初めに相手を止める',
      },
    ],
  },
  {
    arch: 'hunter',
    at: 2,
    text: '相手の体力が半分を切ると、体力を削る量 ×1.3',
    passive: [
      {
        rule: 'hit',
        when: (c) => !!c.enc && c.enc.foe.hp * 2 < c.enc.foe.maxHp,
        fn: (_c, v) => v * 1.3,
        text: '弱った相手 ×1.3',
      },
    ],
  },
  {
    arch: 'hunter',
    at: 3,
    text: '倒すと、全カードの回数 +1',
    triggers: [
      {
        on: 'enc.end',
        when: (ev, w) => ev.type === 'enc.end' && ev.outcome === 'beaten' && mine(w),
        run: (tx) => refill(tx, 1, undefined, 'you'),
        text: '倒すと全カード +1',
      },
    ],
  },
  {
    arch: 'prisoner',
    at: 2,
    text: '立ち去れない。そのかわり毎手番 守り +3・心の構え +2',
    passive: [
      { rule: 'leaveChance', fn: () => 0, text: '立ち去れない' },
      { rule: 'turnGuard', fn: (_c, v) => v + 3, text: '毎手番 守り +3' },
      { rule: 'turnCalm', fn: (_c, v) => v + 2, text: '毎手番 構え +2' },
    ],
  },
  {
    arch: 'prisoner',
    at: 3,
    text: '守りが手番をまたいで残る',
    passive: [{ rule: 'guardKeep', fn: () => 1, text: '守りが残る' }],
  },
  {
    arch: 'architect',
    at: 2,
    text: '着くまでの時間 −1（2 段に 1 度）',
    passive: [
      {
        rule: 'timeCost',
        when: (c) => c.kind === 'move',
        fn: (_c, v) => v - 0.5,
        text: '移動 −0.5 時間',
      },
    ],
  },
  {
    arch: 'architect',
    at: 3,
    text: '［場所］のカード ×1.4',
    passive: [
      {
        rule: 'mult',
        when: (c) => !!c.tags?.includes('place'),
        fn: (_c, v) => v * 1.4,
        text: '［場所］×1.4',
      },
    ],
  },
  {
    arch: 'traitor',
    at: 2,
    text: '信頼が半ばを越えた相手へのカード ×1.5（裏切り）',
    passive: [
      {
        rule: 'mult',
        when: (c) => !!c.enc && c.enc.foe.trust * 2 >= c.enc.foe.need,
        fn: (_c, v) => v * 1.5,
        text: '信じた相手に ×1.5',
      },
    ],
  },
  {
    arch: 'traitor',
    at: 3,
    text: '信頼を得た相手を倒すと、金 20 と全カード +1',
    triggers: [
      {
        on: 'enc.end',
        when: (ev, w) =>
          ev.type === 'enc.end' &&
          ev.outcome === 'beaten' &&
          mine(w) &&
          (w.enc?.foe.trust ?? 0) > 0,
        run: (tx) => {
          coins(tx, 20, 'you');
          refill(tx, 1, undefined, 'you');
        },
        text: '裏切って倒すと 金 20・全カード +1',
      },
    ],
  },
  {
    arch: 'lover',
    at: 2,
    text: '信頼の伸び ×1.5。ただし精神への傷 +1',
    passive: [
      { rule: 'trust', fn: (_c, v) => (v > 0 ? v * 1.5 : v), text: '信頼 ×1.5' },
      { rule: 'threatTaken', fn: (_c, v) => (v > 0 ? v + 1 : v), text: '精神への傷 +1' },
    ],
  },
  {
    arch: 'lover',
    at: 3,
    text: '打ち解けると、体力と精神が全快',
    triggers: [
      {
        on: 'enc.end',
        when: (ev, w) => ev.type === 'enc.end' && ev.outcome === 'trusted' && mine(w),
        run: (tx) => heal(tx, 99, 99, 'you'),
        text: '打ち解けると全快',
      },
    ],
  },
  {
    arch: 'survivor',
    at: 2,
    text: '体力が 1/3 を切ると、カード ×1.5',
    passive: [
      {
        rule: 'mult',
        when: (c) => c.w.you.hp * 3 < 16 + 4 * c.w.you.innate.VIT,
        fn: (_c, v) => v * 1.5,
        text: '追い詰められると ×1.5',
      },
    ],
  },
  {
    arch: 'survivor',
    at: 3,
    text: '一撃で受ける傷は、いまの体力の半分まで',
    passive: [
      {
        rule: 'strikeTaken',
        fn: (c, v) =>
          Math.min(
            v,
            Math.max(1, Math.ceil((c.who === 'rival' ? c.w.rival.char : c.w.you).hp / 2)),
          ),
        text: '一撃は体力の半分まで',
      },
    ],
  },
  {
    arch: 'judge',
    at: 2,
    text: '敵意 6 以上の相手の意志を削る量 ×1.4',
    passive: [
      {
        rule: 'break',
        when: (c) => (c.enc?.foe.hostility ?? 0) >= 6,
        fn: (_c, v) => v * 1.4,
        text: '荒れた相手の意志 ×1.4',
      },
    ],
  },
  {
    arch: 'judge',
    at: 3,
    text: '体力を削るたび、意志も半分だけ削る',
    triggers: [
      {
        on: 'foe',
        when: (ev, w) => ev.type === 'foe' && ev.field === 'hp' && ev.n < 0 && mine(w),
        run: (tx, ev) => {
          if (ev.type === 'foe') breakFoe(tx, Math.ceil(-ev.n / 2));
        },
        text: '体力を削ると意志も',
      },
    ],
  },
];
