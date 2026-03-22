import { HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { EditorView } from 'codemirror';

/**
 * Mirror of CSS design tokens from global.css.
 * CSS custom properties cannot be used inside CodeMirror JS theme strings;
 * keep these in sync with :root in global.css if any token changes.
 */
const AMBER = '#d4820a'; // --amber
const AMBER_LT = '#e8a030'; // --amber-lt
const EDITOR_BG = '#181511'; // --editor-bg
const EDITOR_INK = '#c8c4be'; // --editor-ink
const EDITOR_INK_2 = '#9a9690'; // --editor-ink-2
const EDITOR_SEP = '#3a3630'; // --editor-sep
const EDITOR_GUTTER_ACTIVE = '#8a8070'; // --editor-gutter-active
const EDITOR_COMMENT = '#3d3a34'; // --editor-comment
const EDITOR_HL_KEY = '#7a9ab8'; // --editor-hl-key
const EDITOR_HL_VAL = '#7ec49a'; // --editor-hl-val
const EDITOR_HL_FN = '#8bb8e8'; // --editor-hl-fn
// Semi-transparent overlays derived from AMBER / white:
const ACTIVE_LINE_BG = 'rgba(255,255,255,0.03)';
const SELECTION_BG = 'rgba(212,130,10,0.20)'; // AMBER @ 20%
const SELECTION_BG_FOCUSED = 'rgba(212,130,10,0.25)'; // AMBER @ 25%

/** CodeMirror visual theme — matches the Length³ editor spec §4. */
export const length3Theme = EditorView.theme(
  {
    '&': {
      backgroundColor: EDITOR_BG,
      color: EDITOR_INK,
    },
    '.cm-content': {
      caretColor: AMBER,
      lineHeight: '1.75',
      paddingTop: '24px',
      paddingBottom: '80px',
    },
    '.cm-cursor': { borderLeftColor: AMBER, borderLeftWidth: '2px' },
    '.cm-activeLine': { backgroundColor: ACTIVE_LINE_BG },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: EDITOR_GUTTER_ACTIVE },
    '.cm-gutters': {
      backgroundColor: EDITOR_BG,
      color: EDITOR_SEP,
      border: 'none',
      width: '48px',
    },
    '.cm-lineNumbers .cm-gutterElement': { paddingRight: '12px' },
    '.cm-selectionBackground': { backgroundColor: SELECTION_BG },
    '&.cm-focused .cm-selectionBackground': { backgroundColor: SELECTION_BG_FOCUSED },
    '.cm-line': { paddingLeft: '20px', paddingRight: '20px' },
  },
  { dark: true },
);

/** Syntax highlight rules — maps lezer tags to editor colours. */
export const length3Highlight = HighlightStyle.define([
  // Frontmatter delimiters (---)
  { tag: tags.processingInstruction, color: EDITOR_INK_2 },
  // YAML keys
  { tag: tags.attributeName, color: EDITOR_HL_KEY },
  { tag: tags.propertyName, color: EDITOR_HL_KEY },
  // YAML values / strings
  { tag: tags.string, color: EDITOR_HL_VAL },
  { tag: tags.number, color: EDITOR_HL_VAL },
  { tag: tags.bool, color: EDITOR_HL_VAL },
  // Markdown headings
  { tag: tags.heading1, color: AMBER_LT, fontWeight: '500' },
  { tag: tags.heading2, color: AMBER, fontWeight: '400' },
  { tag: tags.heading3, color: AMBER },
  { tag: tags.heading4, color: AMBER },
  // Code / keywords
  { tag: tags.keyword, color: AMBER },
  { tag: tags.operator, color: AMBER },
  { tag: tags.monospace, color: AMBER_LT },
  // Function names
  { tag: tags.function(tags.name), color: EDITOR_HL_FN },
  { tag: tags.function(tags.variableName), color: EDITOR_HL_FN },
  // Comments
  { tag: tags.comment, color: EDITOR_COMMENT, fontStyle: 'italic' },
  // Links / URLs
  { tag: tags.url, color: EDITOR_HL_VAL, textDecoration: 'underline' },
  { tag: tags.link, color: EDITOR_HL_KEY },
  // Emphasis
  { tag: tags.emphasis, fontStyle: 'italic', color: EDITOR_INK },
  { tag: tags.strong, fontWeight: 'bold', color: EDITOR_INK },
  // Default fallback
  { tag: tags.name, color: EDITOR_INK },
  { tag: tags.variableName, color: EDITOR_INK },
  { tag: tags.content, color: EDITOR_INK },
  { tag: tags.atom, color: EDITOR_HL_VAL },
  { tag: tags.meta, color: EDITOR_INK_2 },
]);
