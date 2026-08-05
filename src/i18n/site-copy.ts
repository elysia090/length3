import type { SiteLanguage } from './language';

export type { SiteLanguage };

export interface SiteCopy {
  about: string;
  blogSidebar: string;
  breadcrumb: string;
  close: string;
  codeCopied: string;
  contents: string;
  copyCodeAria: string;
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
  topicsShowLess: string;
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
    codeCopied: 'Copied',
    contents: 'Contents',
    copyCodeAria: 'Copy code to clipboard',
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
    topicsShowLess: 'Show less',
    total: 'total',
    updatedPrefix: 'upd.',
  },
  ja: {
    about: 'About',
    articles: 'Articles',
    blogSidebar: 'ブログのサイドバー',
    breadcrumb: 'パンくず',
    close: '閉じる',
    codeCopied: 'コピーしました',
    contents: '目次',
    copyCodeAria: 'コードをクリップボードにコピー',
    copyFailure: 'Could not copy the link. Copy the URL from the address bar.',
    copyFailureLabel: 'Failed',
    copyLink: 'Copy link',
    copyLinkAria: 'Copy link to clipboard',
    copySuccess: 'Link copied to clipboard.',
    copiedLabel: 'Copied!',
    home: 'Length³ ホーム',
    keyboardShortcutSlash: 'キーボードショートカット: スラッシュ',
    left: 'left',
    navigation: '主要ナビゲーション',
    read: 'read',
    readingProgress: '読書の進捗',
    readingProgressStats: '読書の進捗統計',
    share: 'Share',
    shareAria: 'Share article',
    shareFailure: 'Could not share the article. Try copying the URL instead.',
    shareSuccess: 'Share dialog completed.',
    skipToMainContent: '本文へ移動',
    tableOfContents: '目次',
    tags: 'タグ',
    topics: 'トピック',
    topicsShowLess: '閉じる',
    total: 'total',
    updatedPrefix: 'upd.',
  },
};

export function getSiteCopy(language: SiteLanguage | null | undefined): SiteCopy {
  if (language === 'ja') {
    return SITE_COPY_BY_LANGUAGE.ja;
  }

  return SITE_COPY_BY_LANGUAGE.en;
}

/** Label for the collapsed remainder of the topic list ("+18 more"). */
export function formatHiddenTopicsLabel(count: number, language: SiteLanguage | null | undefined) {
  return language === 'ja' ? `他 ${count} 件` : `+${count} more`;
}

export function formatCompactReadingTime(
  minutes: number,
  _language: SiteLanguage | null | undefined,
) {
  return `${minutes} min`;
}

export function formatArticleReadingTime(
  minutes: number,
  _language: SiteLanguage | null | undefined,
) {
  return `${minutes} min read`;
}

export function formatRemainingReadingTime(
  minutes: number,
  _language: SiteLanguage | null | undefined,
) {
  return minutes > 0 ? `~${minutes} min` : '< 1 min';
}
