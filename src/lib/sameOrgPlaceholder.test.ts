import { test } from "node:test";
import assert from "node:assert/strict";
import { placeholderForSameOrg, rowsForCurrentOrg } from "./sameOrgPlaceholder.ts";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";

test("a range change on the same org keeps the previous rows", () => {
  const keep = placeholderForSameOrg<string[]>(ORG_A);
  const previous = ["job"];
  assert.deepEqual(
    keep(previous, { queryKey: ["bookings", "dashboard-chart", ORG_A, "30d"] }),
    previous,
  );
});

test("an org switch drops the previous org's rows", () => {
  const keep = placeholderForSameOrg<string[]>(ORG_B);
  assert.equal(
    keep(["job"], { queryKey: ["bookings", "dashboard-upcoming", ORG_A] }),
    undefined,
  );
});

test("placeholder rows from another org are blocked so the skeleton can show", () => {
  const view = rowsForCurrentOrg(
    [{ organization_id: ORG_A, id: "1" }],
    ORG_B,
    true,
  );
  assert.equal(view.blocked, true);
  assert.deepEqual(view.rows, []);
});

test("placeholder rows from the same org stay on screen", () => {
  const rows = [{ organization_id: ORG_A, id: "1" }];
  const view = rowsForCurrentOrg(rows, ORG_A, true);
  assert.equal(view.blocked, false);
  assert.deepEqual(view.rows, rows);
});
