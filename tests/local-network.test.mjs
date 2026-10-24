import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localIpv4Addresses } from '../server/local-network.mjs';

test('LAN IPv4 detection excludes loopback, link-local and IPv6 addresses', () => {
  const interfaces = {
    WiFi: [
      { family: 'IPv4', internal: false, address: '192.168.1.42' },
      { family: 'IPv6', internal: false, address: 'fe80::1234' },
    ],
    Ethernet: [
      { family: 'IPv4', internal: false, address: '10.0.0.3' },
      { family: 'IPv4', internal: false, address: '192.168.1.42' },
    ],
    Loopback: [
      { family: 'IPv4', internal: true, address: '127.0.0.1' },
      { family: 'IPv4', internal: false, address: '169.254.1.2' },
    ],
  };
  assert.deepEqual(localIpv4Addresses(interfaces), ['10.0.0.3', '192.168.1.42']);
});

test('LAN IPv4 detection handles empty interface sets', () => {
  assert.deepEqual(localIpv4Addresses({ eth0: undefined }), []);
});
