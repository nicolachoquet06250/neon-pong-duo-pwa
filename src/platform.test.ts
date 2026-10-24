import { describe, expect, it } from 'vitest';
import { detectDeviceMode } from './platform.ts';

describe('device mode from User-Agent', () => {
  it('opens guest mode on the Meta Ray-Ban Display signature', () => {
    expect(detectDeviceMode('Mozilla/5.0 (Linux; Android 14; Greatwhite Build/ABC.123) AppleWebKit/537.36')).toBe('glasses');
  });

  it('matches Greatwhite Build/ without case sensitivity', () => {
    expect(detectDeviceMode('android; GREATWHITE  BUILD/125')).toBe('glasses');
  });

  it('opens host mode on other Android browsers', () => {
    expect(detectDeviceMode('Mozilla/5.0 (Linux; Android 16; Pixel 10) AppleWebKit/537.36 Chrome/131')).toBe('phone');
  });

  it('rejects browsers without Android, including desktop Chrome', () => {
    expect(detectDeviceMode('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130')).toBe('unsupported');
    expect(detectDeviceMode('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('unsupported');
    expect(detectDeviceMode('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('unsupported');
    expect(detectDeviceMode('')).toBe('unsupported');
  });

  it('requires Android even if the Greatwhite signature is present', () => {
    expect(detectDeviceMode('Greatwhite Build/123')).toBe('unsupported');
  });
});
