import {
  bedroomPricing,
  cleaningServices,
  extras,
  getSqFtIndexFromValue,
  homeConditionOptions,
  squareFootageRanges,
  type CleaningServiceType,
} from "../data/pricingData.ts";
import { calculateBasePrice } from "./pricingEngine.ts";
import {
  getFrequencyDiscountMultiplier,
  getFrequencyDiscountPct,
} from "./recurringDiscount.ts";
import {
  ADDON_OPTIONS,
  CLEAN_TYPE_OPTIONS,
  FREQUENCY_OPTIONS,
} from "./houseCleaningCalculatorContent.ts";

export type CalculatorCleanType = (typeof CLEAN_TYPE_OPTIONS)[number]["id"];
export type CalculatorFrequency = (typeof FREQUENCY_OPTIONS)[number]["id"];
export type CalculatorAddonId = (typeof ADDON_OPTIONS)[number]["id"];

const SERVICE_IDS: Record<CalculatorCleanType, CleaningServiceType> = {
  standard_recurring: "standard_clean",
  deep: "deep_clean",
  move_in_out: "move_in_out",
  airbnb: "airbnb",
};

const EXTRA_IDS: Record<CalculatorAddonId, string> = {
  oven: "appliances",
  fridge: "appliances",
  windows: "windows",
  laundry: "laundry",
};

const INCLUDED_ADDONS: Partial<Record<CleaningServiceType, CalculatorAddonId[]>> = {
  deep_clean: ["oven"],
  move_in_out: ["fridge"],
};

export interface HouseCleaningCostInput {
  hourlyWage: number;
  teamSize: number;
  supplyCostPerVisit: number;
  monthlyOverhead: number;
  /** 0–100. */
  marginPct: number;
}

export type HouseCleaningSizeInput =
  | { mode: "sqft"; squareFeet: number }
  | { mode: "beds"; bedrooms: string; bathrooms: string };

export interface HouseCleaningQuoteInput {
  size: HouseCleaningSizeInput;
  cleanType: CalculatorCleanType;
  conditionId: number;
  frequency: CalculatorFrequency;
  addons: Record<CalculatorAddonId, boolean>;
  costs?: HouseCleaningCostInput | null;
}

export interface QuoteAddonLine {
  label: string;
  amount: number;
  included: boolean;
}

export interface DiscountLadderRung {
  frequency: CalculatorFrequency;
  label: string;
  discountPct: number;
  price: number;
}

export interface QuoteEconomics {
  visitsPerMonth: number;
  visitsLabel: string;
  overheadPerVisit: number;
  laborBudget: number;
  estimatedHours: number | null;
  effectiveHourlyRate: number | null;
  profit: number | null;
  shortfall: number | null;
}

export interface HouseCleaningQuote {
  serviceName: string;
  sizeLabel: string;
  sizeNote: string | null;
  base: number;
  rawBase: number;
  minimumPrice: number;
  conditionLabel: string;
  conditionAmount: number;
  addonLines: QuoteAddonLine[];
  addonTotal: number;
  subtotal: number;
  frequencyLabel: string;
  discountPct: number;
  unrounded: number;
  quote: number;
  ladder: DiscountLadderRung[];
  priceRange: { low: number; high: number };
  formulaLines: string[];
  economics: QuoteEconomics | null;
}

export function formatUsd(amount: number, cents = false): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  }).format(amount);
}

export function formatHours(hours: number): string {
  return String(Math.round(hours * 100) / 100);
}

export function visitsPerMonth(frequency: CalculatorFrequency): number {
  if (frequency === "weekly") return 52 / 12;
  if (frequency === "biweekly") return 26 / 12;
  return 1;
}

export function visitsLabel(frequency: CalculatorFrequency): string {
  if (frequency === "weekly") return "52 ÷ 12";
  if (frequency === "biweekly") return "26 ÷ 12";
  return "1";
}

function extraById(id: string) {
  const extra = extras.find((item) => item.id === id);
  if (!extra) throw new Error(`Missing rate-sheet extra: ${id}`);
  return extra;
}

