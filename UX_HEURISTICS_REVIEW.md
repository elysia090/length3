# Nielsen Norman Group — 10 Usability Heuristics レビュー

**対象プロジェクト:** Length³ (Astro 6 技術ブログ)
**レビュー日:** 2026-03-22
**対象バージョン:** master ブランチ現在

---

## H1: Visibility of System Status（システム状態の可視性）

### 合格 ✅

| 要素 | 実装 |
|------|------|
| 読書進捗バー | `role="progressbar"` + amber 2px 固定バー (`ArticleActions.astro`) |
| 読書統計 | % 読了・残り時間・合計時間をリアルタイム更新（`aria-live="polite"`） |
| TOC アクティブ項目 | IntersectionObserver で現在のセクションを amber 強調 |
| Publish フィードバック | "Publish →" → "Published!" → 1500ms 後に復元 |
| Copy link フィードバック | "Copy link" → "Copied!" → 1500ms 後に復元 |
| エディタ ステータスバー | `Ln X · Col Y` · 文字数 · `astro check: 0 errors` |

### 問題点 ⚠️

**[P2] Pagefind 初期化中のロード状態がない**
- 検索モーダルを開いた直後、Pagefind の JS を動的 `import()` する間、結果エリアは空白のまま。
- スピナーや "読み込み中…" テキストがなく、ユーザーはアプリが応答しているかわからない。
- `Sidebar.astro:58` の `initSearch()` で `initialized = false` → `true` に切り替わる間。

```diff
// Sidebar.astro — initSearch() 内
+const results = document.getElementById('pagefind-results');
+if (results) results.innerHTML = '<p class="search-loading">読み込み中…</p>';
 const { PagefindUI } = await import(/* @vite-ignore */ pagefindSrc);
```

**[P3] エディタの status bar 情報は静的ハードコード**
- `"Prettier ✓"` / `"Biome ✓"` / `"astro check: 0 errors"` は実際のリンターと連動しておらず、常に成功を表示する（`editor/index.astro:73–78`）。
- 実際にエラーがあっても表示が変わらず、誤った安心感を与える。

---

## H2: Match Between System and the Real World（現実との対応）

### 合格 ✅

- 自然言語: "Share", "Copy link", "Discard", "Publish", "Search articles..."
- 日付フォーマット: ロケール対応 (`formatDate` で lang 切替)
- エディタ: VSCode 風のトップバー・ステータスバーで既存メンタルモデルと一致

### 問題点 ⚠️

**[P2] 検索アイコンに "Q" を使用している**
- `Sidebar.astro:16` の `<span class="search-icon">Q</span>` は非標準。
- ユーザーが期待する虫眼鏡アイコン (🔍 or SVG) の代わりに "Q" が表示されており、検索機能であることが直感的に伝わりにくい。
- 特にスクリーンリーダー非使用者・初回訪問者にとって発見しにくい。

**[P3] ナビゲーションリンクの括弧表記 `(Articles)` `(Tags)` `(About)`**
- `Header.astro:11–13`。括弧はウェブの慣習にない表記で、リンクかどうかの識別が困難。
- デザイン上の選択ではあるが、メタファー的な意味が不明確。

**[P3] ArticleActions のアイコン代替として "—" と "×" を使用**
- `ArticleActions.astro:27,32`。ダッシュと "×" はそれぞれ "Copy link" と "Share" のアイコン代わりだが、その対応が直感的でない。

---

## H3: User Control and Freedom（ユーザーの制御と自由）

### 合格 ✅

| 機能 | 実装 |
|------|------|
| 未保存変更の警告 | `beforeunload` イベント (`editor/index.astro:99`) |
| 破棄確認ダイアログ | `confirm('Discard all changes?')` (`editor/index.astro:105`) |
| 検索モーダルを閉じる | Escape キー (native `<dialog>`) + backdrop クリック + esc ボタン |
| 滑らかなスクロール | TOC リンクは `scrollIntoView({ behavior: 'smooth' })` |

### 問題点 ⚠️

**[P2] エディタの Publish ボタンに確認がない**
- `editor/index.astro:113–121`。Publish をクリックすると即座にフィードバックが表示されるが、確認なしに "公開" されたと見なされる。
- `docChanged = false` がセットされるため `beforeunload` 警告も消える。実際のサーバー送信は未実装だが、ユーザーは公開完了と誤解する可能性がある。

**[P3] TOC クリック後に URL が変わるが「戻る」で位置が失われる**
- `TableOfContents.astro:141`: `history.pushState(null, '', href)` でハッシュを更新するが、`scrollRestoration` の制御がなく、ブラウザバック時の挙動が一貫しない場合がある。

---

## H4: Consistency and Standards（一貫性と標準）

### 合格 ✅

