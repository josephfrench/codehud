/**
 * A small YAML reader for configuration files (serverless.yml, SAM / CloudFormation templates,
 * docker-compose, GitHub workflows). Block maps and sequences by indentation, flow `{}` / `[]`
 * on one line, quoted and plain scalars, `|` / `>` block scalars, comments, anchors ignored, and
 * CloudFormation tags: `!Ref X` -> {Ref: X}, `!GetAtt A.B` -> {'Fn::GetAtt': [A, B]}, `!Sub s` ->
 * {'Fn::Sub': s}, other tags keep their payload. Not a full YAML implementation; never throws.
 */
export type Yaml = string | number | boolean | null | Yaml[] | { [k: string]: Yaml };

interface Line { indent: number; text: string; raw: string }

function lines(src: string): Line[] {
  const out: Line[] = [];
  let inBlock: { indent: number } | null = null;
  for (const raw of src.replace(/\r\n?/g, '\n').split('\n')) {
    if (inBlock) {
      // block scalar continuation lines are kept verbatim (handled by the parser via raw)
      const ind = raw.search(/\S/);
      if (raw.trim() === '' || ind > inBlock.indent) { out.push({ indent: -1, text: raw, raw }); continue; }
      inBlock = null;
    }
    if (/^\s*#/.test(raw) || raw.trim() === '' || /^---\s*$|^\.\.\.\s*$/.test(raw)) { if (/^---/.test(raw) && out.length) break; continue; }
    const text = stripComment(raw).trimEnd();
    const indent = raw.search(/\S/);
    out.push({ indent, text: text.trim(), raw });
    if (/[|>][-+]?\d*\s*$/.test(text) && /:\s*[|>][-+]?\d*\s*$|^-\s*[|>][-+]?\d*\s*$/.test(text)) inBlock = { indent };
  }
  return out;
}

function stripComment(raw: string): string {
  let quote: string | null = null;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!;
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '#' && (i === 0 || /\s/.test(raw[i - 1]!))) return raw.slice(0, i);
  }
  return raw;
}

function scalar(text: string): Yaml {
  const t = text.trim();
  if (t === '' || t === '~' || t === 'null') return null;
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (/^"(?:[^"\\]|\\.)*"$/.test(t)) return t.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
  if (/^'(?:[^']|'')*'$/.test(t)) return t.slice(1, -1).replace(/''/g, "'");
  const tag = /^!(\w+)\s*(.*)$/s.exec(t);
  if (tag) {
    const [, name, rest] = tag as unknown as [string, string, string];
    const payload = rest.trim() ? parseInline(rest.trim()) : null;
    if (name === 'Ref') return { Ref: String(payload) };
    if (name === 'GetAtt') return { 'Fn::GetAtt': typeof payload === 'string' ? payload.split('.') : (payload as Yaml[]) };
    return { [`Fn::${name}`]: payload };
  }
  if (t.startsWith('&') || t.startsWith('*')) return t.replace(/^[&*]\S+\s*/, '') || null;
  return t;
}

