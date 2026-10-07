/**
 * トップの一覧。1 ビットの舞台（標本の立方体）、台帳の行、体積の立方体、
 * 巻末索引のようなトピック。行と標本は互いに照らし合う。標本の舞台は
 * 検索にも貸し出す（ブラウザ側の入口 client.ts の mountArchiveField）。
 */
export { default as ArchiveStage } from './ArchiveStage.astro';
export { default as ArticleCard } from './ArticleCard.astro';
export { default as ArticleList } from './ArticleList.astro';
export type { ArchiveSource } from './layout';
export { default as TopicList } from './TopicList.astro';
