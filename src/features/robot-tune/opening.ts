/**
 * 入口の段取り。同じセッションで一度入口を下へ抜けたら、次は一覧から
 * 始める（戻るボタンで来たときと、アンカー付きで来たときはブラウザに
 * 任せる）。入口から一覧へは、ふつうにスクロールして降りる。
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
  const target = doc.querySelector<HTMLElement>(stage.dataset.skipTo ?? '#index');

  if (doc.documentElement.dataset.skipOpening !== undefined) {
    target?.scrollIntoView({ block: 'start' });
  }

  // 入口を下へ抜けたら、見たことにする。
  let seen = false;
  new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) seen = true;
      else if (seen && entry.boundingClientRect.top < 0) remember();
    }
  }).observe(stage);
}
