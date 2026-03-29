import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration } from 'astro';
import { JSDOM } from 'jsdom';
import { createIndex, type PagefindServiceConfig } from 'pagefind';

const SEARCH_INDEX_LANGUAGE = 'en' as const;
const HTML_EXTENSION = '.html';
const MARKDOWN_EXTENSION_PATTERN = /\.mdx?$/i;
const PAGEFIND_ROUTE_PREFIX = '/pagefind/';
const BLOG_CONTENT_DIRECTORY = path.join('src', 'content', 'blog');
const JAPANESE_SCRIPT_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const WORDLIKE_PATTERN = /[\p{Letter}\p{Number}]/u;
const HTML_LANG_ATTRIBUTE_PATTERN = /<html\b[^>]*\blang\s*=\s*["']([^"']+)["']/iu;
const SKIP_SEGMENT_TAGS = new Set<string>(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);
const SEGMENTER = new Intl.Segmenter('ja', { granularity: 'word' });
const MIME_TYPES = new Map<string, string>([
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.wasm', 'application/wasm'],
]);

interface SegmentedPagefindOptions {
  indexConfig?: PagefindServiceConfig;
}

interface BuiltPage {
  pathname: string;
}

interface IndexablePage {
  html: string;
  url: string;
}

interface ErrorLogger {
  error(message: string): void;
}

export default function segmentedPagefind({
  indexConfig,
}: SegmentedPagefindOptions = {}): AstroIntegration {
  let clientDir: string | undefined;
  let projectRoot = process.cwd();

  return {
    name: 'segmented-pagefind',
    hooks: {
      'astro:config:setup': ({ config, logger }) => {
        if (config.output === 'server') {
          logger.warn(
            'Output type `server` does not produce static *.html pages in its output and thus will not work with segmented-pagefind integration.',
          );
        }

        projectRoot = fileURLToPath(config.root);
        if (config.adapter) {
          clientDir = fileURLToPath(config.build.client);
        }
      },
      'astro:server:setup': ({ server }) => {
        const outDir = clientDir ?? path.join(server.config.root, server.config.build.outDir);
        const pagefindDir = path.join(outDir, 'pagefind');

        server.middlewares.use(async (req, res, next) => {
          if (!req.url?.startsWith(PAGEFIND_ROUTE_PREFIX)) {
            next();
            return;
          }

          const assetPath = resolvePagefindAssetPath(pagefindDir, req.url);
          if (!assetPath) {
            next();
            return;
          }

          try {
            const stat = await fs.stat(assetPath);
            if (!stat.isFile()) {
              next();
              return;
            }

            const body = await fs.readFile(assetPath);
            res.statusCode = 200;
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Content-Type', getContentType(assetPath));
            res.setHeader('ETag', `W/"${stat.size}-${Math.trunc(stat.mtimeMs)}"`);
            res.end(body);
          } catch (error: unknown) {
            if (isMissingFileError(error)) {
              next();
              return;
            }

            next(error);
          }
        });
      },
      'astro:build:done': async ({ dir, logger, pages }) => {
        const outDir = fileURLToPath(dir);
        const pagefindDir = path.join(outDir, 'pagefind');
        const indexablePages = await collectIndexablePages(outDir, projectRoot, pages);

        const { forceLanguage: _ignoredForceLanguage, ...restIndexConfig } = indexConfig ?? {};
        const { index, errors: createErrors } = await createIndex({
          ...restIndexConfig,
          forceLanguage: SEARCH_INDEX_LANGUAGE,
        });

        if (!index) {
          logger.error('Pagefind failed to create index');
          logErrorMessages(logger, createErrors);
          return;
        }

        if (indexablePages.length === 0) {
          logger.warn('Pagefind found no indexable article pages.');
          return;
        }

        for (const page of indexablePages) {
          const { errors: addErrors } = await index.addHTMLFile({
            url: page.url,
            content: buildSyntheticSearchHtml(page.html),
          });

          if (addErrors.length > 0) {
            logger.error(`Pagefind failed to index ${page.url}`);
            logErrorMessages(logger, addErrors);
            return;
          }
        }

        logger.info(`Pagefind indexed ${indexablePages.length} pages`);

        const { outputPath, errors: writeErrors } = await index.writeFiles({
          outputPath: pagefindDir,
        });

        if (writeErrors.length > 0) {
          logger.error('Pagefind failed to write index');
          logErrorMessages(logger, writeErrors);
          return;
        }

        logger.info(`Pagefind wrote index to ${outputPath}`);
      },
    },
  };
}

export async function collectIndexablePages(
  outDir: string,
  projectRoot: string,
  builtPages: BuiltPage[],
): Promise<IndexablePage[]> {
  const indexablePathnames = await collectIndexablePathnames(projectRoot, builtPages);

  return Promise.all(
    indexablePathnames.map(async (pathname) => ({
      html: await fs.readFile(toOutputHtmlPath(outDir, pathname), 'utf8'),
      url: pathname,
    })),
  );
}

export async function collectIndexablePathnames(
  projectRoot: string,
  builtPages: BuiltPage[],
): Promise<string[]> {
  const contentSlugs = await collectContentSlugs(path.join(projectRoot, BLOG_CONTENT_DIRECTORY));
  const articlePathnames = new Set([...contentSlugs].map((slug) => normalizePathname(`/${slug}`)));

  return builtPages
    .map((page) => normalizePathname(page.pathname))
    .filter((pathname) => articlePathnames.has(pathname));
}

