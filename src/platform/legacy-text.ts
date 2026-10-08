// Original RPE project files (`info.txt`, `Settings.json`, `Hotkey.txt`) were written on Chinese
// Windows and are usually GB18030, but a project saved by a newer build may be UTF-8. Validating
// with a fatal UTF-8 decode first settles the question: genuine UTF-8 always succeeds, and GB18030
// text almost never happens to be valid UTF-8, so the fallback only triggers when it should.
export function decodeLegacy(bytes: ArrayBuffer | Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes as ArrayBuffer); }
  catch { return new TextDecoder('gb18030').decode(bytes as ArrayBuffer); }
}

/** The key/value pairs of an RPE `info.txt`, with keys and values trimmed. */
export type LegacyInfo = Record<string, string>;

/** Parses the `Key: value` lines of an RPE `info.txt`. */
export function parseInfo(text: string): LegacyInfo {
  const info: LegacyInfo = {};
  for (const line of text.split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator > 0) info[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return info;
}
