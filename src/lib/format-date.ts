export function formatDate(date: Date, locale: 'en' | 'ja' = 'en'): string {
  return date.toLocaleDateString(locale === 'ja' ? 'ja-JP' : 'en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}
