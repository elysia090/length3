/** Estimates reading time in minutes, accounting for CJK character density. */
export function estimateReadingTime(text: string): number {
  const cjkChars = (text.match(/[\u3000-\u9FFF\uF900-\uFAFF]/g) ?? []).length;
  const latinText = text.replace(/[\u3000-\u9FFF\uF900-\uFAFF]/g, '').trim();
  const latinWords = latinText ? latinText.split(/\s+/).length : 0;

  // CJK reading ~400 chars/min, Latin ~200 words/min
  const minutes = cjkChars / 400 + latinWords / 200;
  return Math.max(1, Math.ceil(minutes));
}
