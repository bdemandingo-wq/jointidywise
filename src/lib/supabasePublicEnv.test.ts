// node --experimental-strip-types --test src/lib/supabasePublicEnv.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { SUPABASE_PUBLIC_ANON_KEY, SUPABASE_PUBLIC_URL } from "./supabasePublicEnv.ts";

test("node can load the public supabase env when import.meta.env is absent", () => {
  assert.equal(SUPABASE_PUBLIC_URL, "https://slwfkaqczvwvvvavkgpr.supabase.co");
  assert.ok(SUPABASE_PUBLIC_ANON_KEY.startsWith("eyJ"));
});
