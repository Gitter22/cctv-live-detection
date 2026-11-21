import { PrismaClient } from '@prisma/client';

/** One Prisma client per process. */
export const db = new PrismaClient();
