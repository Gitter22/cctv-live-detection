import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { useAuth } from '../src/auth';
import { ui } from '../src/ui';

export default function Login() {
  const { login } = useAuth();
  const [baseUrl, setBaseUrl] = useState('http://192.168.1.');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await login(baseUrl.trim(), email.trim(), password);
      router.replace('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={ui.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: 'Sign in' }} />
      <View style={[ui.pad, { paddingTop: 32 }]}>
        <Text style={ui.h1}>Vigil</Text>
        <View>
          <Text style={ui.label}>Server address</Text>
          <TextInput style={ui.input} testID="login-server" value={baseUrl} onChangeText={setBaseUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="http://192.168.1.50:5173" />
          <Text style={[ui.muted, { fontSize: 12, marginTop: 4 }]}>The web app address (same Wi-Fi, Tailscale or your public hub).</Text>
        </View>
        <View>
          <Text style={ui.label}>Email</Text>
          <TextInput style={ui.input} testID="login-email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
        </View>
        <View>
          <Text style={ui.label}>Password</Text>
          <TextInput style={ui.input} testID="login-password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" />
        </View>
        {error && <Text testID="login-error" style={ui.error}>{error}</Text>}
        <Pressable style={[ui.button, busy && { opacity: 0.6 }]} testID="login-submit" onPress={submit} disabled={busy} accessibilityRole="button">
          <Text style={ui.buttonText}>{busy ? 'Signing in…' : 'Sign in'}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
