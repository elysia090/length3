import type { MapNode } from '../core/model';
import type { Tag } from '../core/tags';

/**
 * 建物の間取り。底の見えない建物を、灯りを提げて下りていく。
 *
 * 区画     十のフロアでひとまとまり。下の区画ほど、古い夜が残っている
 *          （着くと時計は 22 時に戻る。上の夜とは別の夜だから）
 * 用途     フロアには用途がある（喫茶・路地・書庫・映写室・標本室…）。
 *          そこにいる人物も、場所に刻まれたエピテットも、そこで輝くカード
 *          （見せ場）も、用途から決まる。だから見取り図を読めば、先が読める
 * 拍子     フロアの並びは 40 分の弧から逆に組む。入口は穏やかに、三つ目で
 *          安全と冒険が分かれ、真ん中で一息つき、後半は見せ場と古物商が
 *          続く（見せ場で足りないものに気づき、次の古物商で手に入れる）。
 *          最後のひと区切りの手前で、必ず補給できる
 * 隣の塔   建物は一棟ではない。左右に別の塔がうっすら見えていて、区画に一度か
 *          二度、渡り廊下で渡れる。隣の塔は二フロアだけ下りて、本棟の下の
 *          フロアへ戻ってくる。そこには本棟では会わない顔と、珍しい棚がある
 *          （そのぶん手強く、戻り先は選べない）
 */

export interface FloorUse {
  id: string;
  name: string;
  people: readonly string[];
  danger: readonly string[];
  /** この用途の場所に刻まれやすいエピテット。 */
  eps: readonly string[];
  /** ここで輝くカードのタグ（見せ場）。 */
  stage: readonly [Tag, Tag];
  /** 初めてこのフロアに下りたときの一文。 */
  line: string;
}

export interface Section {
  name: string;
  /** 着いたときの一文（なぜ時計が戻るのか）。 */
  open: string;
  uses: readonly FloorUse[];
  boss: FloorUse;
  /** 危険の部屋の出やすさ（下の区画ほど荒い）。 */
  danger: number;
  /** 隣の塔（渡り廊下の先）。 */
  wing: { name: string; uses: readonly FloorUse[]; bridges: number };
}

