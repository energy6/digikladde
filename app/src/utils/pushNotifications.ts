type VapidKeyResponse = {
  enabled: boolean;
  publicKey: string | null;
};

export type PushRegistrationResult =
  | { status: 'subscribed'; subscription: PushSubscription }
  | { status: 'unsupported' }
  | { status: 'permission_required' }
  | { status: 'denied' }
  | { status: 'unavailable' };

type PushRegistrationOptions = {
  requestPermission?: boolean;
};

const normalizeRelayBaseUrl = (value: string): string => value.trim().replace(/\/+$/, '');

export const isPushNotificationSupported = (): boolean => (
  typeof window !== 'undefined'
  && 'serviceWorker' in navigator
  && 'PushManager' in window
  && 'Notification' in window
);

const urlBase64ToUint8Array = (base64String: string): Uint8Array<ArrayBuffer> => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = `${base64String}${padding}`.replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(new ArrayBuffer(rawData.length));

  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index);
  }

  return outputArray;
};

const fetchVapidPublicKey = async (relayBaseUrl: string): Promise<string | null> => {
  const response = await fetch(`${normalizeRelayBaseUrl(relayBaseUrl)}/push/vapid-public-key`, {
    headers: { accept: 'application/json' },
  });

  if (!response.ok) return null;

  const payload = await response.json() as Partial<VapidKeyResponse>;
  if (!payload.enabled || typeof payload.publicKey !== 'string' || !payload.publicKey) return null;

  return payload.publicKey;
};

export const registerPushNotifications = async (
  relayBaseUrl: string,
  options: PushRegistrationOptions = {},
): Promise<PushRegistrationResult> => {
  if (!isPushNotificationSupported()) {
    return { status: 'unsupported' };
  }

  if (Notification.permission === 'denied') {
    return { status: 'denied' };
  }

  const publicKey = await fetchVapidPublicKey(relayBaseUrl);
  if (!publicKey) return { status: 'unavailable' };

  const shouldRequestPermission = options.requestPermission ?? true;
  if (Notification.permission === 'default' && !shouldRequestPermission) {
    return { status: 'permission_required' };
  }

  const permission = Notification.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission();

  if (permission !== 'granted') return { status: 'denied' };

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  if (existing) return { status: 'subscribed', subscription: existing };

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  return { status: 'subscribed', subscription };
};

export const getExistingPushSubscription = async (): Promise<PushSubscription | null> => {
  if (!isPushNotificationSupported()) {
    return null;
  }

  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
};

export const unsubscribePushNotifications = async (): Promise<boolean> => {
  const subscription = await getExistingPushSubscription();
  if (!subscription) return false;
  return subscription.unsubscribe();
};
