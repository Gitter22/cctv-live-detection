import { Image } from 'expo-image';
import { Link, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { authedImage } from '../../src/api';
import { timeAgo, useAlert, useAlertAction } from '../../src/alerts';
import { useAuth } from '../../src/auth';
import { colors, ui } from '../../src/ui';

export default function AlertDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const alert = useAlert(id);
  const act = useAlertAction(id);
  const [note, setNote] = useState('');
  const a = alert.data;
  return (
    <ScrollView style={ui.screen} contentContainerStyle={ui.pad}>
      <Stack.Screen options={{ title: 'Alert' }} />
      {!a ? (
        <Text style={ui.muted}>{alert.isError ? alert.error.message : 'Loading…'}</Text>
      ) : (
        <>
          <Text style={ui.h1}>{a.title}</Text>
          <Text style={ui.muted}>
            {a.severity} · {new Date(a.createdAt).toLocaleString()} ({timeAgo(a.createdAt)}) · {a.status.toLowerCase()}
          </Text>
          {a.snapshotUrl && session && (
            <Image source={authedImage(session, a.snapshotUrl)} style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 10, backgroundColor: '#000' }} contentFit="contain" accessibilityLabel="Snapshot" />
          )}
          {a.event?.face && (
            <Text style={{ fontWeight: '600', color: a.event.face.personId ? colors.ok : colors.danger }}>
              {a.event.face.personId ? 'Known person' : 'Unknown person (could not confirm)'}
            </Text>
          )}
          <Text style={ui.muted}>
            Camera {a.cameraKey ?? '—'} · Rule {a.ruleName ?? '—'}
          </Text>
          {a.cameraKey && (
            <Link href={{ pathname: '/live', params: { site: a.siteId, key: a.cameraKey } }} asChild>
              <Pressable style={[ui.button, { backgroundColor: colors.ok }]} accessibilityRole="button">
                <Text style={ui.buttonText}>Watch live</Text>
              </Pressable>
            </Link>
          )}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {a.status === 'OPEN' && (
              <Pressable style={[ui.button, { flex: 1 }]} onPress={() => act.mutate({ action: 'ack' })}>
                <Text style={ui.buttonText}>Acknowledge</Text>
              </Pressable>
            )}
            <Pressable style={[ui.button, { flex: 1, backgroundColor: colors.muted }]} onPress={() => act.mutate({ action: a.status === 'CLOSED' ? 'reopen' : 'close' })}>
              <Text style={ui.buttonText}>{a.status === 'CLOSED' ? 'Reopen' : 'Close'}</Text>
            </Pressable>
          </View>
          {act.isError && <Text style={ui.error}>{act.error.message}</Text>}
          <View style={ui.card}>
            <Text style={ui.label}>Notes</Text>
            {a.notes.map((n, i) => (
              <Text key={i} style={{ marginBottom: 6 }}>
                <Text style={{ fontWeight: '700' }}>{n.byName}</Text> <Text style={ui.muted}>{timeAgo(n.at)}</Text>
                {'\n'}
                {n.text}
              </Text>
            ))}
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
              <TextInput style={[ui.input, { flex: 1 }]} placeholder="Add a note…" value={note} onChangeText={setNote} />
              <Pressable
                style={[ui.button, { paddingHorizontal: 14 }]}
                disabled={!note.trim()}
                onPress={() => act.mutate({ action: 'notes', text: note }, { onSuccess: () => setNote('') })}
              >
                <Text style={ui.buttonText}>Add</Text>
              </Pressable>
            </View>
          </View>
        </>
      )}
    </ScrollView>
  );
}
