import type { Auto } from './flavor';

/**
 * 小ネタと、ちょっとした驚き。選択も説明もなく、ふと起きて、ふと終わる。
 * 数が動くものは、理由が文の中にある（金が一枚増える、など）。
 *
 * 決まった階で起きること（エンジンの中。記録して再生できる）
 *   B13   案内板にない階
 *   B44   時計が一度だけ逆に回る
 *   B100  数えるのをやめる
 */
export const EXTRA_AUTO: readonly Auto[] = [
  {
    id: 'jackpot',
    section: 1,
    text: '自販機に硬貨を入れる前に、ランプが回った。当たり、もう一本。釣り銭口に硬貨が五枚。',
    fx: { coins: 5 },
  },
  {
    id: 'own-voice',
    section: 1,
    text: '踊り場の公衆電話が鳴る。出ると、自分の声が「下で待ってる」と言って切れた。',
  },
  {
    id: 'empty-wallet',
    text: '落とし物の財布。中身はレシートが一枚。合計 0 円、とだけ印字されている。',
  },
  {
    id: 'dont-skimp',
    text: '手帳の最後の頁に、知らない字で「けちるな」と書いてある。',
  },
  {
    id: 'extra-coin',
    text: 'ポケットの硬貨が一枚多い。数え違いだろう。',
    fx: { coins: 1 },
  },
  {
    id: 'tomorrow-stub',
    section: 2,
    text: '映写室の前に、半券が一枚。日付は明日になっている。',
  },
  {
    id: 'stamp-you',
    section: 2,
    text: '受付の判子が、勝手にあなたの手の甲に押された。「保留」。',
  },
  {
    id: 'ant',
    section: 3,
    text: '琥珀の中の蟻と目が合った。向こうが先に目を逸らした。',
  },
  {
    id: 'lost-lamp',
    section: 3,
    text: '固まりかけた床に、誰かの灯りが埋まっている。芯はまだ温かい。少しだけ油を分けてもらった。',
    fx: { mind: 2 },
  },
];

/** 決まった階で起きること（着いたときの一文に添える）。 */
export const FLOOR_EGGS: Readonly<Record<number, { text: string; level: 1 | 2 | 3 }>> = {
  13: { text: '案内板には、この階がない。13 の数字だけ、上から紙が貼ってある。', level: 2 },
  44: { text: '時計が一度だけ、逆に回った。誰も気づいていない。', level: 2 },
  100: { text: '百階。数えるのをやめた。', level: 3 },
};
