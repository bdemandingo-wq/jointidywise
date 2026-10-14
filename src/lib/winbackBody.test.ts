import { test } from "node:test";
import assert from "node:assert/strict";
import {
  winbackParagraphHtml,
  winbackTemplateHasMarkup,
} from "../../supabase/functions/_shared/winbackBody.ts";

const PLAIN = "It's been a month since we last cleaned your home.";

test("shipped win-back copy is plain text, so the whole paragraph is escaped", () => {
  assert.equal(winbackTemplateHasMarkup(PLAIN), false);
  assert.equal(
    winbackParagraphHtml(PLAIN, `Hi <Ada> & Co`),
    "Hi &lt;Ada&gt; &amp; Co",
  );
});

test("a template with a link keeps the tag and the caller-escaped name", () => {
  const template = `<a href="https://example.com/book">Book</a> {customer_name}`;
  assert.equal(winbackTemplateHasMarkup(template), true);
  const resolved = `<a href="https://example.com/book">Book</a> &lt;Ada&gt;`;
  assert.equal(winbackParagraphHtml(template, resolved), resolved);
});
