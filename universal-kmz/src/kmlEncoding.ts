const XML_ENCODING_PATTERN = /<\?xml\s+[^>]*\bencoding\s*=\s*["']([^"']+)["'][^>]*\?>/i;

function getEncodingFromProlog(buf: Buffer): string {
  const prolog = new TextDecoder('ascii').decode(buf.subarray(0, 1024));
  const declaredEncoding = prolog.match(XML_ENCODING_PATTERN)?.[1].trim().toLowerCase();

  switch (declaredEncoding) {
    case 'utf-8':
    case 'utf8':
      return 'utf-8';
    case 'utf-16':
    case 'utf-16le':
    case 'utf-16-le':
      return 'utf-16le';
    case 'utf-16be':
    case 'utf-16-be':
      return 'utf-16be';
    case 'iso-8859-1':
    case 'iso8859-1':
    case 'latin1':
    case 'latin-1':
      return 'iso-8859-1';
    case 'windows-1252':
    case 'windows1252':
    case 'cp1252':
      return 'windows-1252';
    default:
      return 'utf-8';
  }
}

export function decodeKmlBuffer(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(buf);
  }

  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(buf);
  }

  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(buf);
  }

  return new TextDecoder(getEncodingFromProlog(buf)).decode(buf);
}
