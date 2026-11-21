import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import { useAuth } from './auth';

export interface Alert {
  id: string;
  siteId: string;
  cameraKey: string | null;
  severity: 'info' | 'warning' | 'danger';
  status: 'OPEN' | 'ACKED' | 'CLOSED';
  title: string;
  ruleName: string | null;
  createdAt: string;
  notes: { at: string; byName: string; text: string }[];
  snapshotUrl: string | null;
  event: { type: string; face: { personId: string | null; similarity: number | null } | null } | null;
}

/** The org to show: the first membership (multi-org switching can come later). */
export function useOrgId() {
  return useAuth().me?.memberships[0]?.organization.id ?? null;
}

export function useAlerts(status: 'OPEN' | 'ALL') {
  const { session } = useAuth();
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['alerts', orgId, status],
    queryFn: () => api<{ alerts: Alert[] }>(session!, 'GET', `/orgs/${orgId}/alerts?limit=100${status === 'OPEN' ? '&status=OPEN' : ''}`).then((r) => r.alerts),
    enabled: !!session && !!orgId,
    refetchInterval: 15_000, // live enough while open; push notifications cover the closed app
  });
}

export function useAlert(id: string) {
  const { session } = useAuth();
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['alert', orgId, id],
    queryFn: () => api<{ alert: Alert }>(session!, 'GET', `/orgs/${orgId}/alerts/${id}`).then((r) => r.alert),
    enabled: !!session && !!orgId,
  });
}

export function useAlertAction(id: string) {
  const { session } = useAuth();
  const orgId = useOrgId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { action: 'ack' | 'close' | 'reopen' | 'notes'; text?: string }) =>
      api(session!, 'POST', `/orgs/${orgId}/alerts/${id}/${v.action}`, v.text ? { text: v.text } : {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['alerts', orgId] });
      void qc.invalidateQueries({ queryKey: ['alert', orgId, id] });
    },
  });
}

export function timeAgo(iso: string, now = Date.now()) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86_400)}d ago`;
}