export async function collectContentSlugs(contentDir: string): Promise<Set<string>> {
  const contentFiles = await collectContentFiles(contentDir);
  return new Set(
    contentFiles.map((filePath) => toContentSlug(path.relative(contentDir, filePath))),
  );
}

export async function collectContentFiles(contentDir: string): Promise<string[]> {
  const entries = await fs.readdir(contentDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(contentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectContentFiles(fullPath)));
      continue;
    }

    if (entry.isFile() && MARKDOWN_EXTENSION_PATTERN.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

export function buildSyntheticSearchHtml(html: string): string {
  if (!isJapaneseLanguage(readDocumentLanguage(html))) {
    return html;
  }

  const dom = new JSDOM(html);
  const { document, NodeFilter } = dom.window;
  const pagefindBody = document.querySelector('[data-pagefind-body]');

  if (!pagefindBody) {
    return html;
  }

  document.documentElement.lang = SEARCH_INDEX_LANGUAGE;
  if (document.title) {
    document.title = segmentJapaneseSearchText(document.title);
  }

  const walker = document.createTreeWalker(pagefindBody, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node) {
      const parentElement = node.parentElement;

      if (!parentElement) {
        return NodeFilter.FILTER_REJECT;
      }

      if (parentElement.closest('[data-pagefind-ignore]')) {
        return NodeFilter.FILTER_REJECT;
      }

      if (SKIP_SEGMENT_TAGS.has(parentElement.tagName)) {
        return NodeFilter.FILTER_REJECT;
      }

      if (!node.textContent?.trim()) {
        return NodeFilter.FILTER_REJECT;
      }

      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const textNodes: Node[] = [];
  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    textNodes.push(current);
  }

  for (const textNode of textNodes) {
    const value = textNode.textContent ?? '';
    if (!JAPANESE_SCRIPT_PATTERN.test(value)) {
      continue;
    }

    textNode.textContent = segmentJapaneseSearchText(value);
  }

  return dom.serialize();
}

export function segmentJapaneseSearchText(value: string): string {
  if (!JAPANESE_SCRIPT_PATTERN.test(value)) {
    return value;
  }

  let result = '';
  let lastWasSearchable = false;

  for (const segment of SEGMENTER.segment(value)) {
    const text = segment.segment;
    if (!text) {
      continue;
    }

    const isSearchable =
      segment.isWordLike || JAPANESE_SCRIPT_PATTERN.test(text) || WORDLIKE_PATTERN.test(text);

    if (isSearchable && lastWasSearchable && !result.endsWith(' ')) {
      result += ' ';
    }

    result += text;
    lastWasSearchable = isSearchable;
  }

  return result;
}

export function isJapaneseLanguage(language: string | null | undefined): boolean {
  const normalized = language?.trim().toLowerCase();
  return normalized === 'ja' || normalized?.startsWith('ja-') === true;
}

export function readDocumentLanguage(html: string): string | undefined {
  const match = HTML_LANG_ATTRIBUTE_PATTERN.exec(html);
  return match?.[1];
}

export function resolvePagefindAssetPath(pagefindDir: string, requestUrl: string): string | null {
  const pathname = new URL(requestUrl, 'http://localhost').pathname;
  if (!pathname.startsWith(PAGEFIND_ROUTE_PREFIX)) {
    return null;
  }

  const relativePath = pathname.slice(PAGEFIND_ROUTE_PREFIX.length);
  if (!relativePath) {
    return null;
  }

  const resolvedPath = path.resolve(pagefindDir, relativePath);
  const normalizedRoot = `${pagefindDir}${path.sep}`;
  if (resolvedPath === pagefindDir || !resolvedPath.startsWith(normalizedRoot)) {
    return null;
  }

  return resolvedPath;
}

export function getContentType(filePath: string): string {
  return MIME_TYPES.get(path.extname(filePath).toLowerCase()) ?? 'application/octet-stream';
}

export function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function logErrorMessages(logger: ErrorLogger, errors: string[]): void {
  for (const error of errors) {
    logger.error(error);
  }
}

export function normalizePathname(pathname: string): string {
  if (!pathname) {
    return '/';
  }

  const withLeadingSlash = pathname.startsWith('/') ? pathname : `/${pathname}`;
  if (withLeadingSlash === '/') {
    return withLeadingSlash;
  }

  return withLeadingSlash.endsWith('/') ? withLeadingSlash.slice(0, -1) : withLeadingSlash;
}

export function toContentSlug(relativePath: string): string {
  return relativePath
    .replaceAll(path.sep, '/')
    .replace(MARKDOWN_EXTENSION_PATTERN, '')
    .toLowerCase();
}

export function toOutputHtmlPath(outDir: string, pathname: string): string {
  const normalizedPathname = normalizePathname(pathname);
  if (normalizedPathname === '/') {
    return path.join(outDir, 'index.html');
  }

  return path.join(outDir, `${normalizedPathname.slice(1)}${HTML_EXTENSION}`);
}

export function toPagefindUrl(relativePath: string): string {
  const normalizedPath = relativePath.replaceAll(path.sep, '/');

  if (normalizedPath === 'index.html') {
    return '/';
  }

  if (normalizedPath.endsWith('/index.html')) {
    return `/${normalizedPath.slice(0, -'/index.html'.length)}`;
  }

  return `/${normalizedPath.slice(0, -HTML_EXTENSION.length)}`;
}
