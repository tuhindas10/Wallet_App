import { createHash, randomBytes } from 'crypto';

export const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

export const randomToken = (bytes = 48) => randomBytes(bytes).toString('hex');

// Human-friendly receipt ID, e.g. TXN8F3K2A91C4
export const generatePublicTxnId = () =>
  'TXN' + randomBytes(5).toString('hex').toUpperCase();