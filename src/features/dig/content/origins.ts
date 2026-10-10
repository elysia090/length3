/**
 * 人物を決める（0〜5 分）。職のほかに、三つから一つずつ選ぶ。
 *   経歴      最初の記憶（永続カード）。職ごとに 3 つ
 *   エピテット 手元に一つ（あとで好きな札か記憶に刻む）
 *   所持品    一つ
 * 初めの札は 3 枚で、枠は 2 つ空いている。ここでは完成したビルドは作れない
 * （「今回はこういう人物になりそう」まで）。
 */

export interface Sheet {
  name?: string;
  origin?: string;
  ep?: string;
  item?: string;
}

export const ORIGINS: Readonly<Record<string, readonly string[]>> = {
  surveyor: ['habit-measure', 'core-sample', 'saw-her'],
  watch: ['old-wound', 'watch-debt', 'nighthawk'],
  projectionist: ['accident', 'last-reel', 'projected'],
  reporter: ['suspicion', 'redacted', 'her-file'],
  locksmith: ['runaway', 'shaft-key', 'false-alibi'],
  nurse: ['daughter-photo', 'lullaby', 'voicemail'],
  welder: ['scarred', 'factory-smell', 'fire'],
};

export const JOB_EPITHETS: Readonly<Record<string, readonly string[]>> = {
  surveyor: ['sharp', 'recorded', 'drifting'],
  watch: ['nocturnal', 'heavy', 'taciturn'],
  projectionist: ['echoing', 'repeating', 'imitated'],
  reporter: ['exposed', 'recorded', 'borrowed'],
  locksmith: ['stolen', 'silent', 'closed'],
  nurse: ['blessed', 'damp', 'transparent'],
  welder: ['burning', 'heavy', 'corroded'],
};

export const JOB_ITEMS: Readonly<Record<string, readonly string[]>> = {
  surveyor: ['notebook', 'bus-ticket', 'coffee'],
  watch: ['radio', 'cigarette', 'badge-pin'],
  projectionist: ['photo', 'coffee', 'cigarette'],
  reporter: ['notebook', 'photo', 'whisky'],
  locksmith: ['brass', 'bus-ticket', 'cigarette'],
  nurse: ['bandage', 'coffee', 'photo'],
  welder: ['whisky', 'brass', 'bandage'],
};

/** はじめに枠へ入る職の札の数（枠は五つなので一つは空き。職の残りの札は、拾える札に出やすい）。 */
export const START_CARDS = 4;

/** 何も選ばなかったときの人物（3 分で始めたい人向け）。 */
export const defaultSheet = (job: string): Required<Omit<Sheet, 'name'>> => ({
  origin: ORIGINS[job]?.[0] ?? 'old-wound',
  ep: JOB_EPITHETS[job]?.[0] ?? 'sharp',
  item: JOB_ITEMS[job]?.[0] ?? 'bandage',
});
