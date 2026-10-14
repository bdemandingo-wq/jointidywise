export type MapPoint = { lat: number; lng: number };

export type EnRouteCleaner = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  dest: MapPoint | null;
  destLabel: string;
  etaMinutes: number | null;
  stale: boolean;
};

export type TodayJobPin = {
  id: string;
  lat: number;
  lng: number;
  label: string;
};

export type CompletedRoute = {
  id: string;
  name: string;
  label: string;
  last: MapPoint | null;
  dest: MapPoint | null;
};

export function finitePoint(lat: unknown, lng: unknown): MapPoint | null {
  const la = typeof lat === 'number' ? lat : Number(lat);
  const ln = typeof lng === 'number' ? lng : Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (Math.abs(la) > 90 || Math.abs(ln) > 180) return null;
  return { lat: la, lng: ln };
}
