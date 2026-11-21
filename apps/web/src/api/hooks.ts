import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { get } from './client';
import type { Alert, Camera, Edge, Member, OrgDetail, OrgSummary, Person, Rule, Site, Source } from './types';

/** Query keys in one place so mutations can invalidate precisely. */
export const keys = {
  orgs: ['orgs'] as const,
  org: (orgId: string) => ['org', orgId] as const,
  sites: (orgId: string) => ['sites', orgId] as const,
  cameras: (orgId: string, siteId: string) => ['cameras', orgId, siteId] as const,
  sources: (orgId: string, siteId: string) => ['sources', orgId, siteId] as const,
  edges: (orgId: string, siteId: string) => ['edges', orgId, siteId] as const,
  rules: (orgId: string, siteId: string) => ['rules', orgId, siteId] as const,
  members: (orgId: string) => ['members', orgId] as const,
  alerts: (orgId: string) => ['alerts', orgId] as const,
  people: (orgId: string) => ['people', orgId] as const,
};

export const usePeople = (orgId: string, enabled = true) =>
  useQuery({ queryKey: keys.people(orgId), queryFn: () => get<{ people: Person[] }>(`/orgs/${orgId}/people`).then((r) => r.people), enabled });

export const useOrgs = () => useQuery({ queryKey: keys.orgs, queryFn: () => get<{ orgs: OrgSummary[] }>('/orgs').then((r) => r.orgs) });

export const useOrg = (orgId: string) =>
  useQuery({ queryKey: keys.org(orgId), queryFn: () => get<OrgDetail>(`/orgs/${orgId}`), enabled: !!orgId });

export const useSites = (orgId: string) =>
  useQuery({ queryKey: keys.sites(orgId), queryFn: () => get<{ sites: Site[] }>(`/orgs/${orgId}/sites`).then((r) => r.sites), enabled: !!orgId });

export const useCameras = (orgId: string, siteId: string | undefined) =>
  useQuery({
    queryKey: keys.cameras(orgId, siteId ?? ''),
    queryFn: () => get<{ cameras: Camera[] }>(`/orgs/${orgId}/sites/${siteId}/cameras`).then((r) => r.cameras),
    enabled: !!siteId,
    refetchInterval: 30_000, // camera status comes from edge heartbeats
  });

export const useSources = (orgId: string, siteId: string | undefined) =>
  useQuery({
    queryKey: keys.sources(orgId, siteId ?? ''),
    queryFn: () => get<{ sources: Source[] }>(`/orgs/${orgId}/sites/${siteId}/sources`).then((r) => r.sources),
    enabled: !!siteId,
  });

export const useEdges = (orgId: string, siteId: string | undefined) =>
  useQuery({
    queryKey: keys.edges(orgId, siteId ?? ''),
    queryFn: () => get<{ edges: Edge[] }>(`/orgs/${orgId}/sites/${siteId}/edges`).then((r) => r.edges),
    enabled: !!siteId,
    refetchInterval: 30_000,
  });

export const useRules = (orgId: string, siteId: string | undefined) =>
  useQuery({
    queryKey: keys.rules(orgId, siteId ?? ''),
    queryFn: () => get<{ rules: Rule[] }>(`/orgs/${orgId}/sites/${siteId}/rules`).then((r) => r.rules),
    enabled: !!siteId,
  });

export const useMembers = (orgId: string, enabled = true) =>
  useQuery({ queryKey: keys.members(orgId), queryFn: () => get<{ members: Member[] }>(`/orgs/${orgId}/members`).then((r) => r.members), enabled });

export interface AlertFilters {
  siteId?: string;
  status?: string;
  severity?: string;
  cameraKey?: string;
}

export const useAlerts = (orgId: string, filters: AlertFilters = {}, enabled = true) =>
  useQuery({
    queryKey: [...keys.alerts(orgId), filters],
    queryFn: () => get<{ alerts: Alert[]; nextBefore: string | null }>(`/orgs/${orgId}/alerts`, { ...filters, limit: 100 }),
    enabled,
  });

/**
 * Live updates for an org (SSE). New/updated alerts refresh alert queries; camera status
 * changes refresh the camera list. Returns the latest alert pushed (for toasts).
 */
export function useOrgStream(orgId: string, enabled: boolean) {
  const qc = useQueryClient();
  const [lastAlert, setLastAlert] = useState<Alert | null>(null);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (!enabled || !orgId) return;
    const es = new EventSource(`/api/orgs/${orgId}/stream`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false); // EventSource reconnects by itself
    const onAlert = (e: MessageEvent) => {
      void qc.invalidateQueries({ queryKey: keys.alerts(orgId) });
      if (e.type === 'alert.created') setLastAlert(JSON.parse(e.data) as Alert);
    };
    es.addEventListener('alert.created', onAlert);
    es.addEventListener('alert.updated', onAlert);
    es.addEventListener('camera.status', () => void qc.invalidateQueries({ queryKey: ['cameras', orgId] }));
    return () => {
      es.close();
      setConnected(false);
    };
  }, [orgId, enabled, qc]);
  return { lastAlert, connected };
}
