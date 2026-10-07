/**
 * ブラウザで動くコードのための入口。index.ts は .astro の部品も出すので、
 * クライアントのスクリプトから読むと部品までバンドルに引き込む。
 */
export { type ArchiveField, mountArchiveField } from './field';
export type { ArchiveSource } from './layout';
