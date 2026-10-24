import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { X509Certificate } from 'node:crypto';
import { localIpv4Addresses } from './local-network.mjs';

/** TLS is enabled only for `npm run dev`. Production stays HTTP behind a TLS reverse proxy. */
export async function loadDevTls(root) {
  const customKey = process.env.DEV_TLS_KEY;
  const customCert = process.env.DEV_TLS_CERT;
  if (Boolean(customKey) !== Boolean(customCert)) {
    throw new Error('DEV_TLS_KEY and DEV_TLS_CERT must both be provided.');
  }
  if (customKey && customCert) {
    return {
      key: fs.readFileSync(path.resolve(root, customKey)),
      cert: fs.readFileSync(path.resolve(root, customCert))
    };
  }

  // Include LAN interface IPs automatically so the certificate matches the URL
  // entered on a phone. It is still self-signed and NOT trusted by default.
  const hosts = [...new Set(['localhost', '127.0.0.1', '::1',
    ...localIpv4Addresses(),
    ...(process.env.DEV_TLS_HOSTS ?? '').split(',').map(s => s.trim()).filter(Boolean)])];
  const certDir = process.env.DEV_TLS_DIR ? path.resolve(root, process.env.DEV_TLS_DIR) : path.join(root, '.cert');
  const keyFile = path.join(certDir, 'dev-key.pem');
  const certFile = path.join(certDir, 'dev-cert.pem');
  const readCached = () => {
    if (!fs.existsSync(keyFile) || !fs.existsSync(certFile)) return null;
    try {
      const key = fs.readFileSync(keyFile);
      const cert = fs.readFileSync(certFile);
      const parsed = new X509Certificate(cert);
      if (Date.parse(parsed.validTo) < Date.now() + 24 * 60 * 60 * 1000 ||
          !hosts.every(host => net.isIP(host) ? parsed.checkIP(host) : parsed.checkHost(host))) return null;
      return { key, cert };
    } catch { return null; }
  };
  const cached = readCached();
  if (cached) return cached;

  // Pure JavaScript generation: works on Windows, macOS and Linux without OpenSSL.
  const { default: selfsigned } = await import('selfsigned');
  const now = new Date();
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], {
    algorithm: 'sha256',
    notBeforeDate: new Date(now.getTime() - 60_000),
    notAfterDate: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000),
    extensions: [
      { name: 'basicConstraints', cA: false, critical: true },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames: hosts.map(host => net.isIP(host)
        ? { type: 7, ip: host } : { type: 2, value: host }) }
    ]
  });
  fs.mkdirSync(certDir, { recursive: true });
  fs.writeFileSync(keyFile, pems.private, { mode: 0o600 });
  fs.writeFileSync(certFile, pems.cert, { mode: 0o600 });
  process.stdout.write(`Generated local development TLS certificate in ${certDir}\n`);
  return { key: pems.private, cert: pems.cert };
}
