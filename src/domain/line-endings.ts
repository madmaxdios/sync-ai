export function isBinary(content: Buffer): boolean {
  return content.includes(0);
}

function normalize(content: Buffer): Buffer {
  if (isBinary(content)) return content;
  return Buffer.from(content.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
}

/** Compares file contents ignoring CRLF/LF differences in text files. */
export function sameContent(a: Buffer, b: Buffer): boolean {
  return normalize(a).equals(normalize(b));
}
