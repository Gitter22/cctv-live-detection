import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { api } from '../../src/api';
import { useOrgId } from '../../src/alerts';
import { useAuth } from '../../src/auth';
import { colors, ui } from '../../src/ui';

/**
 * Live view: the web app's embed player in a WebView (Android WebView supports WebRTC).
 * The token is injected into the page's JS before load; it never appears in the URL.
 */
export default function Live() {
  const { site, key } = useLocalSearchParams<{ site: string; key: string }>();
  const { session } = useAuth();
  const orgId = useOrgId();
  const [hd, setHd] = useState(false);
  const cams = useQuery({
    queryKey: ['cameras', orgId, site],
    queryFn: () => api<{ cameras: { id: string; key: string; label: string }[] }>(session!, 'GET', `/orgs/${orgId}/sites/${site}/cameras`).then((r) => r.cameras),
    enabled: !!session && !!orgId && !!site,
  });
  const cam = cams.data?.find((c) => c.key === key);
  const url = cam && session ? `${session.baseUrl.replace(/\/$/, '')}/embed/live?org=${orgId}&site=${site}&cam=${cam.id}${hd ? '&hd=1' : ''}` : null;
  return (
    <View style={[ui.screen, { backgroundColor: '#000' }]}>
      <Stack.Screen
        options={{
          title: cam?.label ?? 'Live',
          headerRight: () => (
            <Pressable onPress={() => setHd((v) => !v)}>
              <Text style={{ color: colors.primary, fontWeight: '700' }}>{hd ? 'HD' : 'SD'}</Text>
            </Pressable>
          ),
        }}
      />
      {url && session ? (
        <WebView
          key={url}
          source={{ uri: url }}
          injectedJavaScriptBeforeContentLoaded={`window.__CCTV_TOKEN = ${JSON.stringify(session.token)}; true;`}
          mediaPlaybackRequiresUserAction={false}
          allowsInlineMediaPlayback
          style={{ flex: 1, backgroundColor: '#000' }}
        />
      ) : (
        <Text style={[ui.muted, { padding: 16 }]}>{cams.isError ? cams.error.message : 'Loading…'}</Text>
      )}
    </View>
  );
}
