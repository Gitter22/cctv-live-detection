import { Link, Stack } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { type Alert, timeAgo, useAlerts } from '../src/alerts';
import { useAuth } from '../src/auth';
import { usePushStatus } from '../src/push';
import { colors, ui } from '../src/ui';

const SEV = { danger: colors.danger, warning: colors.warning, info: colors.info };

export default function AlertsScreen() {
  const { logout, me } = useAuth();
  const [filter, setFilter] = useState<'OPEN' | 'ALL'>('OPEN');
  const alerts = useAlerts(filter);
  const push = usePushStatus();
  return (
    <View style={ui.screen}>
      <Stack.Screen
        options={{
          title: me?.memberships[0]?.organization.name ?? 'Alerts',
          headerRight: () => (
            <Pressable testID="sign-out" onPress={() => void logout()} accessibilityRole="button">
              <Text style={{ color: colors.primary, fontWeight: '600' }}>Sign out</Text>
            </Pressable>
          ),
        }}
      />
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 12 }}>
        {(['OPEN', 'ALL'] as const).map((f) => (
          <Pressable key={f} testID={`filter-${f.toLowerCase()}`} onPress={() => setFilter(f)} style={[pill.base, filter === f && pill.on]} accessibilityRole="button">
            <Text style={[pill.text, filter === f && { color: '#fff' }]}>{f === 'OPEN' ? 'Open' : 'All'}</Text>
          </Pressable>
        ))}
      </View>
      {push ? (
        <Text testID="push-status" style={[ui.muted, { paddingHorizontal: 16, paddingTop: 6, fontSize: 12 }]}>
          {push}
        </Text>
      ) : null}
      <FlatList
        data={alerts.data ?? []}
        keyExtractor={(a) => a.id}
        contentContainerStyle={ui.pad}
        refreshControl={<RefreshControl refreshing={alerts.isRefetching} onRefresh={() => void alerts.refetch()} />}
        ListEmptyComponent={<Text style={[ui.muted, { textAlign: 'center', marginTop: 32 }]}>{alerts.isLoading ? 'Loading…' : alerts.isError ? alerts.error.message : 'No alerts.'}</Text>}
        renderItem={({ item }) => <AlertRow alert={item} />}
      />
    </View>
  );
}

function AlertRow({ alert }: { alert: Alert }) {
  return (
    <Link href={`/alert/${alert.id}`} asChild>
      <Pressable testID="alert-row" style={[ui.card, { borderLeftWidth: 5, borderLeftColor: SEV[alert.severity] }]} accessibilityRole="button">
        <Text style={{ fontWeight: '700', fontSize: 16, color: colors.text }}>{alert.title}</Text>
        <Text style={ui.muted}>
          {alert.severity} · {timeAgo(alert.createdAt)} · {alert.status.toLowerCase()}
        </Text>
      </Pressable>
    </Link>
  );
}

const pill = {
  base: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff' },
  on: { backgroundColor: colors.primary, borderColor: colors.primary },
  text: { fontWeight: '600' as const, color: colors.text },
};
