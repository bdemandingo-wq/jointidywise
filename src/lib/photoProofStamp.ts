/**
 * Chargeback proof for a booking photo.
 *
 * burnProofStamp paints the bar into JPEG pixels. It is not a CSS overlay.
 * The upload stores that painted file beside an unstamped copy. The same
 * instant and GPS are written on the booking_photos row (captured_at,
 * capture_latitude, capture_longitude) while created_at stays the insert time.
 * A photo whose burn failed keeps the unstamped file only; the viewer then
 * draws proofOverlayLabel, and "Download with timestamp" paints the bar
 * in the browser from those columns.
 *
 * EXIF DateTimeOriginal wins when the file or the Capacitor camera result
 * still has it, and is labeled Taken. Otherwise the stamp says Uploaded and
 * uses the moment of upload. Both are formatted in the business timezone.
 */

export interface WallClock {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export interface CaptureExif {
  /** Absolute instant when the file included a timezone offset. */
  takenAt?: Date;
  /** Camera clock with no offset. Interpreted in the device timezone. */
  wallClock?: WallClock;
  latitude?: number;
  longitude?: number;
}

export type TimestampSource = 'exif' | 'upload';

export interface ProofClock {
  at: Date;
  source: TimestampSource;
  label: 'Taken' | 'Uploaded';
}

const DATE_RE = /(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;
const OFFSET_RE = /^([+-])(\d{2}):(\d{2})$/;

function validWall(wall: WallClock): boolean {
  return wall.year >= 1990 && wall.year <= 2100
    && wall.month >= 1 && wall.month <= 12
    && wall.day >= 1 && wall.day <= 31
    && wall.hour >= 0 && wall.hour <= 23
    && wall.minute >= 0 && wall.minute <= 59
    && wall.second >= 0 && wall.second <= 60;
}

/** Offset as minutes east of UTC. "-05:00" → -300. */
export function parseExifOffsetMinutes(offset: string): number | null {
  const match = OFFSET_RE.exec(offset.trim());
  if (!match) return null;
  const sign = match[1] === '-' ? -1 : 1;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  if (minutes > 14 * 60) return null;
  return sign * minutes;
}

export function parseExifDateString(value: string, offset?: string | null): Pick<CaptureExif, 'takenAt' | 'wallClock'> | null {
  const match = DATE_RE.exec(value.trim());
  if (!match) return null;
  const wall: WallClock = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6]),
  };
  if (!validWall(wall)) return null;
  const offsetMinutes = offset ? parseExifOffsetMinutes(offset) : null;
  if (offsetMinutes == null) return { wallClock: wall };
  const utc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) - offsetMinutes * 60_000;
  return { takenAt: new Date(utc) };
}

export function wallClockToUtc(wall: WallClock, timeZone: string): Date {
  const asUtc = new Date(Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second));
  const inZone = new Date(asUtc.toLocaleString('en-US', { timeZone }));
  const inUtc = new Date(asUtc.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(asUtc.getTime() - (inZone.getTime() - inUtc.getTime()));
}

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
  } catch {
    return 'America/New_York';
  }
}

function typeSize(type: number): number {
  switch (type) {
    case 1: case 2: case 6: case 7: return 1;
    case 3: case 8: return 2;
    case 4: case 9: case 11: return 4;
    case 5: case 10: return 8;
    default: return 0;
  }
}

type TagValue = string | number | number[];

function readAscii(tiff: Uint8Array, offset: number, count: number): string {
  const end = Math.min(tiff.length, offset + count);
  let text = '';
  for (let i = offset; i < end; i += 1) {
    if (tiff[i] === 0) break;
    text += String.fromCharCode(tiff[i]);
  }
  return text;
}

function readIfd(
  tiff: Uint8Array,
  start: number,
  u16: (offset: number) => number,
  u32: (offset: number) => number,
): Map<number, TagValue> {
  const tags = new Map<number, TagValue>();
  if (start < 0 || start + 2 > tiff.length) return tags;
  const count = u16(start);
  for (let i = 0; i < count; i += 1) {
    const entry = start + 2 + i * 12;
    if (entry + 12 > tiff.length) break;
    const tag = u16(entry);
    const type = u16(entry + 2);
    const n = u32(entry + 4);
    const size = typeSize(type);
    if (!size || !n) continue;
    const byteCount = size * n;
    let valueOff = entry + 8;
    if (byteCount > 4) {
      valueOff = u32(entry + 8);
      if (valueOff < 0 || valueOff + byteCount > tiff.length) continue;
    }
    if (type === 2) {
      tags.set(tag, readAscii(tiff, valueOff, n));
    } else if (type === 5 || type === 10) {
      const values: number[] = [];
      for (let r = 0; r < n; r += 1) {
        const num = u32(valueOff + r * 8);
        const den = u32(valueOff + r * 8 + 4);
        const signedNum = type === 10 && num > 0x7fffffff ? num - 0x100000000 : num;
        values.push(den ? signedNum / den : 0);
      }
      tags.set(tag, values.length === 1 ? values[0] : values);
    } else if (type === 3) {
      tags.set(tag, u16(valueOff));
    } else if (type === 4 || type === 9) {
      const raw = u32(valueOff);
      tags.set(tag, type === 9 && raw > 0x7fffffff ? raw - 0x100000000 : raw);
    } else if (type === 1) {
      tags.set(tag, tiff[valueOff] ?? 0);
    }
  }
  return tags;
}

