import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { del, errorMessage, post } from '../api/client';
import { keys, usePeople } from '../api/hooks';
import type { Alert } from '../api/types';
import { useOrgCtx } from '../components/Layout';
import { ErrorText } from '../components/ui';

/** Settings → People: known people (biometric data, org-scoped). Faces are enrolled from face alerts. */
export function PeopleTab() {
  const { orgId, can } = useOrgCtx();
  const qc = useQueryClient();
  const people = usePeople(orgId);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: keys.people(orgId) });
  const create = useMutation({
    mutationFn: () => post(`/orgs/${orgId}/people`, { name }),
    onSuccess: () => {
      setName('');
      void refresh();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const remove = useMutation({ mutationFn: (id: string) => del(`/orgs/${orgId}/people/${id}`), onSuccess: refresh });
  const manage = can('config.write') && can('footage.read');
  return (
    <div className="page">
      <p className="muted">
        Known people are matched against faces seen by cameras with "Recognise faces" switched on. Add a face to a person from a face alert ("Mark as known person"). A face
        that doesn't match anyone is reported as <em>unknown</em>, meaning "couldn't confirm".
      </p>
      {manage && (
        <form
          className="card form-row"
          aria-label="Add person"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            create.mutate();
          }}
        >
          <label className="grow">
            Name
            <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Family member or employee" />
          </label>
          <button className="btn btn-primary" disabled={create.isPending}>
            Add person
          </button>
        </form>
      )}
      <ErrorText error={error} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Face samples</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(people.data ?? []).map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.faces === 0 ? <span className="muted">none yet</span> : p.faces}</td>
                <td className="right">
                  {manage && (
                    <button className="btn btn-sm btn-danger" onClick={() => confirm(`Delete ${p.name} and all their face samples?`) && remove.mutate(p.id)}>
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** On a face alert: who it is (if known) and "mark as known person" enrolment. */
export function FacePanel({ alert }: { alert: Alert }) {
  const { orgId, can } = useOrgCtx();
  const qc = useQueryClient();
  const people = usePeople(orgId);
  const [personId, setPersonId] = useState('');
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const face = alert.event?.face;
  const enrol = useMutation({
    mutationFn: async () => {
      let id = personId;
      if (!id) id = (await post<{ person: { id: string } }>(`/orgs/${orgId}/people`, { name: newName })).person.id;
      await post(`/orgs/${orgId}/people/${id}/faces`, { eventId: alert.event!.id });
    },
    onSuccess: () => {
      setDone(true);
      void qc.invalidateQueries({ queryKey: keys.people(orgId) });
      void qc.invalidateQueries({ queryKey: keys.alerts(orgId) });
    },
    onError: (e) => setError(errorMessage(e)),
  });
  if (!face) return null;
  const known = people.data?.find((p) => p.id === face.personId);
  return (
    <section className="face-panel">
      <p>
        {known ? (
          <>
            <span className="badge badge-ok">Known</span> {known.name}{' '}
            <span className="muted small">similarity {(face.similarity ?? 0).toFixed(2)}</span>
          </>
        ) : (
          <>
            <span className="badge badge-danger">Unknown</span> <span className="muted small">no enrolled person matched</span>
          </>
        )}
      </p>
      {can('config.write') && !done && (
        <form
          className="form-row"
          aria-label="Mark as known person"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            enrol.mutate();
          }}
        >
          <select aria-label="Person" value={personId} onChange={(e) => setPersonId(e.target.value)}>
            <option value="">New person…</option>
            {(people.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {!personId && <input aria-label="New person's name" required placeholder="Name" value={newName} onChange={(e) => setNewName(e.target.value)} />}
          <button className="btn btn-sm" disabled={enrol.isPending}>
            Mark as known person
          </button>
        </form>
      )}
      {done && <p className="muted small">Saved: this face will be recognised from now on.</p>}
      <ErrorText error={error} />
    </section>
  );
}
