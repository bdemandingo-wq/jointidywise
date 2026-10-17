// node --experimental-strip-types --test src/lib/houseCleaningPriceCalculator.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bedroomPricing,
  cleaningServices,
  extras,
  getSqFtIndexFromValue,
  homeConditionOptions,
} from "../data/pricingData.ts";
import { calculateBasePrice } from "./pricingEngine.ts";
import { getFrequencyDiscountMultiplier } from "./recurringDiscount.ts";
import {
  CALCULATOR_DESCRIPTION,
  CALCULATOR_FAQS,
  CALCULATOR_INPUT_LABELS,
  CALCULATOR_TITLE,
  EXPLAINER_PARAGRAPHS,
  TRIAL_CTA_LABEL,
  buildCalculatorPrerenderBody,
  calculatorJsonLd,
  explainerWordCount,
} from "./houseCleaningCalculatorContent.ts";
import {
  addonHint,
  calculateHouseCleaningQuote,
  visitsPerMonth,
  type HouseCleaningQuoteInput,
} from "./houseCleaningPriceCalculator.ts";

const none = { oven: false, fridge: false, windows: false, laundry: false };

function quote(overrides: Partial<HouseCleaningQuoteInput> & Pick<HouseCleaningQuoteInput, "size">) {
  return calculateHouseCleaningQuote({
    cleanType: "standard_recurring",
    conditionId: 1,
    frequency: "one_time",
    addons: none,
    ...overrides,
  });
}

test("meta title, description length, and explainer length", () => {
  assert.equal(
    CALCULATOR_TITLE,
    "House Cleaning Price Calculator (Free) – What to Charge in 2026",
  );
  assert.ok(CALCULATOR_DESCRIPTION.length >= 50 && CALCULATOR_DESCRIPTION.length <= 160);
  const words = explainerWordCount();
  assert.ok(words >= 600 && words <= 1000, `explainer is ${words} words`);
});

test("prerender body has the explainer, input labels, formula, and FAQ", () => {
  const html = buildCalculatorPrerenderBody();
  assert.ok(html.includes(EXPLAINER_PARAGRAPHS[0].slice(0, 40)));
  for (const label of Object.values(CALCULATOR_INPUT_LABELS)) {
    assert.ok(html.includes(label), label);
  }
  assert.ok(html.includes("Frequently asked questions"));
  assert.ok(html.includes(CALCULATOR_FAQS[0].question));
  assert.ok(html.includes(TRIAL_CTA_LABEL));
  assert.ok(html.includes('href="/signup"'));
  assert.ok(html.includes('href="/pricing"'));
  const graph = calculatorJsonLd();
  assert.equal(graph[0]["@type"], "WebApplication");
  assert.equal(graph[1]["@type"], "FAQPage");
});

test("square-foot quote matches the pricing engine, condition, and default discount", () => {
  const result = quote({
    size: { mode: "sqft", squareFeet: 1500 },
    conditionId: 2,
    frequency: "biweekly",
  });
  assert.ok(result);
  const service = cleaningServices.find((item) => item.id === "standard_clean");
  assert.ok(service);
  const engine = calculateBasePrice({
    sqftPrices: service.prices,
    bedroomPricing,
    minimumPrice: service.minimumPrice,
    fallbackBasePrice: service.minimumPrice,
    pricingMode: "sqft",
    squareFootageIndex: getSqFtIndexFromValue(1500),
  });
  const condition = homeConditionOptions.find((option) => option.id === 2)?.price ?? 0;
  const subtotal = engine.base + condition;
  const multiplier = getFrequencyDiscountMultiplier("biweekly", null);
  assert.equal(result.base, engine.base);
  assert.equal(result.subtotal, subtotal);
  assert.equal(result.quote, Math.round(subtotal * (1 - multiplier)));
  assert.equal(result.quote, 209);
});

test("service minimum floors a sheet price that is below it", () => {
  const result = quote({ size: { mode: "sqft", squareFeet: 400 } });
  assert.ok(result);
  assert.equal(result.rawBase, 158);
  assert.equal(result.base, 200);
  assert.equal(result.quote, 200);
});

test("move-in/out minimum and included fridge", () => {
  const result = quote({
    size: { mode: "sqft", squareFeet: 400 },
    cleanType: "move_in_out",
    addons: { ...none, fridge: true, oven: true },
  });
  assert.ok(result);
  assert.equal(result.base, 350);
  const appliances = extras.find((item) => item.id === "appliances");
  assert.ok(appliances);
  assert.equal(result.addonTotal, appliances.price);
  assert.equal(result.addonLines.some((line) => line.included && line.label.includes("Inside fridge")), true);
});