function dmsToDegrees(value: TagValue | undefined, ref: string | undefined): number | null {
  let degrees: number | null = null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    degrees = value;
  } else if (Array.isArray(value) && value.length > 0 && value.every((n) => Number.isFinite(n))) {
    const [d, m = 0, s = 0] = value;
    degrees = d + m / 60 + s / 3600;
  }
  if (degrees == null) return null;
  if (ref === 'S' || ref === 'W') degrees = -Math.abs(degrees);
  return degrees;
}

function clockFromTags(
  tags: Map<number, TagValue>,
  tag: number,
  offset: string | null,
): Pick<CaptureExif, 'takenAt' | 'wallClock'> | null {
  const raw = tags.get(tag);
  if (typeof raw !== 'string') return null;
  return parseExifDateString(raw, offset);
}

function exifFromTiff(tiff: Uint8Array): CaptureExif | null {
  if (tiff.length < 8) return null;
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  const big = tiff[0] === 0x4d && tiff[1] === 0x4d;
  if (!little && !big) return null;
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const u16 = (offset: number) => view.getUint16(offset, little);
  const u32 = (offset: number) => view.getUint32(offset, little);
  if (u16(2) !== 42) return null;
  const ifd0 = readIfd(tiff, u32(4), u16, u32);
  const exifPtr = ifd0.get(0x8769);
  const exif = typeof exifPtr === 'number' ? readIfd(tiff, exifPtr, u16, u32) : new Map<number, TagValue>();
  const gpsPtr = ifd0.get(0x8825);
  const gps = typeof gpsPtr === 'number' ? readIfd(tiff, gpsPtr, u16, u32) : new Map<number, TagValue>();

  const offsetRaw = exif.get(0x9011) ?? exif.get(0x9010);
  const offset = typeof offsetRaw === 'string' ? offsetRaw : null;
  const clock = clockFromTags(exif, 0x9003, offset)
    ?? clockFromTags(exif, 0x9004, offset)
    ?? clockFromTags(ifd0, 0x0132, offset);

  const lat = dmsToDegrees(gps.get(0x0002), typeof gps.get(0x0001) === 'string' ? gps.get(0x0001) as string : undefined);
  const lng = dmsToDegrees(gps.get(0x0004), typeof gps.get(0x0003) === 'string' ? gps.get(0x0003) as string : undefined);
  const pair = lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

  if (!clock && !pair) return null;
  return {
    takenAt: clock?.takenAt,
    wallClock: clock?.takenAt ? undefined : clock?.wallClock,
    latitude: pair ? lat : undefined,
    longitude: pair ? lng : undefined,
  };
}

/** JPEG APP1 Exif, or a plain scan for HEIC/HEIF where the date is still ASCII. */
export function parseImageExif(bytes: Uint8Array): CaptureExif | null {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1];
      if (marker === 0xda || marker === 0xd9) break;
      const size = (bytes[offset + 2] << 8) | bytes[offset + 3];
      if (size < 2 || offset + 2 + size > bytes.length) break;
      if (marker === 0xe1) {
        const label = readAscii(bytes, offset + 4, 6);
        if (label === 'Exif') {
          const parsed = exifFromTiff(bytes.subarray(offset + 10, offset + 2 + size));
          if (parsed) return parsed;
        }
      }
      offset += 2 + size;
    }
    return null;
  }
  return scanForExifDate(bytes);
}

