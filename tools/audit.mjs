#!/usr/bin/env node
// Repo health check: the five gates the spec asks for, in one command.
//
// Why this exists: a batch of edits went in without re-running the checks, and
// four things broke quietly --
//   1. an unescaped pipe inside a table cell turned a 3-column table into 5;
//   2. a duplicated heading made one section unreachable;
//   3. a test asserted a semver pattern that VERSION '0.0.2-rc.3' can never match;
//   4. the recursive test script swallowed a failing package and exited 0.
// None of those are visible in a diff. All of them are visible here.
//
// Usage:
//   node tools/audit.mjs          run every check, print a summary
//   node tools/audit.mjs docs     markdown only: codepoints, fences, tables, refs
//   node tools/audit.mjs json     catalog/limits.json only
//   node tools/audit.mjs exit     exit-code contracts of the other tools
//
// Exit codes: 0 all clean, 1 findings reported, 2 usage error.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const NL = String.fromCharCode(10)
const SEC = String.fromCharCode(0x00a7)
const FENCE = String.fromCharCode(96).repeat(3)
const BAR = String.fromCharCode(124)
const HEAD_RE = /^(#{2,4})\s+([0-9]+)((?:[.][0-9]+)*)/
const SEP_RE = /^[|][-: |]+$/
// CROSS_RE is built in checkRefs() from SEC, avoiding a template literal here.
const SKIP = new Set(['node_modules', '.git', 'dist', 'coverage'])

const DOCS = [
  '00-README.md', '01-PRD.md', '02-CONSTRAINTS.md', '03-DATA-CONTRACT.md',
  '04-SCHEDULER.md', '05-UI.md', '06-TASKS.md', '07-ACCEPTANCE.md',
  '08-START-PROMPT.md', '09-AUDIT-LOG.md',
]

// Codepoints that mean "something upstream mangled this file". U+FFFD is the
// replacement character -- it only appears after a lossy decode. U+2028/U+2029
// look like a newline but break JS string literals. C0 controls other than
// tab/newline/CR have no business in source or docs. Private-use area means a
// font fell back and the author never noticed.
function suspectReason(code) {
  if (code === 0xfffd) return 'U+FFFD replacement char'
  if (code === 0x2028) return 'U+2028 line separator'
  if (code === 0x2029) return 'U+2029 paragraph separator'
  if (code < 0x20 && code !== 9 && code !== 10 && code !== 13) {
    return 'C0 control U+' + code.toString(16).padStart(4, '0')
  }
  if (code >= 0xe000 && code <= 0xf8ff) {
    return 'private use U+' + code.toString(16).toUpperCase()
  }
  return null
}

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (/[.](md|mjs|js|ts|json)$/.test(name)) out.push(p)
  }
  return out
}

function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf8')
}

const findings = []
function bad(file, line, msg) {
  findings.push({ file, line, msg })
}

// --- 1. suspect codepoints ----------------------------------------------------
function checkCodepoints() {
  for (const abs of walk(ROOT, [])) {
    const rel = relative(ROOT, abs)
    const text = readFileSync(abs, 'utf8')
    const lines = text.split(NL)
    for (let i = 0; i < lines.length; i++) {
      for (const ch of lines[i]) {
        const why = suspectReason(ch.codePointAt(0))
        if (why) {
          bad(rel, i + 1, 'unexpected ' + why)
          break
        }
      }
    }
  }
}

// --- CHECK 2: fenced code blocks paired -------------
function checkFences() {
  for (const name of DOCS) {
    const rel = 'docs/' + name;
    const n = read(rel).split(FENCE).length - 1;
    if (n % 2) bad(rel, 1, FENCE + ' appears ' + n + ' times (odd)');
  }
}

// --- check 3: table header vs separator column count ------------------------
function checkTables() {
  for (const name of DOCS) {
    const rel = 'docs/' + name;
    const lines = read(rel).split(NL);
    let inFence = false;
    for (let i = 0; i < lines.length - 1; i++) {
      if (lines[i].startsWith(FENCE)) inFence = !inFence;
      if (inFence) continue;
      const head = lines[i];
      const sep = lines[i + 1];
      if (head.charAt(0) !== BAR) continue;
      if (sep.charAt(0) !== BAR) continue;
      if (!SEP_RE.test(sep.trim())) continue;
      const a = head.split(BAR).length - 1;
      const b = sep.split(BAR).length - 1;
      if (a !== b) bad(rel, i + 2, 'separator has ' + b + ' cols, header has ' + a);
      const want = sep.split(BAR).length - 2;
      for (let j = i + 2; j < lines.length; j++) {
        const row = lines[j];
        if (row.charAt(0) !== BAR) break;
        const got = row.split(BAR).length - 2;
        if (got !== want) {
          bad(rel, j + 1, 'row has ' + got + ' cols, expected ' + want);
          break;
        }
      }
    }
  }
}

// --- CHECK 4: cross-file section references --------------------
const DOCS_PATH = 'docs/';
const REF_MSG = 'ref ';
const SEC_MSG = ' section ';
const HEAD_MSG = ' has no matching heading';
const REF_LOOKUP = new RegExp(["(0[0-8])", "\\s+" + SEC + "([0-9]+(?:[.][0-9]+)*)"].join(""), "g");

