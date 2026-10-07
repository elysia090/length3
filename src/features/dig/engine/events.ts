import type { EventDef } from './defs';

/**
 * 出来事。文章と選択肢。選択肢の多くは能力値の判定で、成功率が見える。
 * 記憶（永続カード）を持っているときにだけ現れる選択肢と、組み合わせで
 * 開く出来事がある。
 */
export const EVENT_LIST: readonly EventDef[] = [
  {
    id: 'diner-window',
    title: '閉店後の食堂',
    strata: [1],
    text: '角の食堂の窓だけが、まだ明るい。カウンターに三人。誰も話していない。窓ガラスに、あなたの顔がうっすら重なっている。',
    options: [
      {
        label: '窓を叩く',
        stat: 'WIL',
        diff: 10,
        ok: '給仕が顔を上げ、黙ってコーヒーを注いでくれた。',
        fail: '誰も振り向かない。あなたはここにいないのかもしれない。',
        effect: (r) => {
          r.item('coffee');
          r.heal(0, 4);
          return undefined;
        },
        failEffect: (r) => {
          r.heal(0, -3);
          return undefined;
        },
      },
      {
        label: '客の顔を、ひとりずつ観察する',
        stat: 'INT',
        diff: 15,
        ok: '帽子の男の視線が、一度だけ北の路地へ動いた。あなたの目は、こういうことに慣れていく。',
        fail: '全員が、あなたを見ていた気がする。確かめてはいない。',
        effect: (r) => {
          r.refill(1, ['look']);
          r.xp('INT', 2);
          return undefined;
        },
        failEffect: (r) => {
          r.grant('belief');
          return undefined;
        },
      },
      {
        label: '［事故の記憶］ガラスに映る自分を見る',
        needPerm: 'accident',
        ok: 'あの夜も、こんな灯りだった。思い出すのは痛い。それでも、立っていられる。',
        effect: (r) => {
          r.heal(0, 6);
          r.xp('WIL', 2);
          return undefined;
        },
      },
      {
        label: '通り過ぎる',
        ok: 'あなたは歩き続ける。灯りは背中で小さくなる。',
        effect: () => undefined,
      },
    ],
  },
  {
    id: 'phone-booth',
    title: '電話ボックス',
    strata: [1, 3],
    text: '誰もいない通りで、電話が鳴っている。',
    options: [
      {
        label: '受話器を取る',
        stat: 'WIL',
        diff: 5,
        ok: '「……見つけたら、明かりをつけて」。聞き覚えのある声。切れた。',
        fail: '息の音だけが聞こえる。それが自分の息だと気づくまで、長くかかった。',
        effect: (r) => {
          r.heal(0, 5);
          if (r.has('promise')) r.xp('WIL', 2);
          return undefined;
        },
        failEffect: (r) => {
          r.grant('fear');
          return undefined;
        },
      },
      {
        label: '返却口の小銭を探す',
        stat: 'AGI',
        diff: 0,
        ok: '硬貨が何枚か。誰かの忘れ物。',
        fail: '指を挟んだ。',
        effect: (r) => {
          r.coins(12);
          return undefined;
        },
        failEffect: (r) => {
          r.heal(-2);
          return undefined;
        },
      },
      { label: '鳴らせておく', ok: 'ベルは、角を曲がるまで鳴っていた。', effect: () => undefined },
    ],
  },
  {
    id: 'tripod',
    title: '放置された三脚',
    strata: [1, 2],
    text: '坑道の入口に、測量用の三脚が立っている。望遠鏡は、下を向いている。',
    options: [
      {
        label: '覗く',
        stat: 'INT',
        diff: 10,
        ok: '十字線の真ん中に、さらに下へ続く坑道が見える。角度と距離が、頭に残る。',
        fail: '何も見えない。目が、暗さに負けた。',
        effect: (r) => {
          if (r.has('habit-measure')) r.refill(2, ['look']);
          else r.grant('habit-measure');
          return undefined;
        },
        failEffect: (r) => {
          r.heal(0, -2);
          return undefined;
        },
      },
      {
        label: '担いでいく（古物商に売れる）',
        stat: 'VIT',
        diff: 15,
        ok: '重い。けれど、持っていける。',
        fail: '脚が倒れて、すねを打った。',
        effect: (r) => {
          r.coins(25);
          return undefined;
        },
        failEffect: (r) => {
          r.heal(-4);
          return undefined;
        },
      },
      { label: '触らずに行く', ok: '誰かが、先にここを通った。', effect: () => undefined },
    ],
  },
  {
    id: 'scorch',
    title: '映写室の焦げ跡',
    strata: [2],
    text: '壁に、炎の形の跡が残っている。床には溶けたフィルム。焦げた匂いが、まだ新しい。',
    options: [
      {
        label: '灰を掘る',
        stat: 'VIT',
        diff: 10,
        ok: '灰の底から、焼け残った写真が一枚。',
        fail: '熱が残っていた。手のひらに、火ぶくれ。',
        effect: (r) => {
          r.item('photo');
          return undefined;
        },
        failEffect: (r) => {
          r.heal(-3);
          r.grant('fear');
          return undefined;
        },
      },
      {
        label: '溶けたフィルムを、光にかざす',
        stat: 'INT',
        diff: 15,
        ok: '一コマだけ残っていた。燃える前の、映写室。誰かが笑っている。',
        fail: '形のない影が、目の奥に焼きついた。',
        effect: (r) => {
          r.grant('fire');
          return undefined;
        },
        failEffect: (r) => {
          r.heal(0, -3);
          return undefined;
        },
      },
      {
        label: '［事故の記憶］炎の色を思い出す',
        needPerm: 'accident',
        ok: '同じ色だ。あの夜の火と。ふたつの火が、あなたの中でひとつになる。',
        effect: (r) => {
          r.grant('fire');
          r.heal(0, 4);
          return undefined;
        },
      },
    ],
  },
  {
    id: 'mirror-hall',
    title: '鏡の廊下',
    strata: [2],
    text: '両側の鏡に、あなたが何人も並んでいる。一人だけ、少し遅れて動く。',
    options: [
      {
        label: '［虚言癖］ついた嘘を、数える',
        needPerm: 'liar',
        ok: '数え終えるのに、ずいぶんかかった。口が、少し軽くなくなった。',
        effect: (r) => {
          r.remove('liar');
          r.heal(0, -4);
          return '《虚言癖》を手放した（精神 −4）。';
        },
      },
      {
        label: '遅れて動く一人を、殴る',
        stat: 'ATK',
        diff: 10,
        ok: '鏡が割れ、後ろに隠し棚。小銭と、拳の手応え。',
        fail: '鏡は割れなかった。拳だけが割れた。',
        effect: (r) => {
          r.coins(10);
          r.xp('ATK', 3);
          return undefined;
        },
        failEffect: (r) => {
          r.heal(-3);
          r.grant('temper');
          return undefined;
        },
      },
      {
        label: '立ち止まって、遅れている一人を待つ',
        stat: 'WIL',
        diff: 20,
        ok: 'やがて、全員が揃った。息が楽になる。',
        fail: '待っているうちに、どれが自分かわからなくなった。',
        effect: (r) => {
          r.heal(0, 99);
          return undefined;
        },
        failEffect: (r) => {
          r.grant('past-bound');
          return undefined;
        },
      },
    ],
  },
  {
    id: 'vending',
    title: '自動販売機',
    strata: [1, 2, 3],
    text: '地下に、なぜか自動販売機が一台。灯りは点いている。',
    options: [
      {
        label: '硬貨を入れる（金 10）',
        needCoins: 10,
        ok: 'ごとん、と何かが落ちてきた。',
        effect: (r) => {
          r.coins(-10);
          const items = ['coffee', 'cigarette', 'bandage', 'notebook'];
          const it = items[Math.floor(r.rngNext() * items.length)] ?? 'coffee';
          r.item(it);
          return undefined;
        },
      },
      {
        label: '叩く',
        stat: 'ATK',
        diff: 10,
        ok: '二つ落ちてきた。',
        fail: '警報のような音。手首も痛い。',
        effect: (r) => {
          r.item('coffee');
          r.item('bandage');
          return undefined;
        },
        failEffect: (r) => {
          r.heal(-2);
          return undefined;
        },
      },
      { label: '放っておく', ok: '灯りは、点いたままだ。', effect: () => undefined },
    ],
  },
  {
    id: 'amber-vein',
    title: '琥珀の鉱脈',
    strata: [3],
    text: '壁一面が琥珀だ。中に、小さな虫や葉や、名前のわからないものが閉じ込められている。',
    options: [
      {
        label: '掘り出す',
        stat: 'VIT',
        diff: 15,
        ok: '拳ほどの塊がひとつ。古物商が欲しがりそうだ。',
        fail: '崩れた破片で、腕を切った。',
        effect: (r) => {
          r.coins(35);
          return undefined;
        },
        failEffect: (r) => {
          r.heal(-5);
          return undefined;
        },
      },
      {
        label: '中の羽虫と、目を合わせる',
        stat: 'INT',
        diff: 15,
        ok: '虫の目の奥に、琥珀の色が見える。それは、あなたの目にも移った。',
        fail: '虫が瞬きをした、と思い込んだ。',
        effect: (r) => {
          r.grant('amber-eye');
          return undefined;
        },
        failEffect: (r) => {
          r.grant('belief');
          return undefined;
        },
      },
    ],
  },
  {
    id: 'voices',
    title: '内なる声たち',
    strata: [1, 2, 3],
    text: '暗い坑道で、頭の中の声が言い争いを始めた。「戻れ」「進め」「黙れ」。',
    options: [
      {
        label: '論理に従う',
        stat: 'INT',
        diff: 10,
        ok: '理屈が通った。観察の目が、少し休まる。',
        fail: '理屈は、途中で迷子になった。',
        effect: (r) => {
          r.xp('INT', 3);
          r.refill(1, ['look']);
          return undefined;
        },
        failEffect: (r) => {
          r.heal(0, -2);
          return undefined;
        },
      },
      {
        label: '本能に従う',
        stat: 'AGI',
        diff: 10,
        ok: '体が先に動いた。それで正しかった。',
        fail: '体が先に動いた。壁にぶつかった。',
        effect: (r) => {
          r.xp('AGI', 3);
          return undefined;
        },
        failEffect: (r) => {
          r.heal(-2);
          return undefined;
        },
      },
      {
        label: '全部、黙らせる',
        stat: 'WIL',
        diff: 15,
        ok: '静かになった。こんなに静かなのは、いつ以来だろう。',
        fail: '声は黙ったが、眠れなくなった。',
        effect: (r) => {
          r.xp('WIL', 3);
          r.heal(0, 3);
          return undefined;
        },
        failEffect: (r) => {
          r.grant('insomnia');
          return undefined;
        },
      },
    ],
  },
  {
    id: 'laundromat',
    title: '終夜営業のコインランドリー',
    strata: [1, 2],
    text: '乾燥機が一台だけ回っている。中身の持ち主は、どこにもいない。ベンチは温かい。',
    options: [
      {
        label: '眠る（2 時間）',
        ok: '乾燥機の音を聞きながら、少し眠った。',
        effect: (r) => {
          r.time(2);
          r.heal(10, 10);
          r.refill(1);
          return undefined;
        },
      },
      {
        label: '持ち主を待つ',
        stat: 'WIL',
        diff: 10,
        ok: '戻ってきた女は、礼にと小銭をくれた。誰かに似ていた。',
        fail: '誰も戻らない。乾燥機が止まった。',
        effect: (r) => {
          r.coins(15);
          r.heal(0, 3);
          return undefined;
        },
        failEffect: (r) => {
          r.time(1);
          return undefined;
        },
      },
      { label: '先を急ぐ', ok: '夜明けまで、あと何時間だろう。', effect: () => undefined },
    ],
  },
  {
    id: 'favor-due',
    title: '借りの取り立て',
    strata: [1, 2, 3],
    locked: true,
    text: '暗がりから、見覚えのある顔。「あのときの借り、覚えてるよな」',
    options: [
      {
        label: '金で返す（金 20）',
        needCoins: 20,
        ok: '金を受け取ると、相手は満足して去った。',
        effect: (r) => {
          r.coins(-20);
          r.flag('clear-debt');
          return undefined;
        },
      },
      {
        label: '体で返す（重い荷を運ぶ）',
        stat: 'VIT',
        diff: 10,
        ok: '一時間かかった。それで、貸し借りなし。',
        fail: '途中で荷を落とした。借りは、残ったまま。',
        effect: (r) => {
          r.time(1);
          r.flag('clear-debt');
          return undefined;
        },
        failEffect: (r) => {
          r.time(1);
          r.heal(-4);
          return undefined;
        },
      },
      {
        label: '踏み倒す',
        ok: '相手は何も言わずに去った。噂は、すぐに広まるだろう。',
        effect: (r) => {
          r.flag('clear-debt');
          r.flag('welsh');
          r.grant('guilt');
          return undefined;
        },
      },
    ],
  },
  {
    id: 'accident-site',
    title: '事故現場',
    strata: [3],
    locked: true,
    text: '製油所の裏。工場の臭い。ねじれたガードレール。あなたは、ここに来たことがある。',
    options: [
      {
        label: '思い出す',
        stat: 'WIL',
        diff: 10,
        ok: '運転席にいたのは、あなたではなかった。助手席から、あなたは彼女の横顔を見ていた。',
        fail: 'ブレーキの音が、頭の中で止まらない。',
        effect: (r) => {
          r.grant('truth');
          return undefined;
        },
        failEffect: (r) => {
          r.heal(0, -6);
          r.grant('fear');
          return undefined;
        },
      },
      {
        label: '目を背ける',
        ok: 'まだ、そのときではない。',
        effect: (r) => {
          r.heal(0, 2);
          return undefined;
        },
      },
    ],
  },
  {
    id: 'her-trail',
    title: '彼女の足取り',
    strata: [2, 3],
    locked: true,
    text: '夜警の証言、記録係のファイル、最後の客の手紙。三つが一本の線になった。線は、まっすぐ最下層へ伸びている。',
    options: [
      {
        label: '辿る',
        ok: '彼女は、ここを通った。あなたより、ずっと前に。',
        effect: (r) => {
          r.flag('her-trail');
          r.heal(99, 99);
          return undefined;
        },
      },
    ],
  },
  {
    id: 'confession',
    title: '告解',
    strata: [2, 3],
    locked: true,
    text: '崩れた礼拝堂。告解室の格子の向こうに、誰かが座っている。息子を亡くした男の声に似ている。',
    options: [
      {
        label: '暴いた墓のことを話す',
        stat: 'WIL',
        diff: 10,
        ok: '格子の向こうの人は、最後まで黙って聞いていた。少し、軽くなった。',
        fail: '言葉が出てこなかった。',
        effect: (r) => {
          r.remove('guilt');
          r.heal(0, 8);
          return '《罪悪感》を手放した。';
        },
        failEffect: (r) => {
          r.heal(0, -4);
          return undefined;
        },
      },
      { label: '黙って座っている', ok: '向こうの人も、黙っていた。', effect: () => undefined },
    ],
  },
];
