export { finitePoint } from '@/lib/trackingVisibility';

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
  pausedLabel: string | null;
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
