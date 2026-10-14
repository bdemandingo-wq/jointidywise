import { useEffect, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import type { DivIcon, Layer, LayerGroup, LeafletEvent, LeafletMouseEvent, Map as LeafletMap, Marker, Polyline } from 'leaflet';
import { Button } from '@/components/ui/button';
import { finitePoint, type CompletedRoute, type EnRouteCleaner, type MapPoint, type TodayJobPin } from '@/components/admin/trackingFleetModel';

type Props = {
  cleaners: EnRouteCleaner[];
  todayPins: TodayJobPin[];
  completedRoutes: CompletedRoute[];
  showCompleted: boolean;
  office: MapPoint | null;
  focusId: string | null;
  onClearFocus: () => void;
  ready: boolean;
};

const US_CENTER: MapPoint = { lat: 39.8283, lng: -98.5795 };
let leafletNs: typeof import('leaflet') | null = null;

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch
  ));
}

/**
 * One Leaflet map for the tracking page. Markers move when the parent
 * passes new coordinates from the existing realtime subscription.
 * Tile pixels invert in dark mode; markers stay in the overlay pane.
 */
export function TrackingFleetMap({
  cleaners,
  todayPins,
  completedRoutes,
  showCompleted,
  office,
  focusId,
  onClearFocus,
  ready,
}: Props) {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === 'dark';
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const markerById = useRef<Map<string, Layer>>(new Map());
  const fittedKey = useRef<string>('');
  const flewTo = useRef<string | null>(null);
  const userPanned = useRef(false);
  const [panned, setPanned] = useState(false);
  const focusRef = useRef(focusId);
  focusRef.current = focusId;

  const cleanersRef = useRef(cleaners);
  const pinsRef = useRef(todayPins);
  const completedRef = useRef(completedRoutes);
  const officeRef = useRef(office);
  const showCompletedRef = useRef(showCompleted);
  const readyRef = useRef(ready);
  cleanersRef.current = cleaners;
  pinsRef.current = todayPins;
  completedRef.current = completedRoutes;
  officeRef.current = office;
  showCompletedRef.current = showCompleted;
  readyRef.current = ready;

  const drawRef = useRef<() => void>(() => {});

  drawRef.current = () => {
    const map = mapRef.current;
    const layer = layerRef.current;
    const L = leafletNs;
    if (!map || !layer || !L || !readyRef.current) return;

    const active = cleanersRef.current;
    const showingLive = active.length > 0;
    const pins = showingLive ? [] : pinsRef.current;
    const done = showCompletedRef.current ? completedRef.current : [];
    const officePoint = officeRef.current;
    const focus = focusRef.current;

    const seen = new Set<string>();
    const bounds: [number, number][] = [];

    const keep = (id: string, marker: Layer) => {
      seen.add(id);
      markerById.current.set(id, marker);
    };

    const dot = (color: string, label?: string): DivIcon => L.divIcon({
      className: 'tracking-fleet-icon',
      html: `<div class="tracking-fleet-pin"><span class="tracking-fleet-dot" style="background:${color}"></span>${
        label ? `<span class="tracking-fleet-label">${esc(label)}</span>` : ''
      }</div>`,
      iconSize: [120, 36],
      iconAnchor: [60, 8],
    });

    const upsert = (id: string, point: MapPoint, icon: DivIcon, popup: string): Marker => {
      const existing = markerById.current.get(id) as Marker | undefined;
      const marker = existing ?? L.marker([point.lat, point.lng], { icon }).bindPopup(popup, { className: 'tracking-fleet-popup' });
      if (!existing) layer.addLayer(marker);
      else {
        marker.setLatLng([point.lat, point.lng]);
        marker.setIcon(icon);
        marker.setPopupContent(popup);
      }
      keep(id, marker);
      bounds.push([point.lat, point.lng]);
      return marker;
    };

    for (const cleaner of active) {
      const here = finitePoint(cleaner.lat, cleaner.lng);
      if (!here) continue;
      const status = cleaner.stale ? 'Paused' : 'En route';
      const eta = !cleaner.stale && cleaner.etaMinutes != null ? ` · ETA ~${cleaner.etaMinutes} min` : '';
      const destLine = cleaner.destLabel ? `<br/>${esc(cleaner.destLabel)}` : '';
      upsert(
        `cleaner-${cleaner.id}`,
        here,
        dot('#2563eb', cleaner.name),
        `<strong>${esc(cleaner.name)}</strong><br/>${status}${eta}${destLine}`,
      );
      if (cleaner.dest) {
        const dest = finitePoint(cleaner.dest.lat, cleaner.dest.lng);
        if (dest) {
          upsert(
            `dest-${cleaner.id}`,
            dest,
            dot('#e11d48'),
            `<strong>Destination</strong><br/>${esc(cleaner.name)}${destLine}`,
          );
          const lineId = `line-${cleaner.id}`;
          const latlngs: [number, number][] = [[here.lat, here.lng], [dest.lat, dest.lng]];
          let line = markerById.current.get(lineId) as Polyline | undefined;
          if (!line) {
            line = L.polyline(latlngs, { color: '#2563eb', weight: 3, opacity: 0.85 });
            layer.addLayer(line);
          } else {
            line.setLatLngs(latlngs);
          }
          keep(lineId, line);
        }
      }
    }

    for (const pin of pins) {
      const point = finitePoint(pin.lat, pin.lng);
      if (!point) continue;
      upsert(`job-${pin.id}`, point, dot('#0f766e'), `<strong>Today</strong><br/>${esc(pin.label)}`);
    }

    if (!showingLive && officePoint) {
      const point = finitePoint(officePoint.lat, officePoint.lng);
      if (point) {
        upsert('office', point, dot('#7c3aed', 'Office'), '<strong>Office</strong>');
      }
    }

    for (const route of done) {
      const last = route.last ? finitePoint(route.last.lat, route.last.lng) : null;
      const dest = route.dest ? finitePoint(route.dest.lat, route.dest.lng) : null;
      if (last) {
        upsert(
          `done-last-${route.id}`,
          last,
          dot('#64748b', route.name),
          `<strong>Completed</strong><br/>${esc(route.name)}<br/>${esc(route.label)}<br/>Last recorded position`,
        );
      }
      if (dest) {
        upsert(
          `done-dest-${route.id}`,
          dest,
          dot('#94a3b8'),
          `<strong>Completed stop</strong><br/>${esc(route.name)}<br/>${esc(route.label)}`,
        );
      }
      if (last && dest) {
        const lineId = `done-line-${route.id}`;
        const latlngs: [number, number][] = [[last.lat, last.lng], [dest.lat, dest.lng]];
        let line = markerById.current.get(lineId) as Polyline | undefined;
        if (!line) {
          line = L.polyline(latlngs, { color: '#64748b', weight: 2, opacity: 0.8, dashArray: '6 6' });
          layer.addLayer(line);
        } else {
          line.setLatLngs(latlngs);
        }
        keep(lineId, line);
      }
    }

    for (const [id, marker] of markerById.current) {
      if (seen.has(id)) continue;
      layer.removeLayer(marker);
      markerById.current.delete(id);
    }

    if (focus) {
      const marker = markerById.current.get(`cleaner-${focus}`) as Marker | undefined;
      const cleaner = active.find((row) => row.id === focus);
      const here = cleaner ? finitePoint(cleaner.lat, cleaner.lng) : null;
      if (marker && here && flewTo.current !== focus) {
        flewTo.current = focus;
        map.flyTo([here.lat, here.lng], Math.max(map.getZoom(), 14), { duration: 0.5 });
        marker.openPopup();
      }
      return;
    }
    if (flewTo.current) {
      flewTo.current = null;
      fittedKey.current = '';
      userPanned.current = false;
      setPanned(false);
    }

    const idKey = [...seen].sort().join('|');
    let leftFrame = false;
    if (bounds.length > 0 && fittedKey.current) {
      const frame = map.getBounds().pad(0.15);
      leftFrame = bounds.some(([lat, lng]) => !frame.contains([lat, lng]));
    }
    if (userPanned.current) return;
    if (fittedKey.current === idKey && !leftFrame) return;
    fittedKey.current = idKey;

    if (bounds.length === 0) {
      map.setView([US_CENTER.lat, US_CENTER.lng], 4, { animate: false });
      return;
    }
    if (bounds.length === 1) {
      map.setView(bounds[0], 13, { animate: false });
      return;
    }
    map.fitBounds(L.latLngBounds(bounds), { padding: [36, 36], maxZoom: 14, animate: false });
  };

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      const L = await import('leaflet');
      await import('leaflet/dist/leaflet.css');
      if (cancelled || !hostRef.current || mapRef.current) return;
      leafletNs = L;
      const coarse = window.matchMedia('(pointer: coarse)').matches;
      const map = L.map(hostRef.current, {
        scrollWheelZoom: !coarse,
        zoomControl: true,
      }).setView([US_CENTER.lat, US_CENTER.lng], 4);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19,
      }).addTo(map);
      const markUserMove = (event: LeafletEvent) => {
        if (!(event as LeafletMouseEvent).originalEvent) return;
        userPanned.current = true;
        setPanned(true);
      };
      map.on('dragstart', markUserMove);
      map.on('zoomstart', markUserMove);
      layerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;
      requestAnimationFrame(() => map.invalidateSize());
      window.setTimeout(() => map.invalidateSize(), 250);
      drawRef.current();
    };
    const markers = markerById.current;
    void init();
    return () => {
      cancelled = true;
      markers.clear();
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        layerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    drawRef.current();
  }, [cleaners, todayPins, completedRoutes, showCompleted, office, focusId, ready]);

  useEffect(() => {
    const onResize = () => mapRef.current?.invalidateSize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const nobodyEnRoute = ready && cleaners.length === 0;

  return (
    <div className={`tracking-fleet-map relative overflow-hidden rounded-xl border border-border ${dark ? 'dark-tiles' : ''}`}>
      <div ref={hostRef} className="h-[min(55vh,520px)] min-h-[280px] w-full" />
      {nobodyEnRoute && (
        <div className="pointer-events-none absolute bottom-8 left-1/2 z-[500] max-w-[90%] -translate-x-1/2 rounded-full border border-border bg-card/95 px-3 py-1.5 text-center text-xs font-medium text-card-foreground shadow-sm">
          No cleaners en route right now
        </div>
      )}
      {(focusId || panned) && (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="absolute right-3 top-3 z-[500] h-9 shadow-sm"
          onClick={() => {
            userPanned.current = false;
            setPanned(false);
            fittedKey.current = '';
            focusRef.current = null;
            onClearFocus();
            drawRef.current();
          }}
        >
          Show all
        </Button>
      )}
    </div>
  );
}
