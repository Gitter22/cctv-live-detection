import { Router } from 'express';
import { z } from 'zod';
import { requireUser } from '../auth/session';
import { db } from '../lib/db';

/** Phones register their Expo push token after login; unregister on logout. */
export const pushRouter = Router();

const Device = z.object({
  token: z.string().regex(/^Expo(nent)?PushToken\[[^\]]+\]$/, 'not an Expo push token'),
  platform: z.enum(['android', 'ios']),
});

pushRouter.post('/push/devices', async (req, res) => {
  const user = requireUser(req);
  const { token, platform } = Device.parse(req.body);
  // A token belongs to one phone: if another user registered it before, it moves to this user.
  await db.pushDevice.upsert({
    where: { token },
    update: { userId: user.id, platform, lastSeenAt: new Date() },
    create: { userId: user.id, token, platform },
  });
  res.status(204).end();
});

pushRouter.delete('/push/devices', async (req, res) => {
  const user = requireUser(req);
  const { token } = Device.pick({ token: true }).parse(req.body);
  await db.pushDevice.deleteMany({ where: { token, userId: user.id } });
  res.status(204).end();
});
