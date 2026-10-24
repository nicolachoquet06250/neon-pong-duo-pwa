/** Standalone dependency-free page used to isolate network/TLS failures from app rendering. */
export const diagnosticHTML = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="theme-color" content="#000000"><meta name="mrbd-web-app-capable" content="yes"><title>NEON PONG - diagnostic lunettes</title></head>
<body style="margin:0;padding:20px;background:#000;color:#fff;font:18px/1.35 system-ui,Arial,sans-serif;overflow-wrap:anywhere">
  <h1 style="color:#43ffe0;font-size:30px;margin:0 0 12px">PONG · DIAGNOSTIC</h1>
  <p style="font-weight:900;font-size:24px;color:#fff">HTML : OK ✓</p>
  <p id="js" style="color:#ffe066">JavaScript : non exécuté</p>
  <p id="api">API HTTPS : en attente</p>
  <p id="ws">WebSocket : en attente</p>
  <div style="border-top:2px solid #43ffe0;padding-top:12px;font-size:14px">
    <strong>URL :</strong><div id="url"></div>
    <strong>User-Agent :</strong><div id="ua">JavaScript requis</div>
  </div>
  <script>
    (function () {
      function set(id, value) { document.getElementById(id).textContent = value; }
      set('js', 'JavaScript : OK ✓');
      set('url', location.href);
      set('ua', navigator.userAgent || 'indisponible');
      fetch('/api/health', { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (r) { set('api', 'API HTTPS : ' + (r.ok ? 'OK ✓' : 'réponse inattendue')); })
        .catch(function (e) { set('api', 'API HTTPS : erreur ' + e.message); });
      try {
        var protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        var socket = new WebSocket(protocol + '//' + location.host + '/ws');
        var completed = false;
        var finish = function (message) { if (completed) return; completed = true; set('ws', message); socket.close(); };
        socket.addEventListener('open', function () { finish('WebSocket : OK ✓'); });
        socket.addEventListener('error', function () { finish('WebSocket : échec'); });
        setTimeout(function () { finish('WebSocket : délai dépassé'); }, 5000);
      } catch (e) { set('ws', 'WebSocket : exception ' + e.message); }
    })();
  </script>
</body></html>`;

export function isDiagnosticPath(pathname, searchParams) {
  return pathname === '/diagnostic' || (pathname === '/' && searchParams.has('diagnostic'));
}
