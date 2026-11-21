import { StyleSheet } from 'react-native';

export const colors = { primary: '#1f6feb', danger: '#d1242f', warning: '#bf8700', info: '#0969da', ok: '#1a7f37', muted: '#687083', border: '#dde1e7', bg: '#f6f7f9', card: '#ffffff', text: '#1c2230' };

export const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  pad: { padding: 16, gap: 12 },
  card: { backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 14 },
  h1: { fontSize: 22, fontWeight: '700', color: colors.text },
  label: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, backgroundColor: '#fff', color: colors.text },
  button: { backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  muted: { color: colors.muted },
  error: { color: colors.danger },
});
