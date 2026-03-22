import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, type DecorationSet, type ViewUpdate, ViewPlugin } from '@codemirror/view';
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
  const text = doc.toString();
  if (!text.startsWith('---')) return builder.finish();
  const endIdx = text.indexOf('\n---', 3);
  if (endIdx === -1) return builder.finish();
  const fmEnd = endIdx + 4; // include closing ---\n

  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    if (line.from >= fmEnd) break;
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
