import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import { api, type Session } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

// Last registration result, shown on the alerts screen (and read by the Maestro tests).
let status = '';
const listeners = new Set<() => void>();
function setStatus(s: string) {
  status = s;
  listeners.forEach((l) => l());
}
export function usePushStatus() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => status,
  );
}

/**
 * Ask permission, get this phone's Expo push token and register it with the server.
 * Needs an EAS project id (app.json extra.eas.projectId, created by `eas init`).
 * Returns a short status for the UI.
 */
export async function registerForPush(session: Session): Promise<string> {
  const s = await register(session).catch((e: unknown) => `Push failed: ${e instanceof Error ? e.message : String(e)}`);
  setStatus(s);
  return s;
}

async function register(session: Session): Promise<string> {
  // The iOS Simulator can't get a push token. Android emulators can, if their system image
  // includes Google Play (that's how the E2E tests receive pushes).
  if (!Device.isDevice && Platform.OS === 'ios') return 'Push needs a real phone';
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('alerts', { name: 'Alerts', importance: Notifications.AndroidImportance.HIGH });
    await Notifications.setNotificationChannelAsync('alerts-danger', {
      name: 'Danger alerts',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 400, 200, 400],
      bypassDnd: false,
    });
  }
  const perm = await Notifications.getPermissionsAsync();
  const granted = perm.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return 'Notifications are switched off for this app';
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  if (!projectId) return 'Push not set up yet (run `eas init` once)';
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  await api(session, 'POST', '/push/devices', { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' });
  return 'Push notifications on';
}

/** Tapping a notification opens that alert. */
export function useNotificationTaps() {
  useEffect(() => {
    const open = (r: Notifications.NotificationResponse | null) => {
      const alertId = (r?.notification.request.content.data as { alertId?: string } | undefined)?.alertId;
      if (alertId) router.push(`/alert/${alertId}`);
    };
    void Notifications.getLastNotificationResponseAsync().then(open); // app was opened by a tap
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, []);
}
