// Every UI string (and every API error the app can show) must have a Kannada and a Hindi
// translation with the same {placeholders}. Fails CI when the UI changes without translations.
// Fix with `npm run i18n` (auto-translates when a provider key is set) or edit src/locales/*.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractKeys, readDictionary, diff, TARGETS } from '../scripts/i18n-sync.mjs';

const keys = extractKeys();

test('the extractor finds the UI strings and the API error templates', () => {
  assert.ok(keys.length > 300, `only ${keys.length} keys found`);
  assert.ok(keys.includes('Scan a bin'), 'client t() strings');
  assert.ok(keys.includes('Dry waste'), 'client tk() strings');
  assert.ok(keys.includes('Please wait {seconds}s before depositing the next item.'), 'server reject() templates');
  assert.ok(keys.includes('You need to be at the bin to use it. You are about {distance} m away.'), 'server fail() templates');
});

for (const lang of TARGETS) {
  test(`${lang}: every string is translated, with matching placeholders, and nothing is stale`, () => {
    const { missing, unused, badPlaceholders } = diff(keys, readDictionary(lang));
    assert.deepEqual(missing, [], `missing ${lang} translations`);
    assert.deepEqual(badPlaceholders, [], `${lang} translations with different {placeholders}`);
    assert.deepEqual(unused, [], `unused ${lang} keys (run npm run i18n)`);
  });
}
