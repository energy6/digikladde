/// <reference lib="webworker" />

import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { resolveEncryptedPush } from './utils/encryptedPush';

declare const self: ServiceWorkerGlobalScope;

const resolveAssetUrl = (path: string) => new URL(path, self.registration.scope).toString();

void self.skipWaiting();

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let payload: unknown;
    try {
      payload = event.data?.json() as unknown;
    } catch {
      console.warn('Push: Nachricht ist kein JSON.');
    }
    const notification = await resolveEncryptedPush(payload);
    if (!notification) return;
    await self.registration.showNotification(notification.title, {
      body: notification.body,
      icon: resolveAssetUrl('icon-192.png'),
      badge: resolveAssetUrl('notification-badge.png'),
      tag: 'digikladde-sync',
    });
  })());
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
