/**
 * 入口の段取り。同じセッションで一度入口を通ったら、次は一覧から始める
 * （戻るボタンで来たときと、アンカー付きで来たときはブラウザに任せる）。
 * ENTER は一覧へ降りる。動きを減らす設定なら跳ぶ。
 */
const KEY = 'l3-opening';

function remember() {
  try {
    sessionStorage.setItem(KEY, '1');
  } catch {
    // 保存できない環境では毎回入口から。
  }
}

export function mountOpening(doc: Document): void {
  const stage = doc.querySelector<HTMLElement>('[data-opening]');
  if (!stage) return;
  const enter = doc.querySelector<HTMLAnchorElement>('[data-opening-enter]');
  const target = () => doc.querySelector<HTMLElement>(enter?.getAttribute('href') ?? '#index');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (doc.documentElement.dataset.skipOpening !== undefined) {
    target()?.scrollIntoView({ block: 'start' });
  }

  enter?.addEventListener('click', (e) => {
    const el = target();
    if (!el) return;
    e.preventDefault();
    remember();
    el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  });

  // 入口を下へ抜けたら、見たことにする。
  let seen = false;
  new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) seen = true;
      else if (seen && entry.boundingClientRect.top < 0) remember();
    }
  }).observe(stage);
}
