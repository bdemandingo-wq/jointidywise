import assert from "node:assert/strict";
import { test } from "node:test";
import {
  OPENPHONE_MESSAGES_URL,
  sendOpenPhoneMessage,
  type SmsQuery,
  type SmsTable,
} from "./openphone-send.ts";

const ORG = "org-1";
const OTHER_ORG = "org-2";
const E164 = "+18135550100";

interface Row {
  id: string;
  phone: string;
  marketing_status: string | null;
  organization_id: string;
}

function mockDb(opts: {
  customers?: Row[];
  customersError?: string;
}) {
  const fetches: Array<{ url: string; body: { to: string[]; content: string; from: string }; authorization: string }> = [];
  const fetchImpl = async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
    fetches.push({
      url,
      body: JSON.parse(init.body) as { to: string[]; content: string; from: string },
      authorization: init.headers.Authorization,
    });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: { id: "msg_test" } }),
    };
  };

  const supabase = {
    from(table: string): SmsTable {
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
        delete() { return api; },
        upsert() {
          return Promise.resolve({ error: null });
        },
        maybeSingle() {
          return Promise.resolve({ data: null, error: null });
        },
        then<T>(onfulfilled: (value: { data: unknown; error: { message?: string } | null }) => T) {
          if (table === "customers") {
            if (opts.customersError) {
              return Promise.resolve({ data: null, error: { message: opts.customersError } }).then(onfulfilled);
            }
            const rows = (opts.customers ?? []).filter((row) =>
              row.organization_id === filters.organization_id
            );
            return Promise.resolve({ data: rows, error: null }).then(onfulfilled);
          }
          return Promise.resolve({ data: null, error: null }).then(onfulfilled);
        },
      };
      return api as SmsQuery & SmsTable;
    },
  };

  return { supabase, fetchImpl, fetches };
}

const base = {
  organizationId: ORG,
  to: "(813) 555-0100",
  content: "On the way",
  from: "PNtest",
  apiKey: "Bearer secret-key",
  tag: "unit",
};

test("an opted-out customer phone is not sent", async () => {
  const db = mockDb({
    customers: [{
      id: "c1",
      phone: "(813) 555-0100",
      marketing_status: "opted_out",
      organization_id: ORG,
    }],
  });
  const result = await sendOpenPhoneMessage({
    ...base,
    supabase: db.supabase,
    fetchImpl: db.fetchImpl,
  });
  assert.deepEqual(result, { skipped: true, reason: "opted_out" });
  assert.equal(db.fetches.length, 0);
});

test("the same number in another org is still sent", async () => {
  const db = mockDb({
    customers: [{
      id: "c1",
      phone: E164,
      marketing_status: "opted_out",
      organization_id: OTHER_ORG,
    }],
  });
  const result = await sendOpenPhoneMessage({
    ...base,
    supabase: db.supabase,
    fetchImpl: db.fetchImpl,
  });
  assert.equal(result.skipped, false);
  if (result.skipped) return;
  assert.equal(result.response.ok, true);
  assert.equal(db.fetches.length, 1);
  assert.equal(db.fetches[0].url, OPENPHONE_MESSAGES_URL);
  assert.deepEqual(db.fetches[0].body.to, [E164]);
  assert.equal(db.fetches[0].authorization, "secret-key");
});

test("a differently formatted opted-out number blocks a transactional text", async () => {
  const db = mockDb({
    customers: [{
      id: "c1",
      phone: "813-555-0100",
      marketing_status: "opted_out",
      organization_id: ORG,
    }],
  });
  const result = await sendOpenPhoneMessage({
    ...base,
    to: "+1 813 555 0100",
    content: "Your cleaner is on the way",
    supabase: db.supabase,
    fetchImpl: db.fetchImpl,
  });
  assert.deepEqual(result, { skipped: true, reason: "opted_out" });
  assert.equal(db.fetches.length, 0);
});

test("one opted-out record blocks the number even when another record is still opted in", async () => {
  const db = mockDb({
    customers: [
      {
        id: "c1",
        phone: "8135550100",
        marketing_status: "subscribed",
        organization_id: ORG,
      },
      {
        id: "c2",
        phone: "+18135550100",
        marketing_status: "opted_out",
        organization_id: ORG,
      },
    ],
  });
  const result = await sendOpenPhoneMessage({
    ...base,
    supabase: db.supabase,
    fetchImpl: db.fetchImpl,
  });
  assert.deepEqual(result, { skipped: true, reason: "opted_out" });
  assert.equal(db.fetches.length, 0);
});

test("a manual opt-out on the customer row blocks transactional SMS", async () => {
  const db = mockDb({
    customers: [{
      id: "c1",
      phone: "8135550100",
      marketing_status: "opted_out",
      organization_id: ORG,
    }],
  });
  const result = await sendOpenPhoneMessage({
    ...base,
    supabase: db.supabase,
    fetchImpl: db.fetchImpl,
  });
  assert.deepEqual(result, { skipped: true, reason: "opted_out" });
  assert.equal(db.fetches.length, 0);
});

test("the STOP confirmation is delivered to an opted-out number", async () => {
  const db = mockDb({
    customers: [{
      id: "c1",
      phone: E164,
      marketing_status: "opted_out",
      organization_id: ORG,
    }],
  });
  const result = await sendOpenPhoneMessage({
    ...base,
    content: "You're unsubscribed.",
    allowOptedOut: true,
    supabase: db.supabase,
    fetchImpl: db.fetchImpl,
  });
  assert.equal(result.skipped, false);
  assert.equal(db.fetches.length, 1);
  assert.equal(db.fetches[0].body.content, "You're unsubscribed.");
});

test("a lookup error does not send and does not throw", async () => {
  const db = mockDb({ customersError: "connection reset" });
  const result = await sendOpenPhoneMessage({
    ...base,
    supabase: db.supabase,
    fetchImpl: db.fetchImpl,
  });
  assert.equal(result.skipped, false);
  if (result.skipped) return;
  assert.equal(result.response.ok, false);
  assert.equal(await result.response.text(), "opt-out lookup failed");
  assert.equal(db.fetches.length, 0);
});

test("an unusable phone is not sent", async () => {
  const db = mockDb({});
  const result = await sendOpenPhoneMessage({
    ...base,
    to: "123",
    supabase: db.supabase,
    fetchImpl: db.fetchImpl,
  });
  assert.equal(result.skipped, false);
  if (result.skipped) return;
  assert.equal(result.response.ok, false);
  assert.equal(db.fetches.length, 0);
});

test("a number with no customer row is still sent", async () => {
  const db = mockDb({ customers: [] });
  const result = await sendOpenPhoneMessage({
    ...base,
    supabase: db.supabase,
    fetchImpl: db.fetchImpl,
  });
  assert.equal(result.skipped, false);
  assert.equal(db.fetches.length, 1);
});
