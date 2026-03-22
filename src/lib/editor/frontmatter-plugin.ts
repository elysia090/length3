import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, type DecorationSet, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import type { EditorView } from 'codemirror';

/**
 * CSS class names injected by the frontmatter decoration plugin.
 * The corresponding styles live in src/styles/code.css — search for FM_CSS.
 */
export const FM_CSS = {
  delim: 'cm-fm-delim',
  key: 'cm-fm-key',
  val: 'cm-fm-val',
} as const;

const fmKeyMark = Decoration.mark({ class: FM_CSS.key });
const fmValMark = Decoration.mark({ class: FM_CSS.val });
const fmDelimMark = Decoration.mark({ class: FM_CSS.delim });

function buildFrontmatterDecos(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  // Need at least an opening and closing delimiter line.
  if (doc.lines < 2) return builder.finish();

  // Use the line API instead of doc.toString() so we never materialise the
  // full document string.  CodeMirror's B-tree makes each doc.line() O(log n).
  if (doc.line(1).text.trim() !== '---') return builder.finish();

  // Scan forward for the closing delimiter.
  let fmEndLineNum = -1;
  for (let i = 2; i <= doc.lines; i++) {
    if (doc.line(i).text.trim() === '---') {
      fmEndLineNum = i;
      break;
    }
  }
  if (fmEndLineNum === -1) return builder.finish();

  for (let i = 1; i <= fmEndLineNum; i++) {
    const line = doc.line(i);
    const lineText = line.text;

    if (lineText.trim() === '---') {
      builder.add(line.from, line.to, fmDelimMark);
    } else {
      const colonIdx = lineText.indexOf(':');
      if (colonIdx > 0) {
        builder.add(line.from, line.from + colonIdx, fmKeyMark);
        const valStart = colonIdx + 1;
        const valText = lineText.slice(valStart);
        if (valText.trim().length > 0) {
          const trimOffset = valText.length - valText.trimStart().length;
          builder.add(line.from + valStart + trimOffset, line.to, fmValMark);
        }
      }
    }
  }
  return builder.finish();
}

/**
 * ViewPlugin that decorates the YAML frontmatter block with distinct colours.
 * Class names are defined in FM_CSS above; styles are in src/styles/code.css.
 */
export const frontmatterPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildFrontmatterDecos(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildFrontmatterDecos(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
