/**
 * City leaderboard for the landing page.
 * Rows come from score_companies. A thin city asks score-seed-house-cleaners
 * to pull real Google house-cleaning listings. A failed seed leaves the
 * list as it was — it does not fill in sample businesses.
 */

import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  NEARBY_RADIUS_MILES,
  buildScoreLeaderboard,
  type ScoreLeaderboard,
  type ScoreListing,
} from '@/lib/scoreLeaderboard';

export type LeaderboardCity = {
  city: string;
  state: string;
  city_slug: string;
};

type QueryError = { message?: string; code?: string } | null;

type LooseQuery = {
  select: (columns: string) => LooseQuery;
  eq: (column: string, value: string) => LooseQuery;
  gte: (column: string, value: number) => LooseQuery;
  lte: (column: string, value: number) => LooseQuery;
  order: (column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) => LooseQuery;
  limit: (count: number) => Promise<{ data: unknown; error: QueryError }>;
};

const BASE_COLUMNS = 'id, slug, name, city, state, city_slug, score, score_grade, google_rating, google_review_count, latitude, longitude';
const EXTENDED_COLUMNS = `${BASE_COLUMNS}, county, primary_type`;

function companies(): LooseQuery {
  return (supabase as unknown as { from: (table: string) => LooseQuery }).from('score_companies');
}

function missingColumn(error: QueryError): boolean {
  if (!error) return false;
  if (error.code === '42703') return true;
  return /column .* does not exist/i.test(error.message ?? '');
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function mapRow(raw: unknown): ScoreListing | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.name !== 'string' || typeof row.slug !== 'string') return null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    city: asText(row.city),
    state: asText(row.state),
    city_slug: asText(row.city_slug),
    score: asNumber(row.score),
    score_grade: asText(row.score_grade),
    google_rating: asNumber(row.google_rating),
    google_review_count: asNumber(row.google_review_count),
    latitude: asNumber(row.latitude),
    longitude: asNumber(row.longitude),
    county: asText(row.county),
    primary_type: asText(row.primary_type),
  };
}

async function selectRows(columns: string, apply: (query: LooseQuery) => LooseQuery): Promise<ScoreListing[]> {
  const first = await apply(companies().select(columns)).limit(200);
  if (first.error && columns !== BASE_COLUMNS && missingColumn(first.error)) {
    const second = await apply(companies().select(BASE_COLUMNS)).limit(200);
    if (second.error) throw new Error(second.error.message || 'score leaderboard failed');
    return (Array.isArray(second.data) ? second.data : []).map(mapRow).filter((row): row is ScoreListing => row != null);
  }
  if (first.error) throw new Error(first.error.message || 'score leaderboard failed');
  return (Array.isArray(first.data) ? first.data : []).map(mapRow).filter((row): row is ScoreListing => row != null);
}

function ordered(query: LooseQuery): LooseQuery {
  return query
    .order('score', { ascending: false, nullsFirst: false })
    .order('id', { ascending: true });
}

function boundingBox(latitude: number, longitude: number) {
  const latDelta = NEARBY_RADIUS_MILES / 69;
  const lngDelta = NEARBY_RADIUS_MILES / (69 * Math.cos((latitude * Math.PI) / 180));
  return {
    latMin: latitude - latDelta,
    latMax: latitude + latDelta,
    lngMin: longitude - lngDelta,
    lngMax: longitude + lngDelta,
  };
}

async function loadLeaderboard(city: LeaderboardCity): Promise<ScoreLeaderboard> {
  const inCity = await selectRows(EXTENDED_COLUMNS, (query) => ordered(query.eq('city_slug', city.city_slug)));
  const anchor = buildScoreLeaderboard(inCity, city);
  if (anchor.entries.length >= 10) return anchor;

  const withPoint = inCity.find((row) => row.latitude != null && row.longitude != null);
  if (!withPoint || withPoint.latitude == null || withPoint.longitude == null) return anchor;

  const box = boundingBox(withPoint.latitude, withPoint.longitude);
  const nearby = await selectRows(EXTENDED_COLUMNS, (query) => ordered(
    query
      .eq('state', city.state)
      .gte('latitude', box.latMin)
      .lte('latitude', box.latMax)
      .gte('longitude', box.lngMin)
      .lte('longitude', box.lngMax),
  ));
  const byId = new Map<string, ScoreListing>();
  for (const row of [...inCity, ...nearby]) byId.set(row.id, row);
  return buildScoreLeaderboard([...byId.values()], city);
}

export function useScoreLeaderboard(city: LeaderboardCity | null, seed: boolean) {
  const queryClient = useQueryClient();
  const seeded = useRef(new Set<string>());
  const query = useQuery({
    queryKey: ['score-leaderboard', city?.city_slug ?? ''],
    queryFn: () => loadLeaderboard(city as LeaderboardCity),
    enabled: city != null,
    staleTime: 60_000,
    retry: 1,
  });

  useEffect(() => {
    if (!seed || !city || !query.data || query.data.entries.length >= 10) return;
    if (seeded.current.has(city.city_slug)) return;
    seeded.current.add(city.city_slug);
    const slug = city.city_slug;
    const cityName = city.city;
    const state = city.state;
    void (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('score-seed-house-cleaners', {
          body: { city: cityName, state },
        });
        if (error) {
          console.warn('[score] house-cleaning seed failed', error.message);
          return;
        }
        const inserted = typeof data?.inserted === 'number' ? data.inserted : 0;
        const updated = typeof data?.updated === 'number' ? data.updated : 0;
        const errors = typeof data?.errors === 'number' ? data.errors : 0;
        if (errors > 0) console.warn('[score] house-cleaning seed row errors', errors, data?.reason);
        if (inserted > 0 || updated > 0) {
          await queryClient.invalidateQueries({ queryKey: ['score-leaderboard', slug] });
        }
      } catch (err) {
        console.warn('[score] house-cleaning seed failed', err);
      }
    })();
  }, [seed, city, query.data, queryClient]);

  return query;
}
