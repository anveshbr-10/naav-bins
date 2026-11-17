// Keeps the Kannada and Hindi dictionaries in step with the UI.
//
//   node scripts/i18n-sync.mjs           extract strings, add new keys, drop unused keys, and
//                                        machine-translate missing keys when a provider is configured
//   node scripts/i18n-sync.mjs --check   exit 1 if any key is missing or unused (CI / tests)
//   --quiet                              print only problems (used by `npm run dev` / `npm run build`)
//
// Strings come from:
//   • the web app: t('…') and tk('…') calls in src/**/*.js(x)
//   • the API: error templates in ../../server (fail(res, code, '…'), reject(code, '…'), template: '…'),
//     which the API returns with their parameters so the app can show them translated.
//
// Machine translation (optional; only fills keys that are missing, never overwrites a human edit):
//   GOOGLE_TRANSLATE_API_KEY=…                       Google Cloud Translation (v2)
//   LIBRETRANSLATE_URL=https://… [LIBRETRANSLATE_API_KEY=…]   LibreTranslate
// {placeholders} and the product name are protected during translation; results that lose a
// placeholder are discarded and reported, so a broken translation never ships.

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import process from 'node:process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const SERVER = resolve(ROOT, '..', '..', 'server');
const LOCALES = join(SRC, 'locales');
export const TARGETS = ['kn', 'hi'];
const PROTECTED_TERMS = ['Naav Bins', 'UPI', 'QR', 'BBMP', 'CO₂', '₹'];

function walk(dir, exts, skip = new Set(['node_modules', 'dist', 'locales', 'test'])) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p, exts, skip));
    else if (exts.includes(extname(name)) && !name.includes('.test.')) out.push(p);
  }
  return out;
}

function unescape(raw, quote) {
  return raw.replace(/\\(.)/g, (m, c) => (c === 'n' ? '\n' : c === quote || c === '\\' || c === "'" || c === '"' ? c : m));
}

const STRING = String.raw`(['"\x60])((?:\\.|(?!\1)[^\\])*?)\1`;
const CLIENT_PATTERNS = [new RegExp(String.raw`\b(?:t|tk)\(\s*` + STRING + String.raw`\s*[,)]`, 'g')];
const SERVER_PATTERNS = [
  new RegExp(String.raw`\bfail\(\s*res\s*,\s*\d+\s*,\s*` + STRING, 'g'),
  new RegExp(String.raw`\breject\(\s*\d+\s*,\s*` + STRING, 'g'),
  new RegExp(String.raw`\btemplate:\s*` + STRING, 'g'),
];

function collect(files, patterns, keys) {
  for (const file of files) {
    // Skip comment lines, so documentation such as "write t('…')" never becomes a key.
    const text = readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
      .join('\n');
    for (const re of patterns) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        if (m[1] === '`' && m[2].includes('${')) continue; // dynamic template literal: not a key
        const key = unescape(m[2], m[1]);
        if (key.trim()) keys.add(key);
      }
    }
  }
}

export function extractKeys() {
  const keys = new Set();
  collect(walk(SRC, ['.js', '.jsx']), CLIENT_PATTERNS, keys);
  collect(walk(SERVER, ['.js'], new Set(['node_modules', 'test', 'scripts', 'supabase'])), SERVER_PATTERNS, keys);
  return [...keys].sort((a, b) => a.localeCompare(b));
}

export function readDictionary(lang) {
  const file = join(LOCALES, `${lang}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
}

const placeholders = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join('|');

// { missing: [key], unused: [key], badPlaceholders: [key] } for one language.
export function diff(keys, dict) {
  const set = new Set(keys);
  return {
    missing: keys.filter((k) => typeof dict[k] !== 'string' || !dict[k].trim()),
    unused: Object.keys(dict).filter((k) => !set.has(k)),
    badPlaceholders: keys.filter((k) => typeof dict[k] === 'string' && placeholders(dict[k]) !== placeholders(k)),
  };
}

// ---------- machine translation ----------

function protect(text) {
  const tokens = [];
  let s = text.replace(/\{\w+\}/g, (m) => { tokens.push(m); return `[[${tokens.length - 1}]]`; });
  for (const term of PROTECTED_TERMS) {
    s = s.split(term).join(`[[${tokens.push(term) - 1}]]`);
  }
  return { s, tokens };
}

function restore(text, tokens) {
  let ok = true;
  const out = text.replace(/\[\[\s*(\d+)\s*\]\]/g, (m, i) => tokens[Number(i)] ?? m);
  for (const tok of tokens) if (!out.includes(tok)) ok = false;
  return ok ? out : null;
}

async function translateBatch(texts, target) {
  const key = process.env.GOOGLE_TRANSLATE_API_KEY;
  const libre = process.env.LIBRETRANSLATE_URL;
  if (key) {
    const res = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: texts, source: 'en', target, format: 'text' }),
    });
    if (!res.ok) throw new Error(`Google Translate HTTP ${res.status}`);
    const json = await res.json();
    return json.data.translations.map((t) => t.translatedText);
  }
  if (libre) {
    const out = [];
    for (const q of texts) {
      const res = await fetch(`${libre.replace(/\/+$/, '')}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q, source: 'en', target, format: 'text', api_key: process.env.LIBRETRANSLATE_API_KEY || undefined }),
      });
      if (!res.ok) throw new Error(`LibreTranslate HTTP ${res.status}`);
      out.push((await res.json()).translatedText);
    }
    return out;
  }
  return null;
}