export const SECTIONS: Readonly<Record<number, Section>> = {
  1: {
    name: '夜の街',
    open: '建物の上のほうは、まるごと夜の街になっている。看板の灯りが、縦坑の壁に映っている。',
    danger: 0.12,
    uses: [
      {
        id: 'gate',
        name: '夜間通用口',
        people: ['watchman'],
        danger: [],
        eps: ['closed', 'exposed'],
        stage: ['institution', 'gaze'],
        line: '守衛室の小窓だけが明るい。',
      },
      {
        id: 'cafe',
        name: '終夜営業の喫茶',
        people: ['counterman', 'regular'],
        danger: [],
        eps: ['nocturnal', 'damp', 'cat-tongue'],
        stage: ['night', 'person'],
        line: 'コーヒーの匂いが、階段の下まで上がってくる。',
      },
      {
        id: 'alley',
        name: '裏路地の階',
        people: ['regular'],
        danger: ['stray-dog'],
        eps: ['abandoned', 'torn', 'known'],
        stage: ['place', 'body'],
        line: '誰かが置いていった傘が、壁に何本も掛かっている。',
      },
      {
        id: 'bar',
        name: '閉店間際の酒場',
        people: ['regular', 'counterman'],
        danger: [],
        eps: ['crowded', 'drifting', 'maudlin'],
        stage: ['public', 'memory'],
        line: '最後の一曲が、同じところで何度も針を飛ばす。',
      },
      {
        id: 'laundry',
        name: 'コインランドリー',
        people: ['regular'],
        danger: ['stray-dog'],
        eps: ['repeating', 'echoing', 'stingy'],
        stage: ['time', 'private'],
        line: '乾燥機が一台だけ、誰もいないのに回っている。',
      },
      {
        id: 'garage',
        name: '地下駐車場',
        people: ['watchman'],
        danger: ['stray-dog'],
        eps: ['hollow', 'exposed'],
        stage: ['place', 'tech'],
        line: '番号のない区画に、車が一台だけ停まっている。',
      },
    ],
    wing: {
      name: '向かいの雑居ビル',
      bridges: 1,
      uses: [
        {
          id: 'mahjong',
          name: '雀荘の跡',
          people: ['archivist'],
          danger: [],
          eps: ['forgotten', 'echoing', 'rigged', 'two-faced'],
          stage: ['private', 'person'],
          line: '牌の音だけが、壁の向こうに残っている。ここにいるはずのない顔がいる。',
        },
        {
          id: 'pawn',
          name: '質屋の二階',
          people: [],
          danger: [],
          eps: ['abandoned', 'stingy'],
          stage: ['public', 'memory'],
          line: '値札の付いた思い出が、天井まで積んである。',
        },
      ],
    },
    boss: {
      id: 'last-train',
      name: '終電の待合',
      people: ['last-customer'],
      danger: [],
      eps: [],
      stage: ['time', 'person'],
      line: '時刻表の最後の行が、手で消してある。',
    },
  },
  2: {
    name: '記録の階',
    open: '階段を下りきると、時計が 22 時に戻っていた。ここは、もっと古い夜だ。紙と埃の匂いがする。',
    danger: 0.2,
    uses: [
      {
        id: 'stacks',
        name: '開架書庫',
        people: ['archivist'],
        danger: ['silverfish'],
        eps: ['recorded', 'forgotten'],
        stage: ['memory', 'public'],
        line: '棚の番号は、下へ行くほど古い年になる。',
      },
      {
        id: 'reading',
        name: '閲覧室',
        people: ['ghost', 'archivist'],
        danger: [],
        eps: ['sunk', 'forgotten'],
        stage: ['private', 'gaze'],
        line: '机の上に、読みかけの頁が開いたまま並んでいる。',
      },
      {
        id: 'lobby',
        name: '劇場ロビー',
        people: ['usher', 'ghost'],
        danger: [],
        eps: ['crowded', 'imitated'],
        stage: ['person', 'public'],
        line: '開演のベルが、もう何年も鳴りつづけている。',
      },
      {
        id: 'cellar',
        name: '紙魚の階',
        people: ['archivist'],
        danger: ['silverfish'],
        eps: ['corroded', 'dull'],
        stage: ['memory', 'body'],
        line: '床に落ちた紙が、踏むたびに粉になる。',
      },
      {
        id: 'censor',
        name: '検閲室',
        people: ['usher'],
        danger: ['censor'],
        eps: ['closed', 'false', 'two-faced'],
        stage: ['institution', 'private'],
        line: '黒く塗られた行だけが、きれいに揃っている。',
      },
    ],
    wing: {
      name: '旧館',
      bridges: 2,
      uses: [
        {
          id: 'maproom',
          name: '地図室',
          people: ['geologist'],
          danger: [],
          eps: ['recorded', 'drifting'],
          stage: ['place', 'memory'],
          line: '壁一面の地図に、この建物だけが描かれていない。',
        },
        {
          id: 'lending',
          name: '貸出カウンタ',
          people: [],
          danger: [],
          eps: ['early'],
          stage: ['public', 'private'],
          line: '返却期限の印が、まだ来ない日付で押してある。',
        },
      ],
    },
    boss: {
      id: 'booth',
      name: '映写室',
      people: ['projector'],
      danger: [],
      eps: [],
      stage: ['tech', 'gaze'],
      line: '光の筋の中で、埃がゆっくり降っている。',
    },
  },
  3: {
    name: '琥珀の階',
    open: 'さらに古い夜。空気が固まりかけている。時計はまた 22 時を指していた。',
    danger: 0.3,
    uses: [
      {
        id: 'specimens',
        name: '標本室',
        people: ['geologist'],
        danger: ['insect'],
        eps: ['amber', 'sunk'],
        stage: ['memory', 'time'],
        line: '瓶の中で、虫が羽を広げたまま止まっている。',
      },
      {
        id: 'nursery',
        name: '子ども部屋',
        people: ['mother'],
        danger: [],
        eps: ['forgotten', 'blessed'],
        stage: ['trust', 'memory'],
        line: '子守歌が、途中から始まって、途中で終わる。',
      },
      {
        id: 'strata',
        name: '地層の断面',
        people: ['geologist'],
        danger: ['hound'],
        eps: ['heavy', 'dry'],
        stage: ['place', 'time'],
        line: '壁が、年の数だけ縞になっている。',
      },
      {
        id: 'watchtower',
        name: '監視塔',
        people: ['mother'],
        danger: ['drone'],
        eps: ['awake', 'exposed'],
        stage: ['tech', 'gaze'],
        line: '誰もいない操作盤で、赤い灯が瞬いている。',
      },
      {
        id: 'brink',
        name: '縦坑の縁',
        people: ['mother', 'geologist'],
        danger: ['hound'],
        eps: ['drifting', 'early'],
        stage: ['body', 'night'],
        line: '手すりの向こうは、底が見えない。',
      },
    ],
    wing: {
      name: '対の塔',
      bridges: 2,
      uses: [
        {
          id: 'mirror',
          name: '鏡の間',
          people: ['counterman'],
          danger: [],
          eps: ['imitated', 'inverted'],
          stage: ['person', 'gaze'],
          line: '鏡の中のこの塔には、灯りが一つ多い。見覚えのある給仕が、ここで店を開いている。',
        },
        {
          id: 'greenhouse',
          name: '温室',
          people: [],
          danger: [],
          eps: ['damp', 'blessed'],
          stage: ['body', 'trust'],
          line: '琥珀の中で、まだ花が咲こうとしている。',
        },
      ],
    },
    boss: {
      id: 'volume',
      name: '体積',
      people: ['volume'],
      danger: [],
      eps: [],
      stage: ['memory', 'private'],
      line: 'ここまで持ってきたものが、立方体になって待っていた。',
    },
  },
};

