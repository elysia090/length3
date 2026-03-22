import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, type DecorationSet, type ViewUpdate, ViewPlugin } from '@codemirror/view';
import type { EditorView } from 'codemirror';

const fmKeyMark = Decoration.mark({ class: 'cm-fm-key' });
const fmValMark = Decoration.mark({ class: 'cm-fm-val' });
const fmDelimMark = Decoration.mark({ class: 'cm-fm-delim' });

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
 * CSS classes cm-fm-delim / cm-fm-key / cm-fm-val are defined in editor/index.astro.
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
