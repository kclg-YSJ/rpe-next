import { checkAgentSignal } from './agent-commands.mjs';
import { t } from '../i18n.mjs';

export const AGENT_SOURCE_ROOTS = Object.freeze(['src/core', 'src/application', 'src/platform', 'src/ui', 'src/locales', 'desktop', 'assets/mods', 'assets/editor-skins', 'schemas']);
export const AGENT_SOURCE_DOCUMENTS = Object.freeze(['protocols/EDITOR-SKIN-PROTOCOL.zh-CN.md', 'protocols/MOD-PROTOCOL.zh-CN.md', 'protocols/GLOBAL-EVENTS-PROTOCOL.zh-CN.md', 'protocols/ANIMATION-CURVES-PROTOCOL.zh-CN.md', 'protocols/VIDEO-RENDER.zh-CN.md', 'protocols/AI-AGENT-PROTOCOL.zh-CN.md', 'protocols/CHART-VERSION-CONTROL.zh-CN.md']);
export const AGENT_SOURCE_FILES = Object.freeze(['src/i18n.mjs', 'index.html', 'styles.css', 'package.json', 'README.md', 'LICENSE', 'NOTICE', ...AGENT_SOURCE_DOCUMENTS]);

export function isAgentSourcePath(path) {
  if (typeof path !== 'string' || !path || /[\\\u0000-\u001f:%?#]/.test(path) || path.startsWith('/') || path.split('/').some(part => !part || part === '.' || part === '..')) return false;
  return AGENT_SOURCE_FILES.includes(path) || /^src\/(?:core|application|platform|ui|locales)\/.+\.mjs$/.test(path) || /^desktop\/[^/]+\.(?:cjs|mjs|py)$/.test(path) || /^assets\/(?:mods|editor-skins)\/.+\.(?:mjs|json|css|md)$/.test(path) || /^schemas\/.+\.(?:json|d\.ts)$/.test(path);
}

const integer = (value, fallback, minimum, maximum) => {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) throw Error(t('agent-source.s16a32c5'));
  return result;
};

export class AgentSourceIndex {
  constructor(bundle) {
    if (bundle?.format !== 'rpen-agent-source' || bundle.version !== 1 || !Array.isArray(bundle.files) || bundle.files.length > 4000) throw Error(t('agent-source.s1c5d3b6'));
    this.version = String(bundle.editorVersion ?? ''); this.files = new Map(); let characters = 0;
    for (const entry of bundle.files) {
      if (!isAgentSourcePath(entry?.path) || typeof entry.text !== 'string' || entry.text.length > 2000000 || this.files.has(entry.path)) throw Error(t('agent-source.s2615025'));
      characters += entry.text.length; if (characters > 24000000) throw Error(t('agent-source.saab4b52'));
      this.files.set(entry.path, { text: entry.text, lines: entry.text.split(/\r\n?|\n/) });
    }
    this.paths = [...this.files.keys()].sort();
  }
  async query(args = {}, signal) {
    checkAgentSignal(signal);
    const action = args.action ?? 'list', path = args.path ?? '', query = args.query ?? '';
    if (typeof path !== 'string' || /[\\\u0000-\u001f:%?#]/.test(path) || path.startsWith('/') || path.split('/').some(part => part === '.' || part === '..')) throw Error(t('agent-source.sd318ea6'));
    if (typeof query !== 'string' || query.length > 200) throw Error(t('agent-source.s509521b'));
    const paths = this.paths.filter(name => name.startsWith(path));
    if (action === 'read') {
      if (!isAgentSourcePath(path) || !this.files.has(path)) throw Error(t('agent-source.s9b4e1a9'));
      const file = this.files.get(path), count = integer(args.lineCount, 100, 1, 200);
      let line = integer(args.startLine, 1, 1, Number.MAX_SAFE_INTEGER) - 1, column = integer(args.startColumn, 1, 1, Number.MAX_SAFE_INTEGER) - 1, remaining = 16000;
      if (line >= file.lines.length || column > file.lines[line].length) throw Error(t('agent-source.s07bf158'));
      const lines = [];
      while (line < file.lines.length && lines.length < count && remaining > 0) {
        const content = file.lines[line].slice(column, column + remaining); lines.push({ line: line + 1, column: column + 1, text: content }); remaining -= content.length + 1; column += content.length;
        if (column === file.lines[line].length) { line++; column = 0; }
      }
      return { editorVersion: this.version, path, totalLines: file.lines.length, lines, next: line < file.lines.length ? { startLine: line + 1, startColumn: column + 1 } : null };
    }
    const offset = integer(args.offset, 0, 0, Number.MAX_SAFE_INTEGER), limit = integer(args.limit, action === 'search' ? 30 : 100, 1, 100);
    if (action === 'list') {
      const entries = paths.filter(name => !query || name.toLowerCase().includes(query.toLowerCase()));
      return { editorVersion: this.version, total: entries.length, files: entries.slice(offset, offset + limit).map(name => ({ path: name, lines: this.files.get(name).lines.length, characters: this.files.get(name).text.length })), nextOffset: offset + limit < entries.length ? offset + limit : null };
    }
    if (action !== 'search' || !query.trim() || /[\r\n]/.test(query)) throw Error(t('agent-source.sf0d31c7'));
    const matches = [], needle = args.caseSensitive ? query : query.toLowerCase(); let total = 0, visited = 0;
    for (const name of paths) {
      checkAgentSignal(signal); const file = this.files.get(name);
      for (let line = 0; line < file.lines.length; line++) {
        const content = file.lines[line], column = (args.caseSensitive ? content : content.toLowerCase()).indexOf(needle); if (column < 0) continue;
        if (total >= offset && matches.length < limit) { const start = Math.max(0, column - 90); matches.push({ path: name, line: line + 1, column: column + 1, text: (start ? '…' : '') + content.slice(start, column + needle.length + 90) + (column + needle.length + 90 < content.length ? '…' : '') }); }
        total++;
      }
      if (++visited % 16 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    checkAgentSignal(signal); return { editorVersion: this.version, total, matches, nextOffset: offset + matches.length < total ? offset + matches.length : null };
  }
}