- Amber アクセントカラーが全コンポーネントで一貫使用
- モノスペースフォントをメタ情報に統一
- フォーカス輪郭 (`2px solid var(--amber)`) がサイト全体で統一

### 問題点 ⚠️

**[P1] アクティブページのナビゲーションリンクに `aria-current="page"` がない**
- `Header.astro:11–13`。現在のページがどのナビアイテムかを示す属性がない。
- スクリーンリーダーユーザーが現在地を把握できず、WCAG 2.4.8 "Location" に抵触する可能性。

```diff
// Header.astro — Astro.url.pathname を使用して動的に付与
-<a href="/">(Articles)</a>
+<a href="/" aria-current={Astro.url.pathname === '/' ? 'page' : undefined}>(Articles)</a>
-<a href="/tags">(Tags)</a>
+<a href="/tags" aria-current={Astro.url.pathname.startsWith('/tags') ? 'page' : undefined}>(Tags)</a>
```

**[P2] `cursor: default` が記事タイトルリンクに設定されている**
- `ArticleCard.astro:102`: `cursor: default` により、ホバー前はリンクであることがわからない。
- ウェブ標準ではリンクにはポインターカーソルを表示するのが慣習。デザイン上の意図とユーザー期待の乖離。

**[P3] エディタのモバイルタブは `tabpanel` の `hidden` 属性でなく CSS `display: none` で制御**
- `editor/index.astro:446–457`。`role="tabpanel"` を持つ要素に `hidden` 属性を付与する WAI-ARIA の推奨パターンと異なり、CSS クラスで表示制御している。機能的には動くが標準準拠でない。

---

## H5: Error Prevention（エラーの予防）

### 合格 ✅

| 機能 | 実装 |
|------|------|
| 未保存変更の離脱警告 | `editor/index.astro:99` |
| Discard 確認 | `editor/index.astro:104–109` |
| クリップボード Share フォールバック | `navigator.share` 非対応時は clipboard API に fallback |
| 検索インデックス未ビルド時のメッセージ | Pagefind 読込失敗時にユーザー向けメッセージ表示 |
| コンテンツスキーマ検証 | Zod で frontmatter を厳密にバリデーション |

### 問題点 ⚠️

**[P2] 検索フォームに `minlength` や空文字送信防止がない**
- `Sidebar.astro:29`: `<input type="search">` に最小文字数制限なし。空文字のまま Pagefind を呼び出すと大量の結果を返す可能性（パフォーマンスとノイズの観点で問題）。

---

## H6: Recognition Rather Than Recall（記憶でなく認識）

### 合格 ✅

- 検索モーダルフッターのキーボードヒント: `↑↓ navigate` / `↵ open` / `esc close`
- TOC がスクロール位置と連動してアクティブセクションを示す
- パンくずリストで現在地を表示

### 問題点 ⚠️

**[P1] "/" ショートカットがサイト上で表示されていない**
- `Sidebar.astro:97–108`: "/" キーで検索が開くが、検索ボタン (`search-trigger`) にそのヒントがない。
- ユーザーはモーダルを一度開いた後にのみヒントを発見できる。
- 検索トリガーボタン横に小さなキーボードバッジ (`/`) を追加すると発見性が大幅向上。

```diff
// Sidebar.astro — 検索ボタン内
 <span class="search-placeholder">Search articles…</span>
+<kbd class="search-kbd">/</kbd>
```

**[P2] ArticleActions ボタンにツールチップがない**
- "—" (Copy link) と "×" (Share) のアイコン代替は、ラベルを読まないと機能がわからない。
- `aria-label` は設定済みだが、視覚的なヒントとして hover 時のツールチップがあると認識しやすい。

**[P3] エディタの "Preview" ボタンの役割が不明確**
- `editor/index.astro:19`: "Preview" ボタンがクリックされた際の動作が実装されていない（クリックハンドラなし）。
- ユーザーはボタンが何をするのか、なぜ何も起きないのかわからない。

---

## H7: Flexibility and Efficiency of Use（柔軟性と効率性）

### 合格 ✅

| 機能 | 実装 |
|------|------|
| 検索キーボードショートカット | "/" キー |
| 検索結果キーボードナビ | ↑↓ キー |
| モバイルタブ ArrowKey ナビ | APG Tabs パターン準拠 |
| タッチターゲット | `min-height: 44px` (WCAG 2.5.8) |

### 問題点 ⚠️

**[P2] エディタのペイン比率が固定 50/50 で調整不可**
- `editor/index.astro:319`: `grid-template-columns: 1fr 1fr` — ドラッグでサイズ変更できない。
- 長文執筆時はエディタを広く、プレビュー確認時はプレビューを広くしたいユーザーニーズがある。

