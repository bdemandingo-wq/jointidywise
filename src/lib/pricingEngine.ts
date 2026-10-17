/**
 * Centralized pricing engine — single source of truth for base price calculation
 * across the admin booking form, the public booking form, and any future surface.
 *
 * Behavior (legacy either/or):
 *   base = pricingMode === 'bedroom'
 *     ? (bedBathPart || sqftPart)
 *     : (sqftPart || bedBathPart);
 * Then fallbackBasePrice is applied if base resolved to 0, then minimumPrice
 * is applied as a floor.
 */

import { squareFootageRanges } from '../data/pricingData.ts';

export interface PricingEngineInput {
  /** Tier prices indexed by squareFootageRanges position. */
  sqftPrices?: number[];
  /** Bedroom/bath grid stored on the service. */
  bedroomPricing?: Array<{
    bedrooms: string | number;
    bathrooms: string | number;
    basePrice: number;
  }>;
  /** Optional minimum floor for the base price (before extras/modifiers). */
  minimumPrice?: number;
  /** Selected sqft tier label (e.g. "1500-1999") OR raw index — either is accepted. */
  squareFootageLabel?: string | null;
  squareFootageIndex?: number | null;
  /** Selected bed/bath. Strings accepted to match historical data shape. */
  bedrooms?: string | number | null;
  bathrooms?: string | number | null;
  /** Which mode the booking surface is currently using. */
  pricingMode?: 'sqft' | 'bedroom';
  /** Optional fallback when nothing else resolves (e.g. service.price). */
  fallbackBasePrice?: number;
}

export interface PricingEngineResult {
  base: number;
  sqftPart: number;
  bedBathPart: number;
}

function resolveSqftPart(input: PricingEngineInput): number {
  const prices = input.sqftPrices ?? [];
  if (prices.length === 0) return 0;

  let idx = input.squareFootageIndex ?? -1;
  if (idx < 0 && input.squareFootageLabel) {
    idx = squareFootageRanges.findIndex((r) => r.label === input.squareFootageLabel);
  }
  if (idx < 0 || idx >= prices.length) return 0;
  return Number(prices[idx]) || 0;
}

function resolveBedBathPart(input: PricingEngineInput): number {
  const grid = input.bedroomPricing ?? [];
  if (grid.length === 0) return 0;
  if (input.bedrooms == null && input.bathrooms == null) return 0;

  const bed = input.bedrooms != null ? String(input.bedrooms) : null;
  const bath = input.bathrooms != null ? String(input.bathrooms) : null;

  // Exact match first
  if (bed && bath) {
    const exact = grid.find(
      (p) => String(p.bedrooms) === bed && String(p.bathrooms) === bath,
    );
    if (exact) return Number(exact.basePrice) || 0;
  }

  // Nearest-bathroom fallback for the selected bedroom count.
  // Fixes: pricing grids don't always contain every bed/bath permutation,
  // which caused service cards to fall back to $0 / minimum price.
  if (bed) {
    const bedMatches = grid.filter((p) => String(p.bedrooms) === bed);
    if (bedMatches.length > 0) {
      if (bath != null) {
        const target = Number(bath);
        const nearest = [...bedMatches].sort(
          (a, b) =>
            Math.abs(Number(a.bathrooms) - target) -
            Math.abs(Number(b.bathrooms) - target),
        )[0];
        return Number(nearest.basePrice) || 0;
      }
      // No bath picked yet — use the lowest-bath row for this bedroom count.
      const lowest = [...bedMatches].sort(
        (a, b) => Number(a.bathrooms) - Number(b.bathrooms),
      )[0];
      return Number(lowest.basePrice) || 0;
    }
  }

  // Only bath picked — pick the lowest-bedroom row matching the bath.
  if (bath) {
    const bathMatches = grid.filter((p) => String(p.bathrooms) === bath);
    if (bathMatches.length > 0) {
      const lowest = [...bathMatches].sort(
        (a, b) => Number(a.bedrooms) - Number(b.bedrooms),
      )[0];
      return Number(lowest.basePrice) || 0;
    }
  }

  return 0;
}

export function calculateBasePrice(input: PricingEngineInput): PricingEngineResult {
  const sqftPart = resolveSqftPart(input);
  const bedBathPart = resolveBedBathPart(input);

  // Legacy either/or — graceful fallback between the two modes.
  let base =
    input.pricingMode === 'bedroom'
      ? bedBathPart || sqftPart
      : sqftPart || bedBathPart;

  // Last-resort fallback (e.g. service.price) so we never regress to $0 silently.
  if (base === 0 && input.fallbackBasePrice && input.fallbackBasePrice > 0) {
    base = input.fallbackBasePrice;
  }

  // Apply minimum price floor — only if we have a real base to begin with.
  if (input.minimumPrice && base > 0 && base < input.minimumPrice) {
    base = input.minimumPrice;
  }

  return { base, sqftPart, bedBathPart };
}
