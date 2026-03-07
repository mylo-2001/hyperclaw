/**
 * src/channels/location-parser.ts
 * Normalize shared locations from chat channels into human-readable text
 * and structured ctx fields.
 *
 * Supported channels:
 *   Telegram  — location pins, venues, live locations
 *   WhatsApp  — locationMessage, liveLocationMessage
 *   Matrix    — m.location (geo_uri)
 *
 * Text format (no brackets):
 *   Pin:         📍 48.858844, 2.294351 ±12m
 *   Named place: 📍 Eiffel Tower — Champ de Mars, Paris (48.858844, 2.294351 ±12m)
 *   Live share:  🛰 Live location: 48.858844, 2.294351 ±12m
 *   With caption: (next line) Meet here
 *
 * Ctx fields added:
 *   LocationLat, LocationLon, LocationAccuracy, LocationName,
 *   LocationAddress, LocationSource, LocationIsLive
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LocationSource = 'pin' | 'place' | 'live';

export interface ParsedLocation {
  lat: number;
  lon: number;
  accuracy?: number;
  name?: string;
  address?: string;
  source: LocationSource;
  isLive: boolean;
  caption?: string;
}

export interface LocationCtxFields {
  LocationLat: number;
  LocationLon: number;
  LocationAccuracy?: number;
  LocationName?: string;
  LocationAddress?: string;
  LocationSource: LocationSource;
  LocationIsLive: boolean;
}

export interface LocationParseResult {
  /** Human-readable text to append to inbound body */
  text: string;
  /** Structured fields for auto-reply context */
  ctx: LocationCtxFields;
  parsed: ParsedLocation;
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function fmtCoord(lat: number, lon: number, accuracy?: number): string {
  const acc = accuracy !== undefined ? ` ±${Math.round(accuracy)}m` : '';
  return `${lat.toFixed(6)}, ${lon.toFixed(6)}${acc}`;
}

function formatLocationText(loc: ParsedLocation): string {
  const coord = fmtCoord(loc.lat, loc.lon, loc.accuracy);
  let line: string;

  if (loc.isLive) {
    line = `🛰 Live location: ${coord}`;
  } else if (loc.name) {
    const addr = loc.address ? ` — ${loc.address}` : '';
    line = `📍 ${loc.name}${addr} (${coord})`;
  } else {
    line = `📍 ${coord}`;
  }

  if (loc.caption) line += `\n${loc.caption}`;
  return line;
}

function toCtx(loc: ParsedLocation): LocationCtxFields {
  const ctx: LocationCtxFields = {
    LocationLat: loc.lat,
    LocationLon: loc.lon,
    LocationSource: loc.source,
    LocationIsLive: loc.isLive
  };
  if (loc.accuracy !== undefined) ctx.LocationAccuracy = loc.accuracy;
  if (loc.name) ctx.LocationName = loc.name;
  if (loc.address) ctx.LocationAddress = loc.address;
  return ctx;
}

function makeResult(loc: ParsedLocation): LocationParseResult {
  return { text: formatLocationText(loc), ctx: toCtx(loc), parsed: loc };
}

// ---------------------------------------------------------------------------
// Telegram
// ---------------------------------------------------------------------------

/**
 * Parse Telegram location/venue/live_location from a message object.
 * Expects the Telegram message body (not the full update).
 */
export function parseTelegramLocation(msg: Record<string, any>): LocationParseResult | null {
  // Live location
  if (msg.live_period !== undefined && msg.location) {
    const loc: ParsedLocation = {
      lat: msg.location.latitude,
      lon: msg.location.longitude,
      accuracy: msg.location.horizontal_accuracy,
      source: 'live',
      isLive: true,
      caption: msg.caption ?? undefined
    };
    return makeResult(loc);
  }

  // Venue
  if (msg.venue) {
    const v = msg.venue;
    const loc: ParsedLocation = {
      lat: v.location.latitude,
      lon: v.location.longitude,
      name: v.title ?? undefined,
      address: v.address ?? undefined,
      source: 'place',
      isLive: false,
      caption: msg.caption ?? undefined
    };
    return makeResult(loc);
  }

  // Simple location pin
  if (msg.location) {
    const loc: ParsedLocation = {
      lat: msg.location.latitude,
      lon: msg.location.longitude,
      accuracy: msg.location.horizontal_accuracy,
      source: 'pin',
      isLive: false,
      caption: msg.caption ?? undefined
    };
    return makeResult(loc);
  }

  return null;
}

