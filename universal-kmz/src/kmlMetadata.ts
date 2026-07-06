function ensureArray<T>(val: T | T[] | undefined): T[] {
  if (val === undefined || val === null) return [];
  if (Array.isArray(val)) return val;
  return [val];
}

export function extractExtendedData(extendedData: any): Record<string, string> {
  const result: Record<string, string> = {};
  if (!extendedData) return result;

  if (extendedData.Data) {
    const dataList = ensureArray(extendedData.Data);
    for (const d of dataList) {
      if (d['@_name']) {
        const key = d['@_name'];
        const val = d.value !== undefined ? String(d.value) : '';
        result[key] = val;
      }
    }
  }

  if (extendedData.SchemaData) {
    const schemaList = ensureArray(extendedData.SchemaData);
    for (const sd of schemaList) {
      if (sd.SimpleData) {
        const simpleList = ensureArray(sd.SimpleData);
        for (const s of simpleList) {
          if (s['@_name']) {
            const key = s['@_name'];
            const val = s['#text'] !== undefined ? String(s['#text']) : (s !== null ? String(s) : '');
            result[key] = val;
          }
        }
      }
    }
  }

  for (const [key, val] of Object.entries(extendedData)) {
    if (key !== 'Data' && key !== 'SchemaData' && !key.startsWith('@_')) {
      if (typeof val === 'string' || typeof val === 'number') {
        result[key] = String(val);
      } else if (val && typeof val === 'object' && (val as any)['#text'] !== undefined) {
        result[key] = String((val as any)['#text']);
      }
    }
  }

  return result;
}

export function extractFromHtmlOrText(text: string): Record<string, string> {
  const dict: Record<string, string> = {};
  if (!text) return dict;

  const htmlRowRegex = /<tr[^>]*>\s*<t[dh][^>]*>(.*?)<\/t[dh]>\s*<t[dh][^>]*>(.*?)<\/t[dh]>\s*<\/tr>/gi;
  let match;
  let hasHtmlTable = false;

  while ((match = htmlRowRegex.exec(text)) !== null) {
    hasHtmlTable = true;
    const key = cleanHtmlText(match[1]);
    const val = cleanHtmlText(match[2]);
    if (key && val) {
      dict[key] = val;
    }
  }

  if (!hasHtmlTable) {
    const cleanText = text
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?[^>]+(>|$)/g, '')
      .trim();

    const lines = cleanText.split('\n');
    for (const line of lines) {
      const parts = line.split(/[:=]/);
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const val = parts.slice(1).join(':').trim();
        if (key && val) {
          dict[key] = val;
        }
      }
    }
  }

  return dict;
}

export function cleanHtmlText(s: string): string {
  if (!s) return '';
  return s
    .replace(/<\/?[^>]+(>|$)/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}