export function providerConfigured() {
  return Boolean(process.env.GOOGLE_TRANSLATE_API_KEY || process.env.LIBRETRANSLATE_URL);
}

async function machineTranslate(keys, target, log) {
  const result = {};
  for (let i = 0; i < keys.length; i += 50) {
    const chunk = keys.slice(i, i + 50);
    const prepared = chunk.map(protect);
    const translated = await translateBatch(prepared.map((p) => p.s), target);
    if (!translated) return result;
    chunk.forEach((k, j) => {
      const restored = restore(translated[j] || '', prepared[j].tokens);
      if (restored) result[k] = restored;
      else log(`  ⚠ ${target}: discarded a machine translation that lost a placeholder: "${k}"`);
    });
  }
  return result;
}

// ---------- sync ----------

export async function sync({ check = false, quiet = false, log = console.log } = {}) {
  const keys = extractKeys();
  let problems = 0;
  for (const lang of TARGETS) {
    const dict = readDictionary(lang);
    let { missing, unused, badPlaceholders } = diff(keys, dict);

    if (!check) {
      if (missing.length && providerConfigured()) {
        try {
          const filled = await machineTranslate(missing, lang, log);
          Object.assign(dict, filled);
          if (Object.keys(filled).length) log(`  ${lang}: machine-translated ${Object.keys(filled).length} new string(s). Review them in src/locales/${lang}.json.`);
        } catch (err) {
          log(`  ⚠ ${lang}: machine translation failed (${err.message}).`);
        }
      }
      const next = {};
      for (const k of keys) if (typeof dict[k] === 'string' && dict[k].trim()) next[k] = dict[k];
      const before = JSON.stringify(readDictionary(lang));
      const after = JSON.stringify(next);
      if (before !== after) writeFileSync(join(LOCALES, `${lang}.json`), `${JSON.stringify(next, null, 2)}\n`);
      ({ missing, unused, badPlaceholders } = diff(keys, next));
    }

    const count = missing.length + badPlaceholders.length + (check ? unused.length : 0);
    problems += count;
    if (count || !quiet) {
      log(`${lang}: ${keys.length - missing.length}/${keys.length} translated` +
        (missing.length ? `, ${missing.length} missing` : '') +
        (check && unused.length ? `, ${unused.length} unused` : '') +
        (badPlaceholders.length ? `, ${badPlaceholders.length} with wrong {placeholders}` : ''));
      for (const k of missing.slice(0, 20)) log(`  missing: ${JSON.stringify(k)}`);
      if (missing.length > 20) log(`  … and ${missing.length - 20} more`);
      for (const k of badPlaceholders) log(`  placeholders differ: ${JSON.stringify(k)}`);
      if (check) for (const k of unused.slice(0, 20)) log(`  unused: ${JSON.stringify(k)}`);
    }
  }
  if (problems && !check && !providerConfigured() && !quiet) {
    log('Tip: set GOOGLE_TRANSLATE_API_KEY or LIBRETRANSLATE_URL to fill new strings automatically, or add them to src/locales/*.json.');
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const check = process.argv.includes('--check');
  const quiet = process.argv.includes('--quiet');
  sync({ check, quiet }).then((problems) => {
    if (check && problems) {
      console.error('\n✗ Translations are out of date. Run `npm run i18n` and add the missing Kannada / Hindi text.');
      process.exit(1);
    }
    if (check) console.log('✓ Kannada and Hindi translations cover every UI string.');
  }).catch((err) => {
    console.error(err);
    process.exit(check ? 1 : 0);
  });
}