// ---------------------------------------------------------------------------
// WhatsApp
// ---------------------------------------------------------------------------

/**
 * Parse WhatsApp locationMessage or liveLocationMessage.
 * Expects the message object from Baileys/WhatsApp Cloud API.
 */
export function parseWhatsAppLocation(msg: Record<string, any>): LocationParseResult | null {
  // Live location
  const liveMsg = msg.liveLocationMessage ?? msg.message?.liveLocationMessage;
  if (liveMsg) {
    const loc: ParsedLocation = {
      lat: liveMsg.degreesLatitude ?? liveMsg.latitude,
      lon: liveMsg.degreesLongitude ?? liveMsg.longitude,
      accuracy: liveMsg.accuracyInMeters,
      name: liveMsg.caption ? undefined : undefined,
      source: 'live',
      isLive: true,
      caption: liveMsg.caption ?? undefined
    };
    if (!isValidCoord(loc.lat, loc.lon)) return null;
    return makeResult(loc);
  }

  // Static location
  const locMsg = msg.locationMessage ?? msg.message?.locationMessage;
  if (locMsg) {
    const loc: ParsedLocation = {
      lat: locMsg.degreesLatitude ?? locMsg.latitude,
      lon: locMsg.degreesLongitude ?? locMsg.longitude,
      accuracy: locMsg.accuracyInMeters,
      name: locMsg.name ?? locMsg.address ?? undefined,
      address: locMsg.address ?? undefined,
      source: locMsg.name ? 'place' : 'pin',
      isLive: false,
      caption: locMsg.comment ?? locMsg.caption ?? undefined
    };
    if (!isValidCoord(loc.lat, loc.lon)) return null;
    return makeResult(loc);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Matrix
// ---------------------------------------------------------------------------

/**
 * Parse Matrix m.location event.
 * Expects the Matrix event content object.
 */
export function parseMatrixLocation(content: Record<string, any>): LocationParseResult | null {
  if (content.msgtype !== 'm.location') return null;

  // geo_uri format: geo:lat,lon or geo:lat,lon;u=accuracy
  const geoUri: string = content.geo_uri ?? '';
  if (!geoUri.startsWith('geo:')) return null;

  const [coords, ...params] = geoUri.slice(4).split(';');
  const [latStr, lonStr] = coords.split(',');
  const lat = parseFloat(latStr);
  const lon = parseFloat(lonStr);
  if (!isValidCoord(lat, lon)) return null;

  let accuracy: number | undefined;
  for (const p of params) {
    if (p.startsWith('u=')) accuracy = parseFloat(p.slice(2));
  }

  const loc: ParsedLocation = {
    lat,
    lon,
    accuracy: isNaN(accuracy!) ? undefined : accuracy,
    source: 'pin',
    isLive: false, // Matrix m.location does not support live locations
    caption: content.body && content.body !== geoUri ? content.body : undefined
  };
  return makeResult(loc);
}

// ---------------------------------------------------------------------------
// Universal dispatcher
// ---------------------------------------------------------------------------

export type SupportedLocationChannel = 'telegram' | 'whatsapp' | 'matrix';

/**
 * Parse location from any supported channel.
 * Returns null if the message does not contain a location.
 */
export function parseChannelLocation(
  channel: SupportedLocationChannel,
  msg: Record<string, any>
): LocationParseResult | null {
  switch (channel) {
    case 'telegram': return parseTelegramLocation(msg);
    case 'whatsapp': return parseWhatsAppLocation(msg);
    case 'matrix':   return parseMatrixLocation(msg);
    default:         return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidCoord(lat: unknown, lon: unknown): lat is number {
  return (
    typeof lat === 'number' && typeof lon === 'number' &&
    !isNaN(lat) && !isNaN(lon) &&
    lat >= -90 && lat <= 90 &&
    lon >= -180 && lon <= 180
  );
}