function headingKeys(text) {
  const keys = new Set();
  for (const line of text.split(NL)) {
    const m = HEAD_RE.exec(line);
    if (m) keys.add(m[2] + m[3]);
  }
  return keys;
}

function checkRefs() {
  const keys = {};
  for (const name of DOCS) keys[name.slice(0, 2)] = headingKeys(read(DOCS_PATH + name));
  for (const name of DOCS) {
    const fileLines = read(DOCS_PATH + name).split(NL);
    for (let i = 0; i < fileLines.length; i++) {
      REF_LOOKUP.lastIndex = 0;
      const m = REF_LOOKUP.exec(fileLines[i]);
      if (!m) continue;
      const set = keys[m[1]];
      if (set && !set.has(m[2])) {
        bad(DOCS_PATH + name, i + 1, REF_MSG + m[1] + SEC_MSG + m[2] + HEAD_MSG);
      }
    }
  }
}

// --- CHECK 5: catalog JSON ---------------------------------------
function checkJson() {
  const rel = 'catalog/limits.json';
  const raw = read(rel);
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    bad(rel, 1, 'not valid JSON: ' + e.message);
    return;
  }
  if (!raw.endsWith(NL)) bad(rel, 1, 'no final newline');
  if (!data.providers) {
    bad(rel, 1, 'no providers object');
    return;
  }
  for (const id of Object.keys(data.providers)) {
    const p = data.providers[id];
    if (!p.baseUrl) bad(rel, 1, id + ': no baseUrl');
    if (p.baseUrlMutable !== false) bad(rel, 1, id + ': baseUrlMutable is not false');
    if (!p.usageEndpoint && !p.usageEndpointReason) {
      bad(rel, 1, id + ': usageEndpoint is null without usageEndpointReason');
    }
    nestedSources(id, p.limits, '')
    for (const k of Object.keys(p.limits || {})) {
      const v = p.limits[k];
      if (!v || typeof v !== 'object') bad(rel, 1, id + '.limits.' + k + ': not a sourced object');
    }
  }
}

// A limit value may be a sourced scalar {value, source} or a group of them
// (AMD's backoffNoHeader nests baseMs/capMs/jitter). Walk the tree so a group
// without its own tag is not reported as a missing one.
// A source tag earns its place only from this list. An empty string or an
// invented label is the same as no tag at all: nobody can trace it back.
const SOURCE_TAGS = new Set(['doc', 'doc-local', 'probe', 'user', 'assume', 'unknown'])

function nestedSources(id, node, path) {
  if (!node || typeof node !== 'object') return
  const tagged = node.source !== undefined
  const ok = tagged && typeof node.source === 'string' && SOURCE_TAGS.has(node.source)
  const here = path + (node.value !== undefined && !ok ? ' [no source]' : '')
  if (here !== path) bad('catalog/limits.json', 1, id + here)
  for (const key of Object.keys(node)) {
    if (key === 'value' || key === 'source' || key === 'ref' || key === 'note') continue
    nestedSources(id, node[key], path + '.' + key)
  }
}

// --- CHECK 6: exit-code contracts ------------------------------
function run(args) {
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '').trim() };
}

function checkExit() {
  const probe = run(['tools/roundtrip.mjs', 'encode', 'docs/00-README.md']);
  let b64 = '';
  try {
    b64 = JSON.parse(probe.out).base64;
  } catch {
    bad('tools/roundtrip.mjs', 1, 'encode did not print JSON');
    return;
  }
  const same = run(['tools/roundtrip.mjs', 'check', 'docs/00-README.md', b64]);
  if (same.code !== 0) bad('tools/roundtrip.mjs', 1, 'matching file exited ' + same.code + ', want 0');
  const diff = run(['tools/roundtrip.mjs', 'check', 'docs/01-PRD.md', b64]);
  if (diff.code !== 1) bad('tools/roundtrip.mjs', 1, 'mismatch exited ' + diff.code + ', want 1');
  const usage = run(['tools/roundtrip.mjs', 'check']);
  if (usage.code !== 2) bad('tools/roundtrip.mjs', 1, 'usage error exited ' + usage.code + ', want 2');
  if (usage.out !== '') bad('tools/roundtrip.mjs', 1, 'usage error printed on stdout; a caller can read it as a mismatch');
  if (same.out !== '1') bad('tools/roundtrip.mjs', 1, 'success should print 1 on stdout, printed ' + same.out);
  if (diff.out !== '0') bad('tools/roundtrip.mjs', 1, 'mismatch should print 0 on stdout, printed ' + diff.out);
}

// --- main ---------------------------------------------------------------------
const target = process.argv[2];
const ALL = ['docs', 'json', 'exit'];
if (target && !ALL.includes(target)) {
  console.error('usage: node tools/audit.mjs [' + ALL.join('|') + ']');
  process.exit(2);
}
const runThese = target ? [target] : ALL;

if (runThese.includes('docs')) {
  checkCodepoints();
  checkFences();
  checkTables();
  checkRefs();
}
if (runThese.includes('json')) checkJson();
if (runThese.includes('exit')) checkExit();

if (findings.length === 0) {
  console.log('audit: clean');
  process.exit(0);
}
findings.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
for (const f of findings) console.log(f.file + ':' + f.line + '  ' + f.msg);
console.log('audit: ' + findings.length + ' finding(s)');
process.exit(1);
