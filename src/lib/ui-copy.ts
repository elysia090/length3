export type SiteLanguage = 'en' | 'ja';

export interface SiteCopy {
  about: string;
  blogSidebar: string;
  breadcrumb: string;
  close: string;
  contents: string;
  copyFailure: string;
  copyFailureLabel: string;
  copyLink: string;
  copyLinkAria: string;
  copySuccess: string;
  copiedLabel: string;
  home: string;
  keyboardShortcutSlash: string;
  left: string;
  navigation: string;
  read: string;
  readingProgress: string;
  readingProgressStats: string;
  share: string;
  shareAria: string;
  shareFailure: string;
  shareSuccess: string;
  skipToMainContent: string;
  tableOfContents: string;
  tags: string;
  topics: string;
  total: string;
  updatedPrefix: string;
  articles: string;
}

const SITE_COPY_BY_LANGUAGE: Record<SiteLanguage, SiteCopy> = {
  en: {
    about: 'About',
    articles: 'Articles',
    blogSidebar: 'Blog sidebar',
    breadcrumb: 'Breadcrumb',
    close: 'Close',
    contents: 'Contents',
    copyFailure: 'Could not copy the link. Copy the URL from the address bar.',
    copyFailureLabel: 'Failed',
    copyLink: 'Copy link',
    copyLinkAria: 'Copy link to clipboard',
    copySuccess: 'Link copied to clipboard.',
    copiedLabel: 'Copied!',
    home: 'Length³ home',
    keyboardShortcutSlash: 'keyboard shortcut: slash',
    left: 'left',
    navigation: 'primary',
    read: 'read',
    readingProgress: 'Reading progress',
    readingProgressStats: 'Reading progress stats',
    share: 'Share',
    shareAria: 'Share article',
    shareFailure: 'Could not share the article. Try copying the URL instead.',
    shareSuccess: 'Share dialog completed.',
    skipToMainContent: 'Skip to main content',
    tableOfContents: 'Table of Contents',
    tags: 'Tags',
    topics: 'Topics',
    total: 'total',
    updatedPrefix: 'upd.',
  },
  ja: {
    about: '概要',
    articles: '記事',
    blogSidebar: 'ブログのサイドバー',
    breadcrumb: 'パンくず',
    close: '閉じる',
    contents: '目次',
    copyFailure: 'リンクをコピーできませんでした。アドレスバーの URL をコピーしてください。',
    copyFailureLabel: '失敗',
    copyLink: 'リンクをコピー',
    copyLinkAria: 'リンクをクリップボードにコピー',
    copySuccess: 'リンクをクリップボードにコピーしました。',
    copiedLabel: 'コピー済み',
    home: 'Length³ ホーム',
    keyboardShortcutSlash: 'キーボードショートカット: スラッシュ',
    left: '残り',
    navigation: '主要ナビゲーション',
    read: '読了',
    readingProgress: '読書の進捗',
    readingProgressStats: '読書の進捗統計',
    share: '共有',
    shareAria: '記事を共有',
    shareFailure: '記事を共有できませんでした。代わりにリンクをコピーしてください。',
    shareSuccess: '共有ダイアログを完了しました。',
    skipToMainContent: '本文へ移動',
    tableOfContents: '目次',
    tags: 'タグ',
    topics: 'トピック',
    total: '全体',
    updatedPrefix: '更新',
  },
};

export function getSiteCopy(language: SiteLanguage | null | undefined): SiteCopy {
  if (language === 'ja') {
    return SITE_COPY_BY_LANGUAGE.ja;
  }

  return SITE_COPY_BY_LANGUAGE.en;
}

export function formatCompactReadingTime(
  minutes: number,
  language: SiteLanguage | null | undefined,
) {
  return language === 'ja' ? `${minutes}分` : `${minutes} min`;
}

export function formatArticleReadingTime(
  minutes: number,
  language: SiteLanguage | null | undefined,
) {
  return language === 'ja' ? `${minutes}分で読める` : `${minutes} min read`;
}

export function formatRemainingReadingTime(
  minutes: number,
  language: SiteLanguage | null | undefined,
) {
  if (language === 'ja') {
    return minutes > 0 ? `約${minutes}分` : '1分未満';
  }

  return minutes > 0 ? `~${minutes} min` : '< 1 min';
}
