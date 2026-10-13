import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertGeneratedBlog,
  blogOutputLooksTruncated,
  describeJsonFailure,
  parseModelJson,
} from "./blogJson.ts";

const LONG_HTML = `<h2>Rates</h2><p>${"Owners price a recurring clean from the square footage, then add a minimum so a studio does not pay the same per foot as a house. ".repeat(8)}</p>`;

function blog(content: string) {
  return {
    title: "House cleaning price per square foot",
    slug: "house-cleaning-price-per-square-foot",
    excerpt: "How owners set a rate card.",
    content,
    meta_title: "Price per square foot",
    meta_description: "A rate card for maid service owners.",
    secondary_keywords: ["maid service rates"],
    faq: [{ question: "What is a fair minimum?", answer: "Set one before the per-foot math." }],
  };
}

test("repairs unescaped quotes inside HTML attributes", () => {
  const broken = `{"title":"House cleaning price per square foot","slug":"sqft","excerpt":"Rates.","content":"<p>See <a href="https://jointidywise.com/pricing">pricing</a>. ${"More detail. ".repeat(40)}</p>","meta_title":"Sqft rates","meta_description":"How to price.","secondary_keywords":["rates"],"faq":[{"question":"Why a minimum?","answer":"Small homes otherwise look too cheap."}]}`;
  assert.throws(() => JSON.parse(broken), /Expected ',' or '}'/);
  const parsed = parseModelJson(broken) as { content: string };
  assert.match(parsed.content, /href="https:\/\/jointidywise.com\/pricing"/);
  assert.equal(assertGeneratedBlog(parsed).faq[0].question, "Why a minimum?");
});

test("repairs a raw newline inside a string", () => {
  const broken = `{"title":"Hiring","slug":"hiring","excerpt":"A checklist.","content":"<p>Line one.\nLine two. ${"Train on site. ".repeat(40)}</p>","meta_title":"Hiring","meta_description":"How to hire.","secondary_keywords":[],"faq":[]}`;
  assert.throws(() => JSON.parse(broken));
  const parsed = parseModelJson(broken) as { content: string };
  assert.match(parsed.content, /Line one\.\nLine two\./);
});

test("strips a markdown fence and trailing commas", () => {
  const payload = `{
    "title": "House cleaning price per square foot",
    "slug": "sqft",
    "excerpt": "Rates.",
    "content": ${JSON.stringify(LONG_HTML)},
    "meta_title": "Sqft",
    "meta_description": "Rates.",
    "secondary_keywords": ["rates",],
    "faq": [{"question": "Q", "answer": "A",},],
  }`;
  const parsed = assertGeneratedBlog(parseModelJson("```json\n" + payload + "\n```"));
  assert.equal(parsed.secondary_keywords[0], "rates");
  assert.equal(parsed.faq.length, 1);
});

test("closes a response cut off mid-string and reports the missing fields", () => {
  const truncated = `{"title":"Hiring house cleaners","slug":"hiring","excerpt":"A checklist.","content":"<p>Start with a ride-along`;
  const parsed = parseModelJson(truncated) as { content: string };
  assert.match(parsed.content, /ride-along/);
  assert.throws(
    () => assertGeneratedBlog(parsed),
    /missing or empty fields: meta_title, meta_description/,
  );
});

test("rejects a complete object whose body is only a stub", () => {
  const stub = blog("<p>Too short.</p>");
  assert.throws(() => assertGeneratedBlog(stub), /too short/);
});

test("describeJsonFailure names the position and a nearby snippet", () => {
  const raw = `{"title":"ok"${"x".repeat(20)}`;
  let caught: unknown;
  try { JSON.parse(raw); } catch (err) { caught = err; }
  const message = describeJsonFailure(raw, caught);
  assert.match(message, /Blog JSON parse failed/);
  assert.match(message, /position \d+/);
});

test("an already valid post round-trips", () => {
  const original = blog(LONG_HTML);
  const parsed = assertGeneratedBlog(parseModelJson(JSON.stringify(original)));
  assert.equal(parsed.content, LONG_HTML.trim());
  assert.equal(parsed.secondary_keywords[0], "maid service rates");
});

test("finish_reason length flags an unclosed HTML body", () => {
  const post = assertGeneratedBlog(blog(LONG_HTML.replace(/<\/p>$/, "")));
  const message = blogOutputLooksTruncated(post, "length", 20000);
  assert.match(message ?? "", /max_tokens=20000/);
  assert.equal(blogOutputLooksTruncated(assertGeneratedBlog(blog(LONG_HTML)), "length", 20000), null);
  assert.equal(blogOutputLooksTruncated(assertGeneratedBlog(blog(LONG_HTML.replace(/<\/p>$/, ""))), "tool_calls", 20000), null);
});
