import { EditorView } from 'codemirror';
import { HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';

/** CodeMirror visual theme — matches the Length³ editor spec §4. */
export const length3Theme = EditorView.theme(
  {
    '&': {
      backgroundColor: '#181511' /* --editor-bg */,
      color: '#c8c4be',
    },
    '.cm-content': {
      caretColor: '#d4820a',
      lineHeight: '1.75',
      paddingTop: '24px',
      paddingBottom: '80px',
    },
    '.cm-cursor': { borderLeftColor: '#d4820a', borderLeftWidth: '2px' },
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
  { tag: tags.heading1, color: '#e8a030', fontWeight: '500' },
  { tag: tags.heading2, color: '#d4820a', fontWeight: '400' },
  { tag: tags.heading3, color: '#d4820a' },
  { tag: tags.heading4, color: '#d4820a' },
  // Code / keywords
  { tag: tags.keyword, color: '#d4820a' },
  { tag: tags.operator, color: '#d4820a' },
  { tag: tags.monospace, color: '#e8a030' },
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
