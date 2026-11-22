import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { useEffect } from 'react';
import { AuthProvider, useAuth } from '../src/auth';
import { registerForPush, useNotificationTaps } from '../src/push';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1 } } });

function Gate() {
  const { ready, session } = useAuth();
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
  // Protected routes keep the navigator mounted when the session changes (swapping it for a
  // <Redirect> left a blank screen after sign-out). The router moves to the allowed screen.
  return (
    <Stack screenOptions={{ headerTitleStyle: { fontWeight: '700' } }}>
      <Stack.Protected guard={!!session} redirectTo="/login">
        <Stack.Screen name="index" />
        <Stack.Screen name="alert/[id]" />
        <Stack.Screen name="live/index" />
      </Stack.Protected>
      <Stack.Protected guard={!session} redirectTo="/">
        <Stack.Screen name="login" />
      </Stack.Protected>
    </Stack>
  );
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
