import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { api, type Session } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

/**
 * Ask permission, get this phone's Expo push token and register it with the server.
 * Needs an EAS project id (app.json extra.eas.projectId, created by `eas init`).
 * Returns a short status for the UI.
 */
export async function registerForPush(session: Session): Promise<string> {
  if (!Device.isDevice) return 'Push needs a real phone';
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
