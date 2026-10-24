import os from 'node:os';

/** IPv4 addresses reachable through this machine's network interfaces. */
export function localIpv4Addresses(interfaces = os.networkInterfaces()) {
  return [...new Set(Object.values(interfaces)
    .flatMap(entries => entries ?? [])
    .filter(entry => entry.family === 'IPv4' && !entry.internal &&
      !entry.address.startsWith('169.254.'))
    .map(entry => entry.address))].sort();
}
