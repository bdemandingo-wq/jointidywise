// customer.subscription.deleted must not downgrade Lifetime orgs, and must
// still downgrade a normal cancel.
//
// Runner:
//   node --experimental-strip-types --test supabase/functions/_shared/subscription-deleted-plan.test.ts
//
// The client is in-memory and applies the filters the helper chains, with
// SQL null semantics. Nothing here constructs a Stripe client, calls fetch,
// or sends email or SMS.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readFileSync } from "node:fs";
import {
  cascadeCancelAdSubscriptionsIfDowngraded,
  downgradeOrgOnSubscriptionDeleted,
  type AdCascadeEffects,
  type PlanDowngradeClient,
  type PlanDowngradeResult,
  type PlanDowngradeUpdate,
} from "./subscription-deleted-plan.ts";

type Org = {
  id: string;
  plan_type: string | null;
  grandfathered_lifetime: boolean | null;
};

type Clause = { column: string; op: string; value: string };

class MemoryUpdate implements PlanDowngradeUpdate {
  private readonly andClauses: Clause[] = [];
  /** Each entry is one .or() call: clauses inside a group are OR'd. */
  private readonly orGroups: Clause[][] = [];
  private readonly orgs: Org[];
  private readonly values: { plan_type: "free" };

  constructor(orgs: Org[], values: { plan_type: "free" }) {
    this.orgs = orgs;
    this.values = values;
  }

  eq(column: string, value: string): this {
    this.andClauses.push({ column, op: "eq", value });
    return this;
  }

  neq(column: string, value: string): this {
    this.andClauses.push({ column, op: "neq", value });
    return this;
  }

  or(filters: string): this {
    const group: Clause[] = [];
    for (const part of filters.split(",")) {
      const trimmed = part.trim();
      const pieces = trimmed.split(".");
      if (pieces.length < 3) throw new Error(`unrecognised or() clause: ${trimmed}`);
      const [column, op, ...rest] = pieces;
      group.push({ column, op, value: rest.join(".") });
    }
    if (group.length === 0) throw new Error("empty or()");
    this.orGroups.push(group);
    return this;
  }

  select(_columns: string): Promise<PlanDowngradeResult> {
    const matched = this.orgs.filter((row) => this.matches(row));
    for (const row of matched) row.plan_type = this.values.plan_type;
    return Promise.resolve({
      data: matched.map((row) => ({ id: row.id })),
      error: null,
    });
  }

  private matches(row: Org): boolean {
    if (!this.andClauses.every((clause) => matchClause(row, clause))) return false;
    return this.orGroups.every((group) => group.some((clause) => matchClause(row, clause)));
  }
}

function matchClause(row: Org, clause: Clause): boolean {
  const cell = row[clause.column as keyof Org];
  if (clause.op === "is" && clause.value === "null") return cell == null;
  if (clause.op === "eq") return cell === literal(clause.value);
  if (clause.op === "neq") {
    // NULL <> x is unknown, so PostgREST excludes the row.
    if (cell == null) return false;
    return cell !== literal(clause.value);
  }
  throw new Error(`unrecognised filter ${clause.column}.${clause.op}.${clause.value}`);
}

function literal(value: string): string | boolean | null {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  return value;
}

function memoryOrganizations(orgs: Org[]): PlanDowngradeClient & { orgs: Org[] } {
  const client: PlanDowngradeClient = {
    from(table: string) {
      if (table !== "organizations") throw new Error(`unexpected table ${table}`);
      return {
        update(values: { plan_type: "free" }) {
          return new MemoryUpdate(orgs, values);
        },
      };
    },
  };
  return Object.assign(client, { orgs });
}

/**
 * Fail the test if the downgrade reaches the network. Stripe and OpenPhone
 * both go through fetch; this path must not.
 */
async function offline<T>(fn: () => Promise<T>): Promise<T> {
  const previous = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    return new Response("blocked", { status: 599 });
  };
  try {
    const result = await fn();
    assert.deepEqual(calls, [], "downgrade made a network call (Stripe or a send)");
    return result;
  } finally {
    globalThis.fetch = previous;
  }
}