function scanForExifDate(bytes: Uint8Array): CaptureExif | null {
  const text = new TextDecoder('latin1').decode(bytes);
  const match = DATE_RE.exec(text);
  if (!match) return null;
  const parsed = parseExifDateString(match[0], null);
  return parsed ? { wallClock: parsed.wallClock, takenAt: parsed.takenAt } : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function pickString(obj: Record<string, unknown> | null, keys: string[]): string | null {
  if (!obj) return null;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function coordFrom(obj: Record<string, unknown> | null, valueKeys: string[], refKeys: string[]): number | null {
  if (!obj) return null;
  let raw: unknown;
  for (const key of valueKeys) {
    if (obj[key] != null) {
      raw = obj[key];
      break;
    }
  }
  const ref = pickString(obj, refKeys) ?? undefined;
  if (typeof raw === 'number' || Array.isArray(raw)) {
    const degrees = dmsToDegrees(raw as TagValue, ref);
    return degrees;
  }
  if (typeof raw === 'string' && raw.trim()) {
    const n = Number(raw);
    return Number.isFinite(n) ? dmsToDegrees(n, ref) : null;
  }
  return null;
}

/** Capacitor Camera's `exif` object. iOS nests it under `{Exif}` / `{GPS}`. */
export function parsePluginExif(exif: unknown): CaptureExif | null {
  const root = asRecord(exif);
  if (!root) return null;
  const exifDict = asRecord(root['{Exif}']) ?? asRecord(root.Exif) ?? asRecord(root.exif) ?? root;
  const tiffDict = asRecord(root['{TIFF}']) ?? asRecord(root.TIFF);
  const gpsDict = asRecord(root['{GPS}']) ?? asRecord(root.GPS) ?? root;

  const dateStr = pickString(exifDict, ['DateTimeOriginal', 'DateTimeDigitized'])
    ?? pickString(tiffDict, ['DateTime'])
    ?? pickString(root, ['DateTimeOriginal', 'DateTime']);
  const offset = pickString(exifDict, ['OffsetTimeOriginal', 'OffsetTimeDigitized', 'OffsetTime'])
    ?? pickString(root, ['OffsetTimeOriginal', 'OffsetTime']);
  const clock = dateStr ? parseExifDateString(dateStr, offset) : null;

  const lat = coordFrom(gpsDict, ['Latitude', 'GPSLatitude'], ['LatitudeRef', 'GPSLatitudeRef']);
  const lng = coordFrom(gpsDict, ['Longitude', 'GPSLongitude'], ['LongitudeRef', 'GPSLongitudeRef']);
  const pair = lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  if (!clock && !pair) return null;
  return {
    takenAt: clock?.takenAt,
    wallClock: clock?.takenAt ? undefined : clock?.wallClock,
    latitude: pair ? lat! : undefined,
    longitude: pair ? lng! : undefined,
  };
}

export function mergeCaptureExif(fileExif: CaptureExif | null, pluginExif: CaptureExif | null): CaptureExif | null {
  if (!fileExif) return pluginExif;
  if (!pluginExif) return fileExif;
  const takenAt = fileExif.takenAt ?? pluginExif.takenAt;
  return {
    takenAt,
    wallClock: takenAt ? undefined : (fileExif.wallClock ?? pluginExif.wallClock),
    latitude: fileExif.latitude ?? pluginExif.latitude,
    longitude: fileExif.longitude ?? pluginExif.longitude,
  };
}

export function resolveProofClock(args: {
  exif: CaptureExif | null;
  uploadedAt: Date;
  deviceTimeZone: string;
}): ProofClock {
  const uploadedAt = Number.isNaN(args.uploadedAt.getTime()) ? new Date() : args.uploadedAt;
  const fallback: ProofClock = { at: uploadedAt, source: 'upload', label: 'Uploaded' };
  const exif = args.exif;
  if (!exif) return fallback;

  let at: Date | null = null;
  if (exif.takenAt && !Number.isNaN(exif.takenAt.getTime())) at = exif.takenAt;
  else if (exif.wallClock && validWall(exif.wallClock)) {
    try {
      at = wallClockToUtc(exif.wallClock, args.deviceTimeZone || 'UTC');
    } catch {
      at = null;
    }
  }
  if (!at || Number.isNaN(at.getTime())) return fallback;
  if (at.getTime() - uploadedAt.getTime() > 24 * 60 * 60 * 1000) return fallback;
  if (at.getUTCFullYear() < 1990) return fallback;
  return { at, source: 'exif', label: 'Taken' };
}

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

function finitePoint(point: GeoPoint | null | undefined): point is GeoPoint {
  return !!point && Number.isFinite(point.latitude) && Number.isFinite(point.longitude)
    && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180;
}

/**
 * EXIF GPS is where the camera says the photo was taken. The device fix is
 * only stamped for a live capture (the cleaner is at the property now). A
 * library photo uploaded later must not pick up the cleaner's current
 * coordinates — that would put the wrong place on a dispute image.
 */
export function chooseStampGps(args: {
  exifGps: GeoPoint | null;
  deviceGps: GeoPoint | null;
  liveCapture: boolean;
}): GeoPoint | null {
  if (finitePoint(args.exifGps)) return args.exifGps;
  if (args.liveCapture && finitePoint(args.deviceGps)) return args.deviceGps;
  return null;
}

export function formatProofWhen(at: Date, businessTimeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: businessTimeZone || 'America/New_York',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  }).format(at);
}

