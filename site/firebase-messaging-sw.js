/* ============================================================
   firebase-messaging-sw.js — OFI 2025 · anti-duplicati
   Mostra notifica SOLO per messaggi data-only.
   Se arriva "notification", lascia fare al browser/FCM.
   ============================================================ */

importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

/* ⚙️ Config Firebase (tuo progetto OFI) */
firebase.initializeApp({
  apiKey: "AIzaSyAy0UMiRscG-F1B9YxT7gHHyxLBOwOo2vs",
  authDomain: "ofi2025-51ba9.firebaseapp.com",
  projectId: "ofi2025-51ba9",
  storageBucket: "ofi2025-51ba9.firebasestorage.app",
  messagingSenderId: "345581339212",
  appId: "1:345581339212:web:f0b8bc241945691c876ae9"
});

const messaging = firebase.messaging();

/* Aggiornamento SW immediato */
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });

/* Dedup semplice in memoria SW */
let __lastShownId = null;

/* === Background handler (FCM) ===
   - Se payload.notification ESISTE → NON fare nulla (Chrome/iOS mostrano già).
   - Se data-only → mostrala UNA volta sola. */
messaging.onBackgroundMessage(async (payload) => {
  try {
    // 1) Notifiche "notification": niente showNotification qui (evita doppioni)
    if (payload && payload.notification) return;

    // 2) Notifiche "data-only": gestiamo noi
    const data = payload?.data || {};

    // Dedup: usa event_id o compone una chiave grezza
    const dedupId = data.event_id || `${data.type || 'evt'}:${data.count || ''}:${data.ts || ''}`;
    if (dedupId && dedupId === __lastShownId) return;
    __lastShownId = dedupId;

    const title = data.title || 'OFI – Notifica';
    const body  = data.body  || '';
    const url   = data.link  || data.click_action || '/admin/dashboard-admin.html';

    const options = {
      body,
      icon: '/images/logo-ofi.png',
      badge: '/images/logo-ofi.png',
      tag: data.tag || `ofi-admin-${data.type || 'evt'}`, // tag → rimpiazza la card precedente
      renotify: false,
      requireInteraction: false,
      data: { url }
    };

    await self.registration.showNotification(title, options);
  } catch (err) {
    // evita crash SW
    // console.warn('onBackgroundMessage error', err);
  }
});

/* Click: riusa una scheda aperta se possibile, altrimenti aprine una nuova */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/admin/dashboard-admin.html';

  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      // se sei già in /admin/, riusa quella tab
      if (client.url.includes('/admin/') && 'focus' in client) {
        client.navigate(target);
        return client.focus();
      }
    }
    if (clients.openWindow) return clients.openWindow(target);
  })());
});
