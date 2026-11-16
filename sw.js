// Service worker do Tax Manager: exibe os avisos na central de notificações do Windows
// e abre a plataforma quando a pessoa clica no aviso. (O "push" abaixo já deixa o terreno pronto
// para avisos com o navegador fechado, quando o envio pelo servidor for ligado.)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { corpo: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.titulo || 'Tax Manager', {
    body: d.corpo || '', icon: 'assets/icon-192.png', badge: 'assets/icon-48.png', tag: d.tag, data: { href: d.href || 'dashboard.html' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const alvo = new URL((e.notification.data && e.notification.data.href) || 'dashboard.html', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
    const aberta = lista.find(c => c.url.startsWith(self.registration.scope));
    if (aberta) { if ('navigate' in aberta) aberta.navigate(alvo).catch(() => {}); return aberta.focus(); }
    return self.clients.openWindow(alvo);
  }));
});
