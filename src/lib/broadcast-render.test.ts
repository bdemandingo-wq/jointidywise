// Broadcast rendering: the two product rules, and the controls that make this
// suite capable of failing.
//
// Runner: node:test. The module is import-free, so Node v24 strips the types
// natively and no bundler is involved:
//
//   node --experimental-strip-types --test src/lib/broadcast-render.test.ts
//
// There is no npm script for this, matching src/lib/phone.test.ts.
//
// TWO CONTROLS ARE DELIBERATE HERE. An implementation that appended the footer
// unconditionally would satisfy every "marketing has a footer" assertion, and
// one that never appended it would satisfy every "transactional has none" —
// so each rule needs its opposite asserted too:
//
//   1. "CONTROL: the two classes differ ONLY by the footer" — kills both the
//      always-append and never-append bugs in one assertion
//   2. "CONTROL: escaping applies to the body, not to our own constant" —
//      kills the over-escaping bug that made the constant unmatchable
//
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateBroadcastInput,
  renderBroadcastHtml,
  renderBroadcastText,
  UNSUBSCRIBE_SENTENCE,
  MAX_SIGNATURE,
  DEFAULT_SIGNATURE,
  defaultSignatureText,
  resolveSignature,
} from './broadcast-render.ts';

const URL_ = 'https://x.test/u?token=abc';

// ─── validateBroadcastInput ────────────────────────────────────────────────

test('message_class has no default — absent is a validation error', () => {
  const r = validateBroadcastInput({ subject: 'Hi', bodyText: 'Body', messageClass: undefined });
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes('message_class is required'));
});