test("oven and fridge share one appliances extra, and deep already includes the oven", () => {
  const both = quote({
    size: { mode: "sqft", squareFeet: 1500 },
    addons: { ...none, oven: true, fridge: true },
  });
  const appliances = extras.find((item) => item.id === "appliances");
  assert.ok(both && appliances);
  assert.equal(both.addonTotal, appliances.price);

  const deep = quote({
    size: { mode: "sqft", squareFeet: 1000 },
    cleanType: "deep",
    addons: { ...none, oven: true, windows: true },
  });
  const windows = extras.find((item) => item.id === "windows");
  assert.ok(deep && windows);
  assert.equal(deep.addonTotal, windows.price);
  assert.equal(addonHint("deep", "oven"), "Included in this clean");
});

test("bed and bath grid uses the engine, including the nearest-bath fallback", () => {
  const exact = quote({ size: { mode: "beds", bedrooms: "3", bathrooms: "2" } });
  assert.equal(exact?.quote, 215);
  assert.equal(exact?.sizeNote, null);

  const nearest = quote({ size: { mode: "beds", bedrooms: "3", bathrooms: "4" } });
  const engine = calculateBasePrice({
    sqftPrices: cleaningServices.find((item) => item.id === "standard_clean")?.prices,
    bedroomPricing,
    minimumPrice: 200,
    fallbackBasePrice: 200,
    pricingMode: "bedroom",
    bedrooms: "3",
    bathrooms: "4",
  });
  assert.equal(nearest?.base, engine.base);
  assert.equal(nearest?.quote, 245);
  assert.match(nearest?.sizeNote ?? "", /nearest-row fallback/);
});

test("discount ladder reprices one subtotal at the default frequencies", () => {
  const result = quote({
    size: { mode: "sqft", squareFeet: 1500 },
    conditionId: 2,
    frequency: "one_time",
  });
  assert.ok(result);
  const byId = Object.fromEntries(result.ladder.map((rung) => [rung.frequency, rung.price]));
  assert.deepEqual(byId, { weekly: 195, biweekly: 209, monthly: 236, one_time: 278 });
  assert.deepEqual(result.priceRange, { low: 195, high: 278 });
});

test("hours, rate, and profit are the labor budget at the caller's margin", () => {
  const result = quote({
    size: { mode: "sqft", squareFeet: 400 },
    costs: {
      hourlyWage: 20,
      teamSize: 1,
      supplyCostPerVisit: 0,
      monthlyOverhead: 0,
      marginPct: 20,
    },
  });
  assert.ok(result?.economics);
  assert.equal(result.quote, 200);
  assert.equal(result.economics.estimatedHours, 8);
  assert.equal(result.economics.effectiveHourlyRate, 25);
  assert.equal(result.economics.profit, 40);
  assert.equal(result.economics.visitsPerMonth, visitsPerMonth("one_time"));
});

test("weekly overhead uses 52/12 visits and a short quote funds no hours", () => {
  const covered = quote({
    size: { mode: "sqft", squareFeet: 400 },
    frequency: "weekly",
    costs: {
      hourlyWage: 20,
      teamSize: 2,
      supplyCostPerVisit: 0,
      monthlyOverhead: 120,
      marginPct: 0,
    },
  });
  assert.ok(covered?.economics);
  assert.equal(covered.economics.visitsPerMonth, 52 / 12);
  assert.equal(covered.economics.overheadPerVisit, 120 / (52 / 12));

  const short = quote({
    size: { mode: "sqft", squareFeet: 400 },
    costs: {
      hourlyWage: 20,
      teamSize: 1,
      supplyCostPerVisit: 150,
      monthlyOverhead: 0,
      marginPct: 50,
    },
  });
  assert.equal(short?.economics?.estimatedHours, null);
  assert.equal(short?.economics?.shortfall, 50);
  assert.equal(short?.economics?.profit, null);
});

test("blank costs leave the quote and skip hours", () => {
  const result = quote({ size: { mode: "sqft", squareFeet: 1500 } });
  assert.equal(result?.economics, null);
  assert.equal(quote({ size: { mode: "sqft", squareFeet: 0 } }), null);
});
