import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { customerPhoneLast10Pattern, isPhoneOptedOut, phoneOptOutStatus } from "./marketing-guard.ts";
import { toE164 } from "./phone.ts";

const ORG = "org-1";
const OTHER_ORG = "org-2";

interface Row {
  id: string;
  phone: string | null;
  marketing_status: string | null;
  opted_out_method: string | null;
  organization_id: string;
}

function last10(phone: string | null): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
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
        filter(column: string, op: string, value: string) {
          if (column === "phone" && op === "match") filters.phoneMatch = value;
          return api;
        },
        not() { return api; },
        order() { return api; },
        limit() { return api; },
        range() { return api; },
        maybeSingle() {
          return Promise.resolve({ data: null, error: null });
        },
        then<T>(onfulfilled: (value: { data: unknown; error: { message?: string } | null }) => T) {
          if (table === "customers") {
            if (opts.customersError) {
              return Promise.resolve({ data: null, error: { message: opts.customersError } }).then(onfulfilled);
            }
            const rows = (opts.customers ?? []).filter((row) => {
              if (row.organization_id !== filters.organization_id) return false;
              if (filters.marketing_status && row.marketing_status !== filters.marketing_status) return false;
              if (filters.opted_out_method && row.opted_out_method !== filters.opted_out_method) return false;
              if (filters.phoneMatch && !new RegExp(filters.phoneMatch).test(row.phone ?? "")) return false;
              if (filters.phone_match_key && last10(row.phone) !== filters.phone_match_key) return false;
              return true;
            });
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

/** The CASE in public.to_e164, kept next to toE164 so the two cannot drift. */
function migrationToE164(raw: string | null | undefined): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length === 10 && /^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return `+1${digits}`;
  if (
    digits.length === 11 &&
    digits.startsWith("1") &&
    /^[2-9]\d{2}[2-9]\d{6}$/.test(digits.slice(1))
  ) {
    return `+${digits}`;
  }
  if (
    digits.length >= 11 &&
    digits.length <= 15 &&
    !digits.startsWith("0") &&
    !(digits.length === 11 && digits.startsWith("1"))
  ) {
    return `+${digits}`;
  }
  return null;
}

test("public.to_e164 matches toE164, including international numbers", () => {
  const cases = [
    "8135550100",
    "+1 (813) 555-0100",
    "18135550100",
    "447955512345",
    "+447955512345",
    "61475442420",
    "+610459046970",
    "1115550100",
    "00000000000",
    "123",
    "",
  ];
  for (const raw of cases) {
    assert.equal(migrationToE164(raw), toE164(raw), raw);
  }
  assert.equal(toE164("447955512345"), "+447955512345");
});

test("the last-10 phone pattern matches stored forms and not a different tail", () => {
  const pattern = new RegExp(customerPhoneLast10Pattern("8135550100"));
  for (const phone of [
    "8135550100",
    "+1 (813) 555-0100",
    "1-813-555-0100",
    "please call 813.555.0100 today",
    "18135550100",
  ]) {
    assert.equal(pattern.test(phone), true, phone);
  }
  assert.equal(pattern.test("447955512345"), false);
  assert.equal(pattern.test("81355501001"), false);
});

test("the suppression migration backfills sms_stop customers and inbound STOP history", () => {
  const sql = readFileSync(
    new URL("../../migrations/20261016180000_sms_suppressions_org_phone_uidx.sql", import.meta.url),
    "utf8",
  );
  const fnStart = sql.indexOf("CREATE OR REPLACE FUNCTION public.to_e164");
  const fnEnd = sql.indexOf("$$;", fnStart);
  const fn = sql.slice(fnStart, fnEnd);
  assert.match(fn, /length\(digits\) = 10/);
  assert.doesNotMatch(fn, /right\(digits, 10\)/);
  const backfill = sql.slice(sql.indexOf("INSERT INTO public.sms_suppressions"));
  assert.match(backfill, /opted_out_method = 'sms_stop'/);
  assert.doesNotMatch(backfill, /opted_out_method = 'manual'/);
  assert.doesNotMatch(backfill, /2026-05-14/);
  assert.match(backfill, /public\.sms_messages/);
  assert.match(backfill, /public\.to_e164/);
  assert.match(backfill, /'STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'/);
  assert.match(backfill, /'START', 'UNSTOP'/);
  assert.match(backfill, /source\)\s*\nSELECT/);
  assert.match(backfill, /ON CONFLICT DO NOTHING/);
  assert.equal(backfill.match(/ON CONFLICT DO NOTHING/g)?.length, 2);
});