**[P3] 検索結果から記事を開いた後、検索に戻る手段がない**
- 検索→記事→バックボタンで検索状態（入力テキスト・結果）がリセットされる。

---

## H8: Aesthetic and Minimalist Design（美的かつミニマルなデザイン）

### 合格 ✅

- 限定的なカラーパレット（amber + ink 系のみ）
- 意図的に空の右カラム（ウィジェット・広告なし）
- サイドバーは検索のみ
- プログレスバーは 2px の薄さで干渉を最小化

### 問題点 ⚠️

**[P2] ステータスバーのフォントサイズ 0.6875rem（11px）は小さすぎる可能性**
- `editor/index.astro:384`: 11px はコメント内に "bumped from 0.65rem" とあるが、まだ WCAG AA の通常テキスト基準（14px 以上推奨）を下回る。
- ただしステータスバーは補助的情報なので P3 レベル。

**[P3] エディタ "Preview" ボタンは機能しないデッドUI**
- 動作しないボタンがある（後述 H6 と同様）。ミニマルデザインの観点から、未実装機能のボタンは非表示にすべき。

---

## H9: Help Users Recognize, Diagnose, and Recover from Errors（エラーの認識・診断・回復）

### 合格 ✅

- 検索インデックス未存在時: "Search is only available in the built site." メッセージ (`Sidebar.astro:66`)

### 問題点 ⚠️

**[P1] クリップボード操作失敗がユーザーに伝わらない**
- `ArticleActions.astro:73`: `clipboard.writeText` が失敗した場合、`console.warn` のみでユーザーへのフィードバックがない。
- HTTPS でない環境や古いブラウザではクリップボード API が失敗することがある。

```diff
// ArticleActions.astro — catch 内
-.catch((err) => console.warn('[copy-link] clipboard write failed:', err));
+.catch((err) => {
+  console.warn('[copy-link] clipboard write failed:', err);
+  flash('#copy-link-btn .action-label', 'Failed', 'Copy link');
+});
```

**[P1] Share 失敗も同様にサイレント**
- `ArticleActions.astro:81–90`: `navigator.share` 失敗（AbortError 以外）および clipboard fallback 失敗でユーザー通知なし。

**[P2] 404 ページが確認できない**
- プロジェクト内に `404.astro` が存在しないため、存在しない URL へのアクセス時の体験が Cloudflare のデフォルト画面になる可能性がある。ブランドの一貫性が失われる。

---

## H10: Help and Documentation（ヘルプとドキュメント）

### 合格 ✅

- 検索モーダルのフッターにキーボードショートカット一覧
- エディタのステータスバーで技術情報を常時表示

### 問題点 ⚠️

**[P2] "/" ショートカットのアフォーダンスがない（H6 と重複）**
- 検索機能の入口（サイドバーのボタン）に "/" ショートカットのヒントがなく、ドキュメントもない。

**[P3] エディタに MDX の書き方ガイドがない**
- 初めて `editor/` を使うユーザーへの説明が `Start writing MDX…` プレースホルダーのみ。
- frontmatter フィールドの意味（`tags`, `draft` など）が不明。

**[P3] About ページが存在しない**
- `Header.astro:13` に `(About)` リンクがあるが、`/about` ルートが存在しない（404）。
- ナビゲーションに存在するリンクが機能しないことは、H9 (エラー回復) にも抵触。

---

## 優先度サマリー

| 優先度 | 件数 | 内容 |
|--------|------|------|
| P1 (重大) | 3 件 | `aria-current` 欠如、クリップボードエラー通知なし × 2 |
| P2 (重要) | 9 件 | "/" ショートカット非表示、検索 "Q" アイコン、Pagefind ローディング状態、cursor:default 、Publishボタン確認なし、ステータスバー静的ハードコード、エディタペイン固定比率、空文字検索防止、404ページなし |
| P3 (改善) | 8 件 | 括弧ナビ表記、アイコン代替、tabpanel 属性、TOC pushState、Preview ボタン未実装、フォントサイズ、MDX ガイド、About ページ |

---

## 特筆すべき良い実装

1. **アクセシビリティへの配慮が全体的に高い** — WCAG 2.5.8 タッチターゲット、`aria-live`、native `<dialog>` による focus trap、`prefers-reduced-motion` 対応
2. **読書体験の設計** — 進捗バー + 残り時間 + TOC アクティブ追跡の組み合わせが読者の没入感を高める
3. **フォント戦略** — Fraunces (表示) / Noto Sans JP (本文) / JetBrains Mono (UI) の役割分担が明確で、タイポグラフィ階層が機能している
4. **エラー予防の徹底** — 未保存変更の二重確認 (beforeunload + confirm) は適切
5. **CJK 対応** — `text-autospace`, `font-feature-settings: 'palt'`, ruby テキスト対応など日本語タイポグラフィへの深い配慮
