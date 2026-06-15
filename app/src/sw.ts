/// <reference lib="webworker" />

import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope;

type PushPayload = {
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
};

const resolveAssetUrl = (path: string) => new URL(path, self.registration.scope).toString();

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener('push', (event) => {
  const payload = event.data?.json() as PushPayload | undefined;
  const title = payload?.title ?? 'DigiKladde';
  const options: NotificationOptions = {
    body: payload?.body ?? 'Neue Kursdaten verfügbar.',
    icon: resolveAssetUrl('icon-192.png'),
    badge: resolveAssetUrl('notification-badge.png'),
    data: payload?.data ?? {},
    tag: 'digikladde-sync',
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil((async () => {
    const windowClients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });

    const existingClient = windowClients[0];
    if (existingClient) {
      await existingClient.focus();
      return;
    }

    await self.clients.openWindow(self.registration.scope);
  })());
});