function serviceFor(cleanType: CalculatorCleanType) {
  const service = cleaningServices.find((item) => item.id === SERVICE_IDS[cleanType]);
  if (!service) throw new Error(`Missing rate-sheet service: ${cleanType}`);
  return service;
}

function isIncluded(serviceId: CleaningServiceType, addonId: CalculatorAddonId): boolean {
  return (INCLUDED_ADDONS[serviceId] ?? []).includes(addonId);
}

export function addonHint(cleanType: CalculatorCleanType, addonId: CalculatorAddonId): string {
  const service = serviceFor(cleanType);
  if (isIncluded(service.id, addonId)) return "Included in this clean";
  const extra = extraById(EXTRA_IDS[addonId]);
  if (addonId === "oven" || addonId === "fridge") {
    return `${extra.name} extra ${formatUsd(extra.price)} (charged once if either is selected)`;
  }
  return formatUsd(extra.price);
}

function frequencyLabel(frequency: CalculatorFrequency): string {
  return FREQUENCY_OPTIONS.find((option) => option.id === frequency)?.label ?? frequency;
}

function roundQuote(subtotal: number, frequency: CalculatorFrequency): number {
  const multiplier = getFrequencyDiscountMultiplier(frequency, null);
  return Math.round(subtotal * (1 - multiplier));
}

function validSize(size: HouseCleaningSizeInput): boolean {
  if (size.mode === "sqft") return Number.isFinite(size.squareFeet) && size.squareFeet > 0;
  return size.bedrooms.trim() !== "" && size.bathrooms.trim() !== "";
}

function economicsFor(
  quote: number,
  frequency: CalculatorFrequency,
  costs: HouseCleaningCostInput,
): QuoteEconomics | null {
  const { hourlyWage, teamSize, supplyCostPerVisit, monthlyOverhead, marginPct } = costs;
  if (
    !Number.isFinite(hourlyWage) || hourlyWage <= 0 ||
    !Number.isFinite(teamSize) || teamSize < 1 ||
    !Number.isFinite(supplyCostPerVisit) || supplyCostPerVisit < 0 ||
    !Number.isFinite(monthlyOverhead) || monthlyOverhead < 0 ||
    !Number.isFinite(marginPct) || marginPct < 0 || marginPct > 100
  ) {
    return null;
  }

  const visits = visitsPerMonth(frequency);
  const overheadPerVisit = monthlyOverhead / visits;
  const laborBudget = quote * (1 - marginPct / 100) - supplyCostPerVisit - overheadPerVisit;
  const base: QuoteEconomics = {
    visitsPerMonth: visits,
    visitsLabel: visitsLabel(frequency),
    overheadPerVisit,
    laborBudget,
    estimatedHours: null,
    effectiveHourlyRate: null,
    profit: null,
    shortfall: null,
  };

  if (laborBudget > 1e-9) {
    const estimatedHours = laborBudget / (hourlyWage * teamSize);
    base.estimatedHours = estimatedHours;
    base.effectiveHourlyRate =
      (quote - supplyCostPerVisit - overheadPerVisit) / (estimatedHours * teamSize);
    base.profit = quote - hourlyWage * estimatedHours * teamSize - supplyCostPerVisit - overheadPerVisit;
    return base;
  }

  if (laborBudget >= -1e-9) {
    base.estimatedHours = 0;
    base.profit = quote - supplyCostPerVisit - overheadPerVisit;
    return base;
  }

  base.shortfall = -laborBudget;
  return base;
}