test('rejects an unknown message_class', () => {
  const r = validateBroadcastInput({ subject: 'Hi', bodyText: 'Body', messageClass: 'promo' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes('message_class must be transactional or marketing'));
});

test('accepts a valid transactional input', () => {
  const r = validateBroadcastInput({ subject: 'Hi', bodyText: 'Body', messageClass: 'transactional' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
});

test('rejects blank subject and blank body', () => {
  const r = validateBroadcastInput({ subject: '   ', bodyText: '\n', messageClass: 'marketing' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes('subject is required'));
  assert.ok(r.errors.includes('body is required'));
});

test('rejects a subject over 200 characters', () => {
  const r = validateBroadcastInput({ subject: 'x'.repeat(201), bodyText: 'B', messageClass: 'marketing' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.includes('subject must be 200 characters or fewer'));
});

// ─── renderBroadcastHtml ───────────────────────────────────────────────────

test('marketing render appends the unsubscribe link; the stored body never contains it', () => {
  const bodyText = 'Two weeks free, on us.';
  const html = renderBroadcastHtml({ bodyText, unsubscribeUrl: URL_ });
  assert.ok(html.includes(URL_));
  assert.ok(html.includes(UNSUBSCRIBE_SENTENCE));
  assert.ok(!bodyText.toLowerCase().includes('unsubscribe'));
});

test('transactional render passes no url and emits no unsubscribe footer', () => {
  const html = renderBroadcastHtml({ bodyText: 'The site is down.', unsubscribeUrl: null });
  assert.ok(!html.includes(UNSUBSCRIBE_SENTENCE));
  assert.ok(!html.toLowerCase().includes('unsubscribe'));
});

test('CONTROL: the two classes differ ONLY by the footer', () => {
  // Kills both degenerate implementations at once: always-append and
  // never-append. The body half must be byte-identical across classes.
  const bodyText = 'Same body, both classes.';
  const tx = renderBroadcastHtml({ bodyText, unsubscribeUrl: null });
  const mk = renderBroadcastHtml({ bodyText, unsubscribeUrl: URL_ });
  assert.notEqual(tx, mk, 'marketing and transactional renders must differ');
  const footerStart = mk.indexOf('<hr');
  assert.ok(footerStart > -1, 'marketing render must carry an <hr> footer');
  // lastIndexOf, not indexOf. The signature block is itself a <div> and is now
  // always emitted, so the FIRST '</div>' is the signature's rather than the
  // wrapper's — slicing there compared two truncated strings. This test passed
  // for months only because nothing had ever rendered a nested div.
  assert.equal(
    mk.slice(0, footerStart).trim(),
    tx.slice(0, tx.lastIndexOf('</div>')).trim(),
    'the body half must be identical across classes',
  );
});

test('body is HTML-escaped — a broadcast is not an HTML injection vector', () => {
  const html = renderBroadcastHtml({
    bodyText: '<script>alert(1)</script> & "quoted"',
    unsubscribeUrl: null,
  });
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&amp;'));
});

test('CONTROL: escaping applies to the body, not to our own constant', () => {
  // UNSUBSCRIBE_SENTENCE contains an apostrophe. Escaping it turns "You're"
  // into "You&#39;re", which still RENDERS correctly but makes the constant
  // unmatchable in the source — and any test asserting the footer contains it
  // can then never pass. Escaping belongs on bodyText and unsubscribeUrl,
  // which are the actual injection surfaces; the constant is compile-time and
  // ours. Both halves are asserted so neither can regress alone.
  const html = renderBroadcastHtml({ bodyText: "it's <b>bold</b>", unsubscribeUrl: URL_ });
  assert.ok(html.includes(UNSUBSCRIBE_SENTENCE), 'our constant must appear verbatim');
  assert.ok(html.includes('&#39;s &lt;b&gt;'), 'the body must still be escaped');
});

test('newlines become paragraphs, not a single run-on line', () => {
  const html = renderBroadcastHtml({ bodyText: 'One\n\nTwo', unsubscribeUrl: null });
  assert.ok(html.includes('One'));
  assert.ok(html.includes('Two'));
  assert.ok((html.match(/<p[ >]/g) ?? []).length >= 2);
});

test('plain-text alternative carries the same unsubscribe url', () => {
  const txt = renderBroadcastText({ bodyText: 'Hello', unsubscribeUrl: URL_ });
  assert.ok(txt.includes('Hello'));
  assert.ok(txt.includes(URL_));
});

// ─── the two-copy invariant ────────────────────────────────────────────────

// ─── signature ─────────────────────────────────────────────────────────────

test('the signature appears in BOTH classes, unlike the unsubscribe footer', () => {
  const signature = 'Emmanuel\nTidyWise';
  for (const unsubscribeUrl of [null, URL_]) {
    const html = renderBroadcastHtml({ bodyText: 'Body', unsubscribeUrl, signature });
    assert.ok(html.includes('Emmanuel'), `signature missing for url=${unsubscribeUrl}`);
    assert.ok(html.includes('TidyWise'), `signature missing for url=${unsubscribeUrl}`);
  }
});

test('CONTROL: the signature is byte-identical across classes', () => {
  // The failure this kills is wiring the signature off `unsubscribeUrl` — the
  // parameter that legitimately IS marketing-only. Do that and the signature
  // silently becomes marketing-only too, which no assertion above would catch
  // because each class still renders "correctly" on its own.
  const signature = 'Emmanuel\nTidyWise';
  const tx = renderBroadcastHtml({ bodyText: 'Body', unsubscribeUrl: null, signature });
  const mk = renderBroadcastHtml({ bodyText: 'Body', unsubscribeUrl: URL_, signature });
  const footerStart = mk.indexOf('<hr');
  assert.ok(footerStart > -1, 'marketing render must carry an <hr> footer');
  // lastIndexOf, not indexOf. The signature block is itself a <div>, so the
  // FIRST '</div>' is now the signature's own closing tag rather than the
  // wrapper's — the older CONTROL test above gets away with indexOf only
  // because it passes no signature. Slicing at the first close silently
  // compared two truncated strings and reported a difference that was not
  // there.
  assert.equal(
    mk.slice(0, footerStart).trim(),
    tx.slice(0, tx.lastIndexOf('</div>')).trim(),
    'signature must render identically in both classes',
  );
});

test('the signature sits ABOVE the unsubscribe rule, not below it', () => {
  const html = renderBroadcastHtml({
    bodyText: 'Body',
    unsubscribeUrl: URL_,
    signature: 'Emmanuel',
  });
  assert.ok(html.indexOf('Emmanuel') < html.indexOf('<hr'), 'signature must precede the <hr>');
});

test('the signature is escaped — it is compose-form input, not a constant we own', () => {
  // UNSUBSCRIBE_SENTENCE is deliberately emitted unescaped because this module
  // owns it. The signature is typed by a human into a form, so it gets the same
  // treatment as bodyText. The cost is that it cannot carry its own markup.
  const html = renderBroadcastHtml({
    bodyText: 'Body',
    unsubscribeUrl: null,
    signature: '<script>alert(1)</script> & "q"',
  });
  assert.ok(!html.includes('<script>'), 'raw script tag survived into the signature');
  assert.ok(html.includes('&lt;script&gt;'), 'signature must be escaped');
  assert.ok(html.includes('&amp;'), 'ampersand must be escaped');
});

test('absent, blank and whitespace-only all fall back to DEFAULT_SIGNATURE', () => {
  // INVERTED, not deleted. This test used to assert that a blank signature
  // emitted nothing, which was the silent failure being removed: an empty
  // compose box sent 96 owners an unsigned email and looked identical to a
  // signed one from the sender's side.
  //
  // It is worth knowing HOW the old version survived the change and stayed
  // green. It compared a no-signature render against a blank-signature render.
  // Once the default was always emitted, both sides carried it, so the two
  // strings matched and the assertion passed — while its name went on
  // documenting the rule that had just been removed. A green test asserting
  // the wrong thing is worse than a red one, because nobody re-reads it.
  //
  // The fix is to assert on CONTENT, not on two renders being equal to each
  // other. Equality between two outputs can be satisfied by both being wrong.
  for (const signature of [undefined, null, '', '   ', '\n\n']) {
    const html = renderBroadcastHtml({ bodyText: 'Body', unsubscribeUrl: null, signature });
    const text = renderBroadcastText({ bodyText: 'Body', unsubscribeUrl: null, signature });
    assert.ok(
      html.includes('Emmanuel Forkuoh'),
      `signature ${JSON.stringify(signature)} must fall back to the default`,
    );
    for (const rendered of [html, text]) {
      assert.equal(
        rendered.replace(/\D/g, '').includes('5615718725'),
        false,
        'rendered default signature must not contain 5615718725',
      );
    }
    assert.ok(html.includes('support@jointidywise.com'), 'email line must survive the fallback');
  }
});

test('plain-text carries the signature, ordered body then signature then unsubscribe', () => {
  const text = renderBroadcastText({
    bodyText: 'Body',
    unsubscribeUrl: URL_,
    signature: 'Emmanuel',
  });
  assert.ok(text.indexOf('Body') < text.indexOf('Emmanuel'), 'signature must follow the body');
  assert.ok(text.indexOf('Emmanuel') < text.indexOf('---'), 'signature must precede the separator');
  const noUrl = renderBroadcastText({ bodyText: 'Body', unsubscribeUrl: null, signature: 'Emmanuel' });
  assert.equal(noUrl, 'Body\n\nEmmanuel');
});

test('a signature over the cap is a validation error; absent is not', () => {
  const over = validateBroadcastInput({
    subject: 'S', bodyText: 'B', messageClass: 'transactional',
    signature: 'x'.repeat(MAX_SIGNATURE + 1),
  });
  assert.equal(over.ok, false);
  assert.ok(over.errors.some((e) => e.includes('signature')), 'must name the field');

  const absent = validateBroadcastInput({ subject: 'S', bodyText: 'B', messageClass: 'transactional' });
  assert.equal(absent.ok, true, 'a broadcast with no signature is valid');

  const atCap = validateBroadcastInput({
    subject: 'S', bodyText: 'B', messageClass: 'transactional',
    signature: 'x'.repeat(MAX_SIGNATURE),
  });
  assert.equal(atCap.ok, true, 'exactly at the cap is allowed — off-by-one guard');
});

test('there is NO input that produces an unsigned broadcast', () => {
  // The whole point of hardcoding. If any of these ever renders without the
  // default, the silent-unsigned-send hole is open again. Both classes, both
  // renderers, every falsy and whitespace shape.
  for (const signature of [undefined, null, '', '   ', '\t', '\n', '\n \n']) {
    for (const unsubscribeUrl of [null, URL_]) {
      const html = renderBroadcastHtml({ bodyText: 'B', unsubscribeUrl, signature });
      const text = renderBroadcastText({ bodyText: 'B', unsubscribeUrl, signature });
      assert.ok(html.includes('Emmanuel Forkuoh'), `html unsigned for ${JSON.stringify(signature)}`);
      assert.ok(text.includes('Emmanuel Forkuoh'), `text unsigned for ${JSON.stringify(signature)}`);
    }
  }
});

test('a stored signature wins over the default, and the default disappears', () => {
  // Old broadcasts must re-render as they were sent, so a row carrying a value
  // is authoritative. Asserting the default is ABSENT matters as much as
  // asserting the stored one is present — an implementation that appended both
  // would satisfy a naive "contains the stored text" check.
  const stored = 'Someone Else\nOld Title\n555-0000';
  for (const render of [renderBroadcastHtml, renderBroadcastText]) {
    const out = render({ bodyText: 'Body', unsubscribeUrl: null, signature: stored });
    assert.ok(out.includes('Someone Else'), 'stored signature must appear');
    assert.ok(!out.includes('Emmanuel Forkuoh'), 'default must not also appear');
    assert.ok(!out.includes('support@jointidywise.com'), 'default email must not leak in');
  }
});

test('resolveSignature: the fallback rule in isolation', () => {
  assert.equal(resolveSignature(undefined), defaultSignatureText());
  assert.equal(resolveSignature(null), defaultSignatureText());
  assert.equal(resolveSignature(''), defaultSignatureText());
  assert.equal(resolveSignature('   '), defaultSignatureText());
  assert.equal(resolveSignature('Real'), 'Real');
});

test('DEFAULT_SIGNATURE holds every field the renderer needs', () => {
  assert.deepEqual(DEFAULT_SIGNATURE, {
    name: 'Emmanuel Forkuoh',
    linkedInUrl: 'https://www.linkedin.com/in/emmanuel-forkuoh-567724145/',
    title: 'Founder, TidyWise',
    email: 'support@jointidywise.com',
  });
  // The tracking suffix was stripped from the URL deliberately; assert it stays
  // stripped, since pasting a fresh LinkedIn link is how it comes back.
  assert.ok(!DEFAULT_SIGNATURE.linkedInUrl.includes('?trk='), 'tracking suffix must not return');
});

test('defaultSignatureText flattens to three lines, URL bare on the first, with no phone', () => {
  assert.deepEqual(defaultSignatureText().split('\n'), [
    'Emmanuel Forkuoh \u2022 https://www.linkedin.com/in/emmanuel-forkuoh-567724145/',
    'Founder, TidyWise',
    'support@jointidywise.com',
  ]);
  assert.equal('phone' in DEFAULT_SIGNATURE, false, 'default signature must not carry a phone');
});

test('the default is still escaped, and still sits above the <hr>', () => {
  const html = renderBroadcastHtml({ bodyText: 'Body', unsubscribeUrl: URL_ });
  assert.ok(html.indexOf('Emmanuel Forkuoh') < html.indexOf('<hr'), 'signature must precede the rule');
  assert.ok(
    html.includes('<p style="margin:0 0 16px;line-height:1.6">Emmanuel Forkuoh'),
    'default must render through paragraphs(), not raw interpolation',
  );
});

test('the default renders a real LinkedIn anchor in HTML', () => {
  const html = renderBroadcastHtml({ bodyText: 'Body', unsubscribeUrl: null });
  assert.ok(
    html.includes('<a href="https://www.linkedin.com/in/emmanuel-forkuoh-567724145/"'),
    'the href must be the bare profile URL',
  );
  assert.ok(html.includes('>LinkedIn</a>'), 'LinkedIn must be the anchor text');
  assert.ok(html.includes('Emmanuel Forkuoh \u2022 <a href='), 'name, bullet, then the anchor');
  assert.ok(!html.includes('?trk='), 'the tracking suffix must never render');
});

test('plain text gets the bare URL and no markup at all', () => {
  const text = renderBroadcastText({ bodyText: 'Body', unsubscribeUrl: null });
  assert.ok(text.includes('https://www.linkedin.com/in/emmanuel-forkuoh-567724145/'), 'bare URL');
  assert.ok(!text.includes('<a'), 'anchors do not exist in text/plain');
  assert.ok(!text.includes('</a>'), 'no closing tag either');
});

test('a stored signature NEVER produces markup, anchor or otherwise', () => {
  // The reason the default is structured rather than exempt from escaping. If
  // this ever passes markup through, the carve-out has leaked to the untrusted
  // path and a stored signature_text becomes an injection vector.
  const hostile = 'Someone <a href="https://evil.test">Click</a> <b>bold</b>';

  const html = renderBroadcastHtml({ bodyText: 'Body', unsubscribeUrl: null, signature: hostile });
  assert.ok(!html.includes('<a href="https://evil.test"'), 'stored anchor must not survive as markup');
  assert.ok(!html.includes('<b>'), 'stored bold must not survive as markup');
  assert.ok(html.includes('&lt;a href='), 'escaped, not stripped — the reader still sees what was typed');

  // text/plain has no markup to neutralise: angle brackets there are just
  // characters, and escaping them would render "&lt;" to the recipient. The
  // assertion that matters in this alternative is only that the default does
  // not appear alongside a stored signature.
  const text = renderBroadcastText({ bodyText: 'Body', unsubscribeUrl: null, signature: hostile });
  assert.ok(text.includes(hostile), 'plain text passes the stored value through verbatim');

  for (const out of [html, text]) {
    assert.ok(!out.includes('linkedin.com'), 'the default must not appear alongside a stored one');
  }
});

test('the Deno copy behaves identically', async () => {
  // src/lib/broadcast-render.ts is canonical and tested here; the edge
  // functions run in Deno and cannot import from src/, so
  // supabase/functions/_shared/broadcast-render.ts is a verbatim copy below
  // its header. Same arrangement as phone.ts and automation-templates.
  //
  // THIS TEST FAILS UNTIL THE LOVABLE PASTE IS APPLIED. That is the point: it
  // is the red half of Task 4, and it goes green when the Deno copy lands.
  const shared = await import('../../supabase/functions/_shared/broadcast-render.ts');

  const bodies = ['plain', "it's <b>x</b> & y", 'One\n\nTwo', '', '   '];
  const urls: (string | null)[] = [null, URL_];
  // The signature dimension is not decoration. This test only catches drift on
  // inputs it actually exercises — it is a behavioural comparison, not a digest
  // of the two files — so an unexercised parameter is an unguarded one. Absent,
  // null, blank, whitespace-only, multi-line and escaping-sensitive are the
  // shapes where two hand-copied implementations realistically diverge.
  const signatures: (string | null | undefined)[] = [
    undefined,
    null,
    '',
    '   ',
    'Emmanuel',
    'Emmanuel\nTidyWise\nsupport@jointidywise.com',
    'Emmanuel\n\nTidyWise',
    "O'Brien & <Sons>",
  ];

  assert.equal(shared.UNSUBSCRIBE_SENTENCE, UNSUBSCRIBE_SENTENCE, 'constant diverges');
  assert.equal(shared.MAX_SIGNATURE, MAX_SIGNATURE, 'MAX_SIGNATURE diverges');
  // Asserted directly, not only through rendered output. The matrix below would
  // catch a drifted default too, but it would report "renderBroadcastHtml
  // diverges on [...]" and send you reading the renderer instead of the one
  // character that actually differs. Without this, the two copies agree only by
  // luck of whoever last edited them both.
  // deepEqual now that the constant is structured. assert.equal would compare
  // object identity across two module instances and pass for everything.
  assert.deepEqual(
    shared.DEFAULT_SIGNATURE, DEFAULT_SIGNATURE,
    'DEFAULT_SIGNATURE diverges — the two senders would sign with different text',
  );
  assert.equal(
    shared.defaultSignatureText(), defaultSignatureText(),
    'defaultSignatureText diverges',
  );
  for (const probe of [undefined, null, '', '   ', 'Stored']) {
    assert.equal(
      shared.resolveSignature(probe), resolveSignature(probe),
      `resolveSignature diverges on ${JSON.stringify(probe)}`,
    );
  }

  for (const bodyText of bodies) {
    for (const unsubscribeUrl of urls) {
      for (const signature of signatures) {
        const where = JSON.stringify([bodyText, unsubscribeUrl, signature]);
        assert.equal(
          shared.renderBroadcastHtml({ bodyText, unsubscribeUrl, signature }),
          renderBroadcastHtml({ bodyText, unsubscribeUrl, signature }),
          `renderBroadcastHtml diverges on ${where}`,
        );
        assert.equal(
          shared.renderBroadcastText({ bodyText, unsubscribeUrl, signature }),
          renderBroadcastText({ bodyText, unsubscribeUrl, signature }),
          `renderBroadcastText diverges on ${where}`,
        );
      }
    }
  }

  for (const messageClass of ['transactional', 'marketing', 'promo', undefined]) {
    for (const signature of [undefined, '', 'ok', 'x'.repeat(MAX_SIGNATURE + 1)]) {
      assert.deepEqual(
        shared.validateBroadcastInput({ subject: 'S', bodyText: 'B', messageClass, signature }),
        validateBroadcastInput({ subject: 'S', bodyText: 'B', messageClass, signature }),
        `validateBroadcastInput diverges on ${JSON.stringify([messageClass, signature])}`,
      );
    }
  }
});
