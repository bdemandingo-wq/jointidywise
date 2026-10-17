import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { SUPPORT_EMAIL } from "../lib/supportEmail.ts";
import { STATIC_ROUTE_META } from "../lib/routeMeta.ts";
import {
  HELP_FAQ_DESCRIPTION,
  HELP_FAQ_H1,
  HELP_FAQ_PATH,
  HELP_FAQ_SECTIONS,
  HELP_FAQ_TITLE,
  helpFaqAnswerText,
  helpFaqEntries,
  helpFaqJsonLd,
  helpFaqPrerenderBody,
} from "./helpFaq.ts";

test("help FAQ route meta is a self-canonical FAQ page", () => {
  const meta = STATIC_ROUTE_META[HELP_FAQ_PATH];
  assert.ok(meta);
  assert.equal(meta.title, "TidyWise Help & FAQ");
  assert.equal(meta.title, HELP_FAQ_TITLE);
  assert.ok(meta.title.length >= 10 && meta.title.length <= 60);
  assert.equal(meta.description, HELP_FAQ_DESCRIPTION);
  assert.ok(meta.description.length >= 50 && meta.description.length <= 160);
  assert.equal(meta.h1, HELP_FAQ_H1);
  assert.equal(meta.canonicalPath, "/help");
  assert.match(meta.prerenderBody ?? "", /How does the free trial work/);
  assert.match(meta.prerenderBody ?? "", new RegExp(`mailto:${SUPPORT_EMAIL}`));

  const jsonLd = meta.jsonLd as { "@type": string; mainEntity: { name: string }[] };
  assert.equal(jsonLd["@type"], "FAQPage");
  assert.equal(jsonLd.mainEntity.length, helpFaqEntries().length);
  assert.deepEqual(
    jsonLd.mainEntity.map((item) => item.name),
    helpFaqEntries().map((entry) => entry.question),
  );
});

test("every approved question is present and the support address is a mailto", () => {
  const questions = helpFaqEntries().map((entry) => entry.question);
  assert.equal(new Set(questions).size, questions.length);
  assert.ok(questions.includes("Need help?"));
  assert.ok(questions.includes("How do my cleaners get paid? (Pro)"));
  assert.equal(HELP_FAQ_SECTIONS.length, 6);

  const html = helpFaqPrerenderBody();
  for (const question of questions) {
    assert.ok(html.includes(question), question);
  }
  assert.match(html, /<h2>Getting started<\/h2>/);
  assert.match(html, /<h2>Team &amp; cleaners<\/h2>/);
  assert.match(html, /<h2>Texts &amp; reminders<\/h2>/);
  assert.match(html, /<details><summary>Need help\?<\/summary>/);
  assert.match(html, new RegExp(`<a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a>`));
  assert.equal(html.includes("tel:"), false);
  assert.equal(/\(\d{3}\)|\d{3}-\d{3}-\d{4}/.test(html), false);

  const needHelp = helpFaqAnswerText(
    helpFaqEntries().find((entry) => entry.question === "Need help?")!,
  );
  assert.match(needHelp, new RegExp(SUPPORT_EMAIL));
  assert.match(needHelp, /tutorial videos under Help in the sidebar/);
});

test("cleaners can use the iPhone App Store app, the Android Google Play app, or a browser", () => {
  const entry = helpFaqEntries().find(
    (item) => item.question === "How do my cleaners get the app and sign in?",
  );
  assert.ok(entry);
  const text = helpFaqAnswerText(entry);
  const expected =
    "Cleaners can use the TidyWise app for iPhone (App Store) or Android (Google Play), or any web browser. They sign in at the Staff Portal (jointidywise.com/staff/login) with the email and password you created for them.";
  assert.equal(text, expected);
  assert.equal(text.includes("no Android"), false);
  assert.equal(text.includes("iPhone app or any web browser"), false);

  const html = helpFaqPrerenderBody();
  assert.match(
    html,
    /Cleaners can use the TidyWise app for iPhone \(<a href="https:\/\/apps\.apple\.com\/app\/id6788275014" target="_blank" rel="noopener noreferrer">App Store<\/a>\) or Android \(Google Play\), or any web browser\./,
  );
  assert.equal(html.includes("play.google.com"), false);
  assert.equal(html.includes("no Android app"), false);

  const jsonLd = helpFaqJsonLd() as {
    mainEntity: { name: string; acceptedAnswer: { text: string } }[];
  };
  const answer = jsonLd.mainEntity.find(
    (item) => item.name === "How do my cleaners get the app and sign in?",
  );
  assert.equal(answer?.acceptedAnswer.text, expected);
});

test("the public page and footer point at /help", () => {
  const page = readFileSync(new URL("../pages/HelpFaqPage.tsx", import.meta.url), "utf8");
  const footer = readFileSync(new URL("../components/SiteFooter.tsx", import.meta.url), "utf8");
  const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  assert.match(page, /<details/);
  assert.match(page, /<summary/);
  assert.match(page, /<h2/);
  assert.match(page, /SiteFooter/);
  assert.match(page, /mailto:\$\{SUPPORT_EMAIL\}/);
  assert.match(footer, /to="\/help"/);
  assert.match(footer, /Help & FAQ/);
  assert.match(app, /path="\/help" element=\{<HelpFaqPage/);
  const native = app.slice(app.indexOf("<HashRouter>"), app.indexOf("<BrowserRouter>"));
  assert.match(native, /path="\/help" element=\{<Navigate to="\/login" replace/);
});
