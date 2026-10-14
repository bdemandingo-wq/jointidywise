// node --experimental-strip-types --test src/lib/blogLinks.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { hasInternalBrandLink } from "../../supabase/functions/_shared/blogLinks.ts";
import { blogSortTime } from "./blogDates.ts";

test("relative and jointidywise.com links count as a conversion path", () => {
  assert.equal(hasInternalBrandLink('<p><a href="/pricing">Plans</a></p>'), true);
  assert.equal(
    hasInternalBrandLink('<a href="https://jointidywise.com/features/scheduling">Features</a>'),
    true,
  );
  assert.equal(
    hasInternalBrandLink('<a class="x" href="https://www.jointidywise.com/blog/post">Blog</a>'),
    true,
  );
});

test("other hosts do not satisfy the brand link", () => {
  assert.equal(hasInternalBrandLink('<a href="https://evil.com/pricing">x</a>'), false);
  assert.equal(hasInternalBrandLink('<a href="https://jointidywise.com.evil.com/pricing">x</a>'), false);
  assert.equal(hasInternalBrandLink("TidyWise is mentioned with no link"), false);
});

test("a dated post sorts after a month-only label", () => {
  const february = blogSortTime({ dateLabel: "February 2026" });
  const october = blogSortTime({ publishedAt: "2026-10-13T10:00:00.000Z" });
  assert.ok(october > february);
});
