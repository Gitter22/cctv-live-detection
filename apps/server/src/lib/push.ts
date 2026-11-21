import type { Alert } from '@prisma/client';
import { bus } from './bus';
import { db } from './db';
import { logger } from './logger';

/**
 * Alert push notifications via the Expo push service (free; it forwards to FCM/APNs).
 * Recipients: members of the alert's organization who may see that site (role VIEWER+ always
 * has footage.read; site limits respected). The platform admin is never notified.
 */
const EXPO_PUSH_URL = process.env.EXPO_PUSH_URL ?? 'https://exp.host/--/api/v2/push/send';
const EMOJI = { danger: '🚨', warning: '⚠️', info: 'ℹ️' } as const;

export async function recipientsFor(alert: Pick<Alert, 'organizationId' | 'siteId'>) {
  const members = await db.membership.findMany({
    where: { organizationId: alert.organizationId },
    select: { userId: true, siteIds: true, user: { select: { disabled: true } } },
  });
  const userIds = members.filter((m) => !m.user.disabled && (m.siteIds.length === 0 || m.siteIds.includes(alert.siteId))).map((m) => m.userId);
  return db.pushDevice.findMany({ where: { userId: { in: userIds } } });
}

export async function sendAlertPush(alert: Alert, fetchImpl: typeof fetch = fetch) {
  const devices = await recipientsFor(alert);
  if (!devices.length) return { sent: 0 };
  const messages = devices.map((d) => ({
    to: d.token,
    title: `${EMOJI[alert.severity]} ${alert.title}`,
    body: alert.cameraKey ? `Camera ${alert.cameraKey}` : 'Tap to view',
    data: { alertId: alert.id, orgId: alert.organizationId },
    sound: 'default',
    priority: 'high',
    channelId: alert.severity === 'danger' ? 'alerts-danger' : 'alerts',
  }));
  try {
    const res = await fetchImpl(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => null)) as { data?: { status: string; details?: { error?: string } }[] } | null;
    // Forget phones that uninstalled the app / revoked notifications.
    const dead = (body?.data ?? []).map((t, i) => (t.details?.error === 'DeviceNotRegistered' ? devices[i]?.token : null)).filter(Boolean) as string[];
    if (dead.length) await db.pushDevice.deleteMany({ where: { token: { in: dead } } });
    return { sent: messages.length, removed: dead.length };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'push send failed');
    return { sent: 0 };
  }
}

export function startPushNotifier() {
  const onAlert = (a: Alert) => void sendAlertPush(a);
  bus.on('alert.created', onAlert);
  return () => bus.off('alert.created', onAlert);
}
