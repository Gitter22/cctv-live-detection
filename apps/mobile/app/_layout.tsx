import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Redirect, Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { useEffect } from 'react';
import { AuthProvider, useAuth } from '../src/auth';
import { registerForPush, useNotificationTaps } from '../src/push';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1 } } });

function Gate() {
  const { ready, session } = useAuth();
  const path = usePathname();
  useNotificationTaps();
  useEffect(() => {
    if (session) void registerForPush(session);
  }, [session]);
  if (!ready)
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  if (!session && path !== '/login') return <Redirect href="/login" />;
  return <Stack screenOptions={{ headerTitleStyle: { fontWeight: '700' } }} />;
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <StatusBar style="auto" />
        <Gate />
      </AuthProvider>
    </QueryClientProvider>
  );
}
