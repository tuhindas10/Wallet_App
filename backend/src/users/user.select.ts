import { Prisma } from '@prisma/client';

export const userSelect = {
  id: true,
  username: true,
  name: true,
  email: true,
  phone: true,
  photoUrl: true,
  createdAt: true,
} satisfies Prisma.UserSelect;