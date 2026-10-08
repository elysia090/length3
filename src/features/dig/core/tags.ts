/**
 * 共通の語彙。カードも記憶も人物も出来事も、同じタグを読む。
 */
export const TAGS = [
  'place',
  'person',
  'memory',
  'institution',
  'body',
  'gaze',
  'time',
  'trust',
  'public',
  'private',
  'tech',
  'night',
] as const;

export type Tag = (typeof TAGS)[number];

export const TAG_NAME: Record<Tag, string> = {
  place: '場所',
  person: '人物',
  memory: '記憶',
  institution: '制度',
  body: '身体',
  gaze: '視線',
  time: '時間',
  trust: '信頼',
  public: '公開情報',
  private: '私的情報',
  tech: '技術',
  night: '夜',
};

export type TagCount = Partial<Record<Tag, number>>;

export function countTags(lists: readonly (readonly Tag[])[]): TagCount {
  const out: TagCount = {};
  for (const list of lists) for (const t of list) out[t] = (out[t] ?? 0) + 1;
  return out;
}

export const meets = (have: TagCount, need: TagCount) =>
  Object.entries(need).every(([t, n]) => (have[t as Tag] ?? 0) >= (n ?? 0));

/**
 * 伝承原型《アーキタイプ》。作品のモチーフと含意（誰として振る舞うか）。
 * タグが「何について」なら、原型は「誰として」。
 */
export const ARCHETYPES = [
  'saint',
  'gatekeeper',
  'drifter',
  'observer',
  'exile',
  'witness',
  'machine',
  'detective',
  'trickster',
  'revenant',
  'double',
  'monster',
  'sovereign',
  'scribe',
  'child',
  'crowd',
  'prophet',
  'hunter',
  'prisoner',
  'architect',
  'traitor',
  'lover',
  'survivor',
  'judge',
] as const;

export type Archetype = (typeof ARCHETYPES)[number];

export const ARCH_NAME: Record<Archetype, string> = {
  saint: '聖人／殉教者',
  gatekeeper: '門番',
  drifter: '漂流者',
  observer: '観測者',
  exile: '追放者',
  witness: '証人',
  machine: '機械人間',
  detective: '探偵',
  trickster: '道化',
  revenant: '亡霊',
  double: '分身',
  monster: '怪物',
  sovereign: '主権者',
  scribe: '記録者',
  child: '子ども',
  crowd: '群衆',
  prophet: '預言者',
  hunter: '狩人',
  prisoner: '囚人',
  architect: '建築家',
  traitor: '裏切り者',
  lover: '恋人',
  survivor: '生き残り',
  judge: '裁く者',
};

export type ArchCount = Partial<Record<Archetype, number>>;