export function calculateHouseCleaningQuote(input: HouseCleaningQuoteInput): HouseCleaningQuote | null {
  if (!validSize(input.size)) return null;

  const service = serviceFor(input.cleanType);
  const cleanLabel = CLEAN_TYPE_OPTIONS.find((option) => option.id === input.cleanType)?.label ?? input.cleanType;
  let sizeLabel = "";
  let sizeNote: string | null = null;
  let rawBase = 0;
  let base = 0;

  if (input.size.mode === "sqft") {
    const index = getSqFtIndexFromValue(input.size.squareFeet);
    const tier = squareFootageRanges[index];
    sizeLabel = `${tier?.label ?? "Largest tier"} (${input.size.squareFeet} sf entered)`;
    const result = calculateBasePrice({
      sqftPrices: service.prices,
      bedroomPricing,
      minimumPrice: service.minimumPrice,
      fallbackBasePrice: service.minimumPrice,
      pricingMode: "sqft",
      squareFootageIndex: index,
    });
    rawBase = result.sqftPart;
    base = result.base;
  } else {
    const { bedrooms, bathrooms } = input.size;
    const exact = bedroomPricing.some(
      (row) => row.bedrooms === bedrooms && row.bathrooms === bathrooms,
    );
    sizeLabel = `${bedrooms} bed, ${bathrooms} bath`;
    if (!exact) {
      sizeNote = "No exact grid row for this bed and bath count. The quote uses the same nearest-row fallback as the booking form.";
    }
    const result = calculateBasePrice({
      sqftPrices: service.prices,
      bedroomPricing,
      minimumPrice: service.minimumPrice,
      fallbackBasePrice: service.minimumPrice,
      pricingMode: "bedroom",
      bedrooms,
      bathrooms,
    });
    rawBase = result.bedBathPart;
    base = result.base;
  }

  const condition = homeConditionOptions.find((option) => option.id === input.conditionId);
  const conditionAmount = condition?.price ?? 0;
  const conditionLabel = condition?.label ?? "Home condition";

  const selected = ADDON_OPTIONS.filter((option) => input.addons[option.id]);
  const addonLines: QuoteAddonLine[] = [];
  let addonTotal = 0;
  let appliancesCharged = false;
  const chargeableAppliances = selected.filter(
    (option) => EXTRA_IDS[option.id] === "appliances" && !isIncluded(service.id, option.id),
  );

  for (const option of selected) {
    if (isIncluded(service.id, option.id)) {
      addonLines.push({
        label: `${option.label}: included in ${service.name}`,
        amount: 0,
        included: true,
      });
      continue;
    }
    const extra = extraById(EXTRA_IDS[option.id]);
    if (extra.id === "appliances") {
      if (appliancesCharged) continue;
      appliancesCharged = true;
      addonTotal += extra.price;
      const names = chargeableAppliances.map((item) => item.label).join(" and ");
      addonLines.push({
        label: `${names}: ${extra.name} extra`,
        amount: extra.price,
        included: false,
      });
      continue;
    }
    addonTotal += extra.price;
    addonLines.push({
      label: `${option.label}: ${extra.name}`,
      amount: extra.price,
      included: false,
    });
  }

  const subtotal = base + conditionAmount + addonTotal;
  const discountPct = getFrequencyDiscountPct(input.frequency, null);
  const multiplier = getFrequencyDiscountMultiplier(input.frequency, null);
  const unrounded = subtotal * (1 - multiplier);
  const quote = Math.round(unrounded);
  const ladder = FREQUENCY_OPTIONS.map((option) => ({
    frequency: option.id,
    label: option.label,
    discountPct: getFrequencyDiscountPct(option.id, null),
    price: roundQuote(subtotal, option.id),
  }));
  const prices = ladder.map((rung) => rung.price);
  const priceRange = { low: Math.min(...prices), high: Math.max(...prices) };
  const economics = input.costs ? economicsFor(quote, input.frequency, input.costs) : null;

  const minimumNote = rawBase > 0 && rawBase < service.minimumPrice && base === service.minimumPrice
    ? `Service minimum ${formatUsd(service.minimumPrice)}. The sheet price ${formatUsd(rawBase)} is below it, so the base is ${formatUsd(base)}.`
    : rawBase === 0 && base === service.minimumPrice
      ? `No sheet price matched, so the base is the service minimum ${formatUsd(service.minimumPrice)}.`
      : `Service minimum ${formatUsd(service.minimumPrice)}. The sheet price is already above it, so the base stays ${formatUsd(base)}.`;

  const formulaLines = [
    `Size: ${sizeLabel}.`,
    sizeNote,
    `Clean type: ${cleanLabel}. Rate sheet: ${service.name}.`,
    `Base = ${formatUsd(base)}.`,
    minimumNote,
    `Home condition: ${conditionLabel}: +${formatUsd(conditionAmount)}.`,
    addonLines.length > 0
      ? `Add-ons: ${addonLines.map((line) => `${line.label} ${formatUsd(line.amount)}`).join("; ")}.`
      : "Add-ons: none.",
    `Subtotal = ${formatUsd(base)} + ${formatUsd(conditionAmount)} + ${formatUsd(addonTotal)} = ${formatUsd(subtotal)}.`,
    `Frequency: ${frequencyLabel(input.frequency)}. Discount ${discountPct}%.`,
    `Quote = round(${formatUsd(subtotal)} × (1 − ${discountPct / 100})) = round(${formatUsd(unrounded, true)}) = ${formatUsd(quote)}.`,
    `Price range = ${formatUsd(priceRange.low)} to ${formatUsd(priceRange.high)} across the discount ladder.`,
  ].filter((line): line is string => Boolean(line));

  if (economics) {
    formulaLines.push(
      `Overhead per visit = ${formatUsd(input.costs?.monthlyOverhead ?? 0, true)} ÷ (${economics.visitsLabel}) = ${formatUsd(economics.overheadPerVisit, true)}.`,
      `Labor budget = ${formatUsd(quote)} × (1 − ${input.costs?.marginPct ?? 0} / 100) − ${formatUsd(input.costs?.supplyCostPerVisit ?? 0, true)} − ${formatUsd(economics.overheadPerVisit, true)} = ${formatUsd(economics.laborBudget, true)}.`,
    );
    if (economics.estimatedHours != null && economics.estimatedHours > 0 && economics.effectiveHourlyRate != null && economics.profit != null) {
      formulaLines.push(
        `Estimated hours = ${formatUsd(economics.laborBudget, true)} ÷ (${formatUsd(input.costs?.hourlyWage ?? 0, true)} × ${input.costs?.teamSize}) = ${formatHours(economics.estimatedHours)}.`,
        `Effective hourly rate = (${formatUsd(quote)} − ${formatUsd(input.costs?.supplyCostPerVisit ?? 0, true)} − ${formatUsd(economics.overheadPerVisit, true)}) ÷ (${formatHours(economics.estimatedHours)} × ${input.costs?.teamSize}) = ${formatUsd(economics.effectiveHourlyRate, true)}.`,
        `Profit per job = ${formatUsd(quote)} − (${formatUsd(input.costs?.hourlyWage ?? 0, true)} × ${formatHours(economics.estimatedHours)} × ${input.costs?.teamSize}) − ${formatUsd(input.costs?.supplyCostPerVisit ?? 0, true)} − ${formatUsd(economics.overheadPerVisit, true)} = ${formatUsd(economics.profit, true)}.`,
      );
    } else if (economics.estimatedHours === 0 && economics.profit != null) {
      formulaLines.push(
        "Estimated hours = 0. The labor budget does not fund wages.",
        `Profit per job = ${formatUsd(quote)} − ${formatUsd(input.costs?.supplyCostPerVisit ?? 0, true)} − ${formatUsd(economics.overheadPerVisit, true)} = ${formatUsd(economics.profit, true)}.`,
      );
    } else if (economics.shortfall != null) {
      formulaLines.push(
        `The quote is short ${formatUsd(economics.shortfall, true)} of supplies, overhead, and the margin before any wages, so there are no estimated hours.`,
      );
    }
  }

  return {
    serviceName: service.name,
    sizeLabel,
    sizeNote,
    base,
    rawBase,
    minimumPrice: service.minimumPrice,
    conditionLabel,
    conditionAmount,
    addonLines,
    addonTotal,
    subtotal,
    frequencyLabel: frequencyLabel(input.frequency),
    discountPct,
    unrounded,
    quote,
    ladder,
    priceRange,
    formulaLines,
    economics,
  };
}