export function formatPropertyAddress(parts: {
  address?: string | null;
  apt_suite?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
}): string | null {
  const street = [parts.address?.trim(), parts.apt_suite?.trim()].filter(Boolean).join(' ');
  const cityState = [parts.city?.trim(), parts.state?.trim()].filter(Boolean).join(', ');
  const line = [street, cityState, parts.zip_code?.trim()].filter(Boolean).join(', ');
  return line || null;
}

export function proofStampLines(args: {
  label: 'Taken' | 'Uploaded';
  at: Date;
  businessTimeZone: string;
  bookingNumber: number | string | null | undefined;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
}): string[] {
  const lines = [`${args.label} · ${formatProofWhen(args.at, args.businessTimeZone)}`];
  const job = args.bookingNumber != null && String(args.bookingNumber) !== ''
    ? `Job #${args.bookingNumber}`
    : '';
  const place = [job, args.address ?? ''].filter(Boolean).join(' · ');
  if (place) lines.push(place);
  if (args.latitude != null && args.longitude != null
    && Number.isFinite(args.latitude) && Number.isFinite(args.longitude)) {
    lines.push(`GPS ${args.latitude.toFixed(5)}, ${args.longitude.toFixed(5)}`);
  }
  return lines;
}

/** CSS overlay for photos that were not stamped. Null when the pixels already carry it. */
export function proofOverlayLabel(photo: {
  proof_stamped?: boolean | null;
  timestamp_source?: string | null;
  captured_at?: string | null;
  created_at?: string | null;
}, businessTimeZone: string): string | null {
  if (photo.proof_stamped === true) return null;
  const raw = photo.captured_at || photo.created_at;
  if (!raw) return null;
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) return null;
  const label = photo.timestamp_source === 'exif' ? 'Taken' : 'Uploaded';
  return `${label} · ${formatProofWhen(at, businessTimeZone)}`;
}

/** PostgREST / Postgres signal that a selected or inserted column is not on the live table yet. */
export function isMissingProofColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === '42703' || error.code === 'PGRST204') return true;
  const message = error.message ?? '';
  return /does not exist/i.test(message)
    || /schema cache/i.test(message)
    || /could not find the '.+' column/i.test(message);
}

export function isMissingColumn(
  error: { code?: string; message?: string } | null | undefined,
  column: string,
): boolean {
  if (!isMissingProofColumn(error) || !column) return false;
  return (error?.message ?? '').includes(column);
}

function wrapLine(ctx: CanvasRenderingContext2D, line: string, maxWidth: number): string[] {
  const words = line.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let current = words[0];
  for (let i = 1; i < words.length; i += 1) {
    const next = `${current} ${words[i]}`;
    if (ctx.measureText(next).width <= maxWidth) current = next;
    else {
      lines.push(current);
      current = words[i];
    }
  }
  lines.push(current);
  return lines.slice(0, 6);
}

function drawStamp(ctx: CanvasRenderingContext2D, width: number, height: number, lines: string[]) {
  const fontSize = Math.max(18, Math.min(48, Math.round(width * 0.034)));
  const lineHeight = Math.round(fontSize * 1.28);
  const padX = Math.round(fontSize * 0.75);
  const padY = Math.round(fontSize * 0.55);
  ctx.font = `600 ${fontSize}px sans-serif`;
  const wrapped = lines.flatMap((line) => wrapLine(ctx, line, Math.max(40, width - padX * 2)));
  if (!wrapped.length) return;
  const barHeight = Math.min(height, padY * 2 + lineHeight * wrapped.length);
  const top = height - barHeight;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
  ctx.fillRect(0, top, width, barHeight);
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'top';
  wrapped.forEach((line, index) => {
    const y = top + padY + index * lineHeight;
    if (y + fontSize <= height) ctx.fillText(line, padX, y);
  });
}

/**
 * Re-encode the photo as JPEG with the stamp painted into the bottom edge.
 * Long edge is capped so a 12MP iPhone frame does not blow the canvas on device.
 */
export async function burnProofStamp(file: File, lines: string[]): Promise<File> {
  if (!lines.length) return file;
  const bitmap = await createImageBitmap(file);
  let canvas: HTMLCanvasElement | null = null;
  try {
    const maxEdge = 2560;
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not draw the proof stamp');
    ctx.drawImage(bitmap, 0, 0, width, height);
    drawStamp(ctx, width, height, lines);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas?.toBlob(resolve, 'image/jpeg', 0.92);
    });
    if (!blob) throw new Error('Could not encode the stamped photo');
    const base = file.name.replace(/\.[^.]+$/, '') || 'photo';
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
  } finally {
    bitmap.close?.();
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}
