/**
 * Push notification service for PWA
 * Handles service worker registration, subscription management, and notification display
 */

export interface NotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: Record<string, unknown>;
  actions?: NotificationAction[];
}

interface NotificationAction {
  action: string;
  title: string;
  icon?: string;
}

const VAPID_PUBLIC_KEY = 'PLACEHOLDER_VAPID_PUBLIC_KEY'; // Set via environment variable
const SW_PATH = '/sw.js';

class PushNotificationService {
  private registration: ServiceWorkerRegistration | null = null;
  private subscription: PushSubscription | null = null;

  get isSupported(): boolean {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  get permission(): NotificationPermission {
    return Notification.permission;
  }

  async init(): Promise<void> {
    if (!this.isSupported) return;

    try {
      this.registration = await navigator.serviceWorker.register(SW_PATH);
      await this.registration.update();

      // Check existing subscription
      this.subscription = await this.registration.pushManager.getSubscription();
    } catch (err) {
      console.error('Push notification init failed:', err);
    }
  }

  async requestPermission(): Promise<NotificationPermission> {
    if (!this.isSupported) return 'denied';
    return await Notification.requestPermission();
  }

  async subscribe(): Promise<PushSubscription | null> {
    if (!this.registration) await this.init();
    if (!this.registration) return null;

    const permission = await this.requestPermission();
    if (permission !== 'granted') return null;

    try {
      this.subscription = await this.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });

      // Send subscription to backend
      await this.syncSubscription(this.subscription);
      return this.subscription;
    } catch (err) {
      console.error('Push subscription failed:', err);
      return null;
    }
  }

  async unsubscribe(): Promise<boolean> {
    if (!this.subscription) return false;
    const result = await this.subscription.unsubscribe();
    if (result) this.subscription = null;
    return result;
  }

  async showLocalNotification(payload: NotificationPayload): Promise<void> {
    if (!this.registration) return;
    if (Notification.permission !== 'granted') return;

    await this.registration.showNotification(payload.title, {
      body: payload.body,
      icon: payload.icon || '/icons/icon-192x192.png',
      badge: payload.badge || '/icons/badge-72x72.png',
      tag: payload.tag,
      data: payload.data,
      actions: payload.actions,
      vibrate: [200, 100, 200],
    });
  }

  private async syncSubscription(subscription: PushSubscription): Promise<void> {
    try {
      await fetch('/api/trpc/notifications.registerPush', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          json: { subscription: subscription.toJSON() },
        }),
      });
    } catch (err) {
      console.error('Failed to sync push subscription:', err);
    }
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export const pushService = new PushNotificationService();
