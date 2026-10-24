/**
 * A device profile derived from the browser User-Agent.
 * Greatwhite Build/ is a device-specific signature observed on Meta Ray-Ban Display.
 * This is a heuristic, not an authenticated device identity.
 */
export type DeviceMode = 'phone' | 'glasses' | 'unsupported';

export function detectDeviceMode(userAgent: string): DeviceMode {
  if (!/android/i.test(userAgent)) return 'unsupported';
  return /greatwhite\s+build\//i.test(userAgent) ? 'glasses' : 'phone';
}