describe("customer.subscription.deleted plan downgrade", { concurrency: 1 }, () => {
  test("a Lifetime org stays Lifetime when its old subscription is deleted", async () => {
    const store = memoryOrganizations([
      { id: "lifetime-plan", plan_type: "lifetime", grandfathered_lifetime: false },
      { id: "lifetime-null-flag", plan_type: "lifetime", grandfathered_lifetime: null },
      { id: "grandfathered", plan_type: "pro", grandfathered_lifetime: true },
      { id: "both", plan_type: "lifetime", grandfathered_lifetime: true },
    ]);

    await offline(async () => {
      for (const id of ["lifetime-plan", "lifetime-null-flag", "grandfathered", "both"]) {
        const result = await downgradeOrgOnSubscriptionDeleted(store, id);
        assert.equal(result.error, null);
        assert.equal(result.downgraded, false, id);
      }
    });

    assert.equal(store.orgs.find((row) => row.id === "lifetime-plan")?.plan_type, "lifetime");
    assert.equal(store.orgs.find((row) => row.id === "lifetime-null-flag")?.plan_type, "lifetime");
    assert.equal(store.orgs.find((row) => row.id === "grandfathered")?.plan_type, "pro");
    assert.equal(store.orgs.find((row) => row.id === "grandfathered")?.grandfathered_lifetime, true);
    assert.equal(store.orgs.find((row) => row.id === "both")?.plan_type, "lifetime");
  });

  test("a normal cancel still drops to free", async () => {
    const store = memoryOrganizations([
      { id: "standard", plan_type: "standard", grandfathered_lifetime: false },
      { id: "null-flag", plan_type: "pro", grandfathered_lifetime: null },
      { id: "untouched", plan_type: "pro", grandfathered_lifetime: false },
    ]);

    await offline(async () => {
      const standard = await downgradeOrgOnSubscriptionDeleted(store, "standard");
      const nullFlag = await downgradeOrgOnSubscriptionDeleted(store, "null-flag");
      assert.equal(standard.error, null);
      assert.equal(standard.downgraded, true);
      assert.equal(nullFlag.error, null);
      assert.equal(nullFlag.downgraded, true);
    });

    assert.equal(store.orgs.find((row) => row.id === "standard")?.plan_type, "free");
    assert.equal(store.orgs.find((row) => row.id === "null-flag")?.plan_type, "free");
    assert.equal(store.orgs.find((row) => row.id === "untouched")?.plan_type, "pro");
  });

  test("control: an unguarded update still downgrades a Lifetime org", async () => {
    const store = memoryOrganizations([
      { id: "lifetime-plan", plan_type: "lifetime", grandfathered_lifetime: true },
    ]);
    const { data, error } = await store
      .from("organizations")
      .update({ plan_type: "free" })
      .eq("id", "lifetime-plan")
      .select("id");
    assert.equal(error, null);
    assert.equal(data?.length, 1);
    assert.equal(store.orgs[0].plan_type, "free");
  });

  test("a Lifetime org's ad subscriptions stay active, and a normal org's are cancelled", async () => {
    const orgs: Org[] = [
      { id: "lifetime", plan_type: "lifetime", grandfathered_lifetime: false },
      { id: "grandfathered", plan_type: "pro", grandfathered_lifetime: true },
      { id: "standard", plan_type: "standard", grandfathered_lifetime: false },
    ];
    const ads: AdSub[] = [
      ad("lifetime", "sub_life", "active"),
      ad("grandfathered", "sub_gf", "active"),
      ad("standard", "sub_std", "active"),
      ad("standard", "sub_old", "cancelled"),
    ];
    const store = memoryBilling(orgs, ads);
    const stripeCancels: string[] = [];
    const notices: number[] = [];
    const effects: AdCascadeEffects = {
      cancelStripeSubscription: async (stripeSubscriptionId) => {
        stripeCancels.push(stripeSubscriptionId);
      },
      notifyAdmin: async (activeCount) => {
        notices.push(activeCount);
      },
    };

    await offline(async () => {
      for (const id of ["lifetime", "grandfathered", "standard"]) {
        const result = await downgradeOrgOnSubscriptionDeleted(store, id);
        await cascadeCancelAdSubscriptionsIfDowngraded(store, id, result.downgraded, effects);
      }
    });

    assert.deepEqual(stripeCancels, ["sub_std"]);
    assert.deepEqual(notices, [1]);
    assert.equal(ads.find((row) => row.stripe_subscription_id === "sub_life")?.status, "active");
    assert.equal(ads.find((row) => row.stripe_subscription_id === "sub_gf")?.status, "active");
    assert.equal(ads.find((row) => row.stripe_subscription_id === "sub_gf")?.cancelled_at, null);
    const standardAd = ads.find((row) => row.stripe_subscription_id === "sub_std");
    assert.equal(standardAd?.status, "cancelled");
    assert.equal(standardAd?.cancellation_reason, "tidywise_subscription_cancelled");
    assert.equal(typeof standardAd?.cancelled_at, "string");
    assert.equal(ads.find((row) => row.stripe_subscription_id === "sub_old")?.cancellation_reason, null);
    assert.equal(orgs.find((row) => row.id === "lifetime")?.plan_type, "lifetime");
    assert.equal(orgs.find((row) => row.id === "grandfathered")?.plan_type, "pro");
    assert.equal(orgs.find((row) => row.id === "standard")?.plan_type, "free");
  });

  test("subscription.deleted uses the guarded downgrade", () => {
    const source = readFileSync(
      new URL("../stripe-invoice-webhook/index.ts", import.meta.url),
      "utf8",
    );
    const start = source.indexOf('if (event.type === "customer.subscription.deleted")');
    const end = source.indexOf('if (event.type === "invoice.payment_failed")', start);
    assert.ok(start >= 0 && end > start, "subscription.deleted branch not found");
    const branch = source.slice(start, end);
    assert.match(branch, /downgradeOrgOnSubscriptionDeleted\(/);
    assert.equal(branch.includes('.update({ plan_type: "free" })'), false);

    const reverted = branch.indexOf("org reverted to free");
    const unchanged = branch.indexOf("left plan unchanged");
    const cascade = branch.indexOf("cascadeCancelAdSubscriptionsIfDowngraded");
    const stripeCancel = branch.indexOf("stripe.subscriptions.cancel");
    assert.ok(reverted >= 0 && unchanged > reverted, "downgrade logs missing");
    assert.ok(
      cascade > reverted && cascade < unchanged,
      "ad cancel must run only when the org was downgraded",
    );
    assert.ok(stripeCancel > reverted && stripeCancel < unchanged);
    assert.equal(branch.slice(unchanged).includes("cascadeCancelAdSubscriptionsIfDowngraded"), false);
    assert.equal(branch.slice(unchanged).includes("stripe.subscriptions.cancel"), false);
  });
});

type AdSub = {
  organization_id: string;
  stripe_subscription_id: string;
  platform: string;
  status: string;
  cancelled_at: string | null;
  cancellation_reason: string | null;
};

function ad(organizationId: string, stripeSubscriptionId: string, status: string): AdSub {
  return {
    organization_id: organizationId,
    stripe_subscription_id: stripeSubscriptionId,
    platform: "google",
    status,
    cancelled_at: null,
    cancellation_reason: null,
  };
}

class AdQuery {
  private readonly filters: { column: string; value: unknown }[] = [];
  private readonly ads: AdSub[];
  private readonly patch: Partial<AdSub> | null;

  constructor(ads: AdSub[], patch: Partial<AdSub> | null) {
    this.ads = ads;
    this.patch = patch;
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ column, value });
    return this;
  }

  then(
    resolve: (value: { data: AdSub[] | null; error: null }) => unknown,
    reject?: (reason: unknown) => unknown,
  ): Promise<unknown> {
    const matched = this.ads.filter((row) =>
      this.filters.every((filter) => row[filter.column as keyof AdSub] === filter.value),
    );
    if (this.patch) {
      for (const row of matched) Object.assign(row, this.patch);
      return Promise.resolve({ data: null, error: null }).then(resolve, reject);
    }
    return Promise.resolve({
      data: matched.map((row) => ({
        stripe_subscription_id: row.stripe_subscription_id,
        platform: row.platform,
      })),
      error: null,
    }).then(resolve, reject);
  }
}

function memoryBilling(orgs: Org[], ads: AdSub[]) {
  return {
    orgs,
    from(table: string) {
      if (table === "organizations") {
        return {
          update(values: { plan_type: "free" }) {
            return new MemoryUpdate(orgs, values);
          },
        };
      }
      if (table === "ad_management_subscriptions") {
        return {
          select(_columns: string) {
            return new AdQuery(ads, null);
          },
          update(values: Partial<AdSub>) {
            return new AdQuery(ads, values);
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}
