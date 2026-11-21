import { Stack } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useAuth } from '../src/auth';
import { ui } from '../src/ui';

/** Home (F4): who is signed in. F5 turns this into the alert feed. */
export default function Home() {
  const { me, session, logout } = useAuth();
  return (
    <View style={ui.screen}>
      <Stack.Screen options={{ title: 'CCTV Alerts' }} />
      <View style={ui.pad}>
        <View style={ui.card}>
          <Text style={ui.h1}>Hi {me?.user.name}</Text>
          <Text style={ui.muted}>{session?.baseUrl}</Text>
          {me?.memberships.map((m) => (
            <Text key={m.organization.id}>
              {m.organization.name} · {m.role}
            </Text>
          ))}
        </View>
        <Pressable style={[ui.button, { backgroundColor: '#687083' }]} onPress={() => void logout()}>
          <Text style={ui.buttonText}>Sign out</Text>
        </Pressable>
      </View>
    </View>
  );
}
