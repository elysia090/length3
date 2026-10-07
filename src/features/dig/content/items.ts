import type { ItemDef } from './defs';

/** 所持品。タグごとにカードの回数を戻すものと、体と心を戻すもの。 */
export const ITEM_LIST: readonly ItemDef[] = [
  { id: 'notebook', name: '手帳', text: '［視線］［公開情報］のカードの回数 +2。', refill: { tags: ['gaze', 'public'], n: 2 }, price: 30, flavor: '前の持ち主の字で、角度と距離が書いてある。' },
  { id: 'cigarette', name: '煙草', text: '［記憶］［時間］のカードの回数 +2、精神 +3。', refill: { tags: ['memory', 'time'], n: 2 }, heal: { mind: 3 }, price: 25, flavor: 'PHILLIES。最後の一本。' },
  { id: 'bandage', name: '包帯', text: '体力 +10。', heal: { hp: 10 }, price: 20, flavor: '少し、足りない長さ。' },
  { id: 'whisky', name: 'ウイスキー', text: '［人物］［信頼］のカードの回数 +2。', refill: { tags: ['person', 'trust'], n: 2 }, price: 30, flavor: '口が軽くなる。' },
  { id: 'brass', name: 'メリケンサック', text: '［身体］のカードの回数 +2。', refill: { tags: ['body'], n: 2 }, price: 30, flavor: '指に、ちょうど合う。' },
  { id: 'bus-ticket', name: '回数券', text: '［場所］のカードの回数 +1。', refill: { tags: ['place'], n: 1 }, price: 26, flavor: '終バスは、もう出た。' },
  { id: 'coffee', name: 'コーヒー', text: '精神 +8。', heal: { mind: 8 }, price: 18, flavor: '深夜の食堂の、煮詰まった一杯。' },
  { id: 'radio', name: 'トランジスタ', text: '［技術］［私的情報］のカードの回数 +2。', refill: { tags: ['tech', 'private'], n: 2 }, price: 32, flavor: '周波数の合間に、誰かの声。' },
  { id: 'badge-pin', name: '襟章', text: '［制度］［夜］のカードの回数 +2。', refill: { tags: ['institution', 'night'], n: 2 }, price: 32, flavor: '裏の番号は削ってある。' },
  { id: 'photo', name: '古い写真', text: 'すべてのカードの回数 +1。', refill: { tags: [], n: 1 }, price: 55, flavor: '裏に、日付だけ。' },
];
