import request from 'supertest';
import { createApp } from '../src/app';
import { PASSWORD } from './factories';

export const app = createApp();

/** A supertest agent logged in as `email` (cookie session). */
export async function agentFor(email: string, password = PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
  return agent;
}
