import { HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { EditorView } from 'codemirror';

/** Amber design token — mirrors --amber: #d4820a in global.css.
 *  CSS variables can't be used inside EditorView.theme() JS strings. */
const AMBER = '#d4820a';
const AMBER_LT = '#e8a030'; /* --amber-lt */

/** CodeMirror visual theme — matches the Length³ editor spec §4. */
export const length3Theme = EditorView.theme(
  {
    '&': {
      backgroundColor: '#181511' /* --editor-bg */,
      color: '#c8c4be',
    },
    '.cm-content': {
      caretColor: AMBER,
      lineHeight: '1.75',
      paddingTop: '24px',
      paddingBottom: '80px',
    },
    '.cm-cursor': { borderLeftColor: AMBER, borderLeftWidth: '2px' },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.03)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#8a8070' },
    '.cm-gutters': {
      backgroundColor: '#181511',
      color: '#3a3630',
      border: 'none',
      width: '48px',
    },
    '.cm-lineNumbers .cm-gutterElement': { paddingRight: '12px' },
    '.cm-selectionBackground': { backgroundColor: 'rgba(212,130,10,0.2)' },
    '&.cm-focused .cm-selectionBackground': { backgroundColor: 'rgba(212,130,10,0.25)' },
    '.cm-line': { paddingLeft: '20px', paddingRight: '20px' },
  },
  { dark: true },
);

/** Syntax highlight rules — maps lezer tags to editor colours. */
export const length3Highlight = HighlightStyle.define([
  // Frontmatter delimiters (---)
  { tag: tags.processingInstruction, color: '#9a9690' },
  // YAML keys
  { tag: tags.attributeName, color: '#7a9ab8' },
  { tag: tags.propertyName, color: '#7a9ab8' },
  // YAML values / strings
  { tag: tags.string, color: '#7ec49a' },
  { tag: tags.number, color: '#7ec49a' },
  { tag: tags.bool, color: '#7ec49a' },
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
  { tag: tags.function(tags.name), color: '#8bb8e8' },
  { tag: tags.function(tags.variableName), color: '#8bb8e8' },
  // Comments
  { tag: tags.comment, color: '#3d3a34', fontStyle: 'italic' },
  // Links / URLs
  { tag: tags.url, color: '#7ec49a', textDecoration: 'underline' },
  { tag: tags.link, color: '#7a9ab8' },
  // Emphasis
  { tag: tags.emphasis, fontStyle: 'italic', color: '#c8c4be' },
  { tag: tags.strong, fontWeight: 'bold', color: '#c8c4be' },
  // Default fallback
  { tag: tags.name, color: '#c8c4be' },
  { tag: tags.variableName, color: '#c8c4be' },
  { tag: tags.content, color: '#c8c4be' },
  { tag: tags.atom, color: '#7ec49a' },
  { tag: tags.meta, color: '#9a9690' },
]);
