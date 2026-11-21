/**
 * Build RTSP URLs from a source (vendor template + credentials) and a camera channel.
 * Credentials are percent-encoded here, so users type plain passwords (an "@" or "#"
 * in a password can no longer break the URL).
 */

export interface DeviceInfo {
  vendor: string | null;
  host: string | null;
  rtspPort: number | null;
  username: string | null;
  password: string | null;
}

export type StreamKind = 'sub' | 'main';

/** Path for a vendor's channel/stream. `null` = no template (generic needs explicit URLs). */
export function vendorPath(vendor: string | null, channel: number, stream: StreamKind): string | null {
  switch (vendor) {
    case 'dahua':
      // Dahua/Amcrest/most rebrands: subtype 0 = main, 1 = sub
      return `/cam/realmonitor?channel=${channel}&subtype=${stream === 'main' ? 0 : 1}`;
    case 'hikvision':
      // Hikvision: channel 1 main = 101, sub = 102
      return `/Streaming/Channels/${channel}0${stream === 'main' ? 1 : 2}`;
    default:
      return null;
  }
}

export function deviceUrl(d: DeviceInfo, channel: number, stream: StreamKind): string | null {
  const path = vendorPath(d.vendor, channel, stream);
  if (!path || !d.host) return null;
  const auth = d.username
    ? `${encodeURIComponent(d.username)}${d.password ? `:${encodeURIComponent(d.password)}` : ''}@`
    : '';
  return `rtsp://${auth}${d.host}:${d.rtspPort ?? 554}${path}`;
}
