import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { isPhoneOptedOut, phoneOptOutStatus } from "./marketing-guard.ts";

const ORG = "org-1";
const OTHER_ORG = "org-2";

interface Row {
  id: string;
  phone: string | null;
  marketing_status: string | null;
  opted_out_method: string | null;
  organization_id: string;
}

function mockDb(opts: { customers?: Row[]; customersError?: string }) {
  const supabase = {
    from(table: string) {
      const filters: Record<string, string> = {};
      const api = {
        select() { return api; },
        eq(column: string, value: string) {
          filters[column] = value;
          return api;
        },
        not() { return api; },
        order() { return api; },
        range() { return api; },
        maybeSingle() {
          return Promise.resolve({ data: null, error: null });
        },
        then<T>(onfulfilled: (value: { data: unknown; error: { message?: string } | null }) => T) {
          if (table === "customers") {
            if (opts.customersError) {
              return Promise.resolve({ data: null, error: { message: opts.customersError } }).then(onfulfilled);
            }
            const rows = (opts.customers ?? []).filter((row) => row.organization_id === filters.organization_id);
            return Promise.resolve({ data: rows, error: null }).then(onfulfilled);
          }
          return Promise.resolve({ data: null, error: null }).then(onfulfilled);
        },
      };
      return api;
    },
  };
  return supabase;
}

test("isPhoneOptedOut blocks any opted-out method, matched on the last 10 digits", async () => {
  for (const method of ["email", "manual", "admin", "sms_stop"]) {
    const supabase = mockDb({
      customers: [{
        id: "c1",
        phone: "please call 813.555.0100 today",
        marketing_status: "opted_out",
        opted_out_method: method,
        organization_id: ORG,
      }],
    });
    assert.equal(await isPhoneOptedOut(supabase, ORG, "+1 (813) 555-0100"), true, method);
  }
});

test("isPhoneOptedOut allows a number that is not opted out and ignores another org", async () => {
  const supabase = mockDb({
    customers: [
      {
        id: "c1",
        phone: "8135550100",
        marketing_status: "active",
        opted_out_method: null,
        organization_id: ORG,
      },
      {
        id: "c2",
        phone: "(813) 555-0100",
        marketing_status: "opted_out",
        opted_out_method: "email",
        organization_id: OTHER_ORG,
      },
    ],
  });
  assert.equal(await isPhoneOptedOut(supabase, ORG, "813-555-0100"), false);
  assert.equal(await isPhoneOptedOut(supabase, ORG, "123"), true);
});

test("isPhoneOptedOut fails closed when the lookup errors and is clear when nobody matches", async () => {
  const broken = mockDb({ customersError: "connection reset" });
  assert.equal(await isPhoneOptedOut(broken, ORG, "+18135550100"), true);
  const empty = mockDb({ customers: [] });
  assert.equal(await isPhoneOptedOut(empty, ORG, "+18135550100"), false);
});

test("phoneOptOutStatus blocks an SMS STOP on the last 10 digits and not an email opt-out", async () => {
  const stopped = mockDb({
    customers: [{
      id: "c1",
      phone: "please call 813.555.0100 today",
      marketing_status: "opted_out",
      opted_out_method: "sms_stop",
      organization_id: ORG,
    }],
  });
  assert.equal(await phoneOptOutStatus(stopped, ORG, "18135550100"), "opted_out");

  const email = mockDb({
    customers: [{
      id: "c1",
      phone: "(813) 555-0100",
      marketing_status: "opted_out",
      opted_out_method: "email",
      organization_id: ORG,
    }],
  });
  assert.equal(await phoneOptOutStatus(email, ORG, "+18135550100"), "clear");

  const legacyManual = mockDb({
    customers: [{
      id: "c1",
      phone: "813-555-0100",
      marketing_status: "opted_out",
      opted_out_method: "manual",
      organization_id: ORG,
    }],
  });
  assert.equal(await phoneOptOutStatus(legacyManual, ORG, "+18135550100"), "clear");
});

test("the suppression migration backfills sms_stop and legacy manual rows from before 2026-05-14", () => {
  const sql = readFileSync(
    new URL("../../migrations/20261016180000_sms_suppressions_org_phone_uidx.sql", import.meta.url),
    "utf8",
  );
  const backfill = sql.slice(sql.indexOf("INSERT INTO public.sms_suppressions"));
  assert.match(backfill, /opted_out_method = 'sms_stop'/);
  assert.match(backfill, /opted_out_method = 'manual'/);
  assert.match(backfill, /TIMESTAMPTZ '2026-05-14 00:00:00\+00'/);
  assert.match(backfill, /right\(digits, 10\)/);
  assert.match(backfill, /ON CONFLICT DO NOTHING/);
  assert.doesNotMatch(backfill, /email/);
});