/** Flow collections and scalars on one line. */
export function parseInline(text: string): Yaml {
  const t = text.trim();
  if (t.startsWith('{') && t.endsWith('}')) {
    const obj: { [k: string]: Yaml } = {};
    for (const part of splitFlow(t.slice(1, -1))) {
      const i = part.indexOf(':');
      if (i < 0) continue;
      obj[part.slice(0, i).trim().replace(/^["']|["']$/g, '')] = parseInline(part.slice(i + 1));
    }
    return obj;
  }
  if (t.startsWith('[') && t.endsWith(']')) return splitFlow(t.slice(1, -1)).filter((p) => p.trim() !== '').map(parseInline);
  return scalar(t);
}

function splitFlow(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') depth--;
    else if (c === ',' && depth === 0) { out.push(text.slice(start, i)); start = i + 1; }
  }
  out.push(text.slice(start));
  return out;
}

export function parseYaml(src: string): Yaml {
  const ls = lines(src);
  let pos = 0;

  const blockScalar = (_indent: number): string => {
    const raws: string[] = [];
    while (pos < ls.length && ls[pos]!.indent === -1) { raws.push(ls[pos]!.raw); pos++; }
    // the block's indentation is that of its first non-empty line
    const first = raws.find((r) => r.trim() !== '');
    const strip = first ? first.search(/\S/) : 0;
    return raws.map((r) => (r.trim() === '' ? '' : r.slice(Math.min(strip, r.search(/\S/))))).join('\n').replace(/\n+$/, '');
  };

  const value = (afterColon: string, indent: number): Yaml => {
    const t = afterColon.trim();
    if (/^[|>][-+]?\d*$/.test(t)) {
      const s = blockScalar(indent + 1);
      return t.startsWith('>') ? s.replace(/\n(?!\n)/g, ' ') : s;
    }
    if (t === '') {
      const next = ls[pos];
      if (!next || next.indent === -1) return null;
      if (next.indent > indent) return node(next.indent);
      if (next.indent === indent && next.text.startsWith('- ') || next?.text === '-') return seq(indent);
      return null;
    }
    return parseInline(t);
  };

  const seq = (indent: number): Yaml[] => {
    const arr: Yaml[] = [];
    while (pos < ls.length) {
      const l = ls[pos]!;
      if (l.indent !== indent || !(l.text === '-' || l.text.startsWith('- '))) break;
      pos++;
      const rest = l.text.slice(1).trim();
      if (rest === '') { const next = ls[pos]; arr.push(next && next.indent > indent ? node(next.indent) : null); continue; }
      // "- key: value" starts an inline map whose further keys are indented past the dash
      const kv = /^([^\s"'{[][^:]*?|"[^"]*"|'[^']*'):(?:\s+(.*))?$/.exec(rest);
      if (kv && !/^!/.test(rest)) {
        const obj: { [k: string]: Yaml } = {};
        const childIndent = indent + 2;
        // re-inject as a virtual line at childIndent
        ls.splice(pos, 0, { indent: childIndent, text: rest, raw: ' '.repeat(childIndent) + rest });
        Object.assign(obj, map(childIndent));
        arr.push(obj);
        continue;
      }
      if (/^[|>][-+]?\d*$/.test(rest)) { arr.push(blockScalar(indent + 1)); continue; }
      arr.push(parseInline(rest));
    }
    return arr;
  };

  const map = (indent: number): { [k: string]: Yaml } => {
    const obj: { [k: string]: Yaml } = {};
    while (pos < ls.length) {
      const l = ls[pos]!;
      if (l.indent !== indent) break;
      const kv = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s"'{[-][^:]*?|-[^\s][^:]*?|[?]\s.*?):(?:\s+(.*)|\s*)$/.exec(l.text);
      if (!kv) { pos++; continue; }
      pos++;
      const key = kv[1]!.replace(/^["']|["']$/g, '');
      obj[key] = value(kv[2] ?? '', indent);
    }
    return obj;
  };

  const node = (indent: number): Yaml => {
    const l = ls[pos];
    if (!l) return null;
    if (l.text === '-' || l.text.startsWith('- ')) return seq(indent);
    if (/^[^\s]/.test(l.text) && /:(\s|$)/.test(l.text)) return map(indent);
    pos++;
    return parseInline(l.text);
  };

  while (pos < ls.length && ls[pos]!.indent === -1) pos++;
  if (!ls.length) return null;
  return node(ls[pos]?.indent ?? 0);
}

export function isMap(v: Yaml | undefined): v is { [k: string]: Yaml } {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Every logical-id reference in a value: Ref, Fn::GetAtt, ${X} / ${X.Arn} inside Fn::Sub and plain strings. */
export function refsIn(v: Yaml | undefined, out = new Set<string>()): Set<string> {
  if (typeof v === 'string') {
    for (const m of v.matchAll(/\$\{([A-Za-z][\w]*)(?:\.\w+)?\}/g)) out.add(m[1]!);
    return out;
  }
  if (Array.isArray(v)) { for (const x of v) refsIn(x, out); return out; }
  if (isMap(v)) {
    if (typeof v.Ref === 'string') out.add(v.Ref);
    const ga = v['Fn::GetAtt'];
    if (Array.isArray(ga) && typeof ga[0] === 'string') out.add(ga[0]);
    else if (typeof ga === 'string') out.add(ga.split('.')[0]!);
    for (const [k, x] of Object.entries(v)) if (k !== 'Ref' && k !== 'Fn::GetAtt') refsIn(x, out);
  }
  return out;
}
