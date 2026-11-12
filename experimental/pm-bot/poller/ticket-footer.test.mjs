import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { withTicket } from './ticket-footer.mjs';

const texts = JSON.parse(readFileSync(new URL('./messages.json', import.meta.url)));
for (const [code, label] of [['de', 'Ursprungsticket:'], ['en', 'Origin ticket:']]) {
  test(`ticket footer escapes text and handles stored origins in ${code}`, () => {
    const t = { identifier: 'ACME-1', title: '<@U1> & A|B', url: 'https://bakers.test/1' };
    const base = 'Existing message\n\n<https://bakers.test/1|ACME-1 · &lt;@U1&gt; &amp; A¦B>';
    assert.equal(withTicket('Existing message', t, texts[code]), base);
    assert.equal(withTicket('Existing message', { ...t, origin: 'legacy <@U1>' }, texts[code]), `${base}\n${label} legacy &lt;@U1&gt;`);
    assert.equal(withTicket('Existing message', { ...t, origin: 'https://issues.test/1' }, texts[code]), `${base}\n${label} <https://issues.test/1|https://issues.test/1>`);
    assert.equal(withTicket('Existing message', {}, texts[code]), 'Existing message');
  });
}