/** 底の手前までの区画の数（ここを抜けると、ひとまず抜けたことになる）。 */
/** 区画の顔ぶれの数（夜の街・記録の階・琥珀の階。四つ目からは巡る）。 */
export const THEMES = 3;
/** 抜けるのは六つ目の区画の底（B60）。四つ目から六つ目は「深い」区画。 */
export const LAST = 6;

/**
 * 区画の中身。三つ目より下は、上の区画がもう一度現れる（もっと古い、同じ夜）。
 * 四つ目から六つ目は「深い」区画で、六つ目の底（B60）を抜ければ挑戦は抜けたことになる。
 * 人も用途も同じだが、相手は区画の深さのぶん手強く、掟は重なっていく。
 */
export function sectionOf(stratum: number): Section {
  return SECTIONS[sectionNo(stratum)] ?? (SECTIONS[1] as Section);
}

/** 区画の中身の番号（1〜3。三つ目より下は巡る）。 */
export const sectionNo = (stratum: number): number =>
  ((((stratum - 1) % THEMES) + THEMES) % THEMES) + 1;

/** 区画の呼び名。三つ目より下は「深い」「底の」を冠する。 */
export function sectionName(stratum: number): string {
  const base = sectionOf(stratum).name;
  if (stratum <= THEMES) return base;
  return `${stratum <= LAST ? '深い' : '底の'}${base}`;
}

/** 用途を id から（その区画の中で）。 */
export function useOf(stratum: number, id: string | undefined): FloorUse | undefined {
  const s = sectionOf(stratum);
  if (!s || !id) return undefined;
  return s.boss.id === id
    ? s.boss
    : (s.uses.find((u) => u.id === id) ?? s.wing.uses.find((u) => u.id === id));
}

type Kind = MapNode['kind'];

/**
 * 拍子（区画の中の 8 フロア）。各フロアに並ぶ部屋の種類。'?' は危険か人物か
 * （区画の荒さで決まる）。見せ場を出しやすいフロアには stage を立てる。
 */
export interface Beat {
  name: string;
  rooms: readonly (Kind | '?')[];
  stage: number;
}

export const BEATS: readonly Beat[] = [
  { name: '入口', rooms: ['person', 'event'], stage: 0 },
  { name: '発見', rooms: ['person', 'event', 'shop'], stage: 0.2 },
  { name: '分岐', rooms: ['event', '?'], stage: 0.9 },
  { name: '見せ場', rooms: ['person', '?', 'event'], stage: 0.7 },
  { name: '中休み', rooms: ['rest', 'person'], stage: 0.2 },
  { name: '欲張り', rooms: ['?', 'person', 'shop'], stage: 0.8 },
  { name: '余波', rooms: ['event', 'person', '?'], stage: 0.5 },
  { name: '踊り場', rooms: ['person', '?', 'event'], stage: 0.6 },
  { name: '補給', rooms: ['rest', 'shop', 'person'], stage: 0.3 },
];
