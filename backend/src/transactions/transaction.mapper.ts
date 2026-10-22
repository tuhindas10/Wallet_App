import { Prisma } from '@prisma/client';
import { formatRupees } from '../common/money.util';

const party = {
    select: { id: true, user: { select: { name: true, username: true } } },
} as const;

export const txnInclude = {
    senderWallet: party,
    receiverWallet: party,
} satisfies Prisma.TransactionInclude;

export type TxnWithParties = Prisma.TransactionGetPayload<{
    include: typeof txnInclude;
}>;

export function toReceipt(t: TxnWithParties, viewerWalletId: string) {
    return {
        transactionId: t.publicTxnId,
        type: t.type,
        status: t.status,
        direction: t.senderWalletId === viewerWalletId ? 'SENT' : 'RECEIVED',
        amountPaise: t.amountPaise,
        amount: formatRupees(t.amountPaise),
        note: t.note,
        failureReason: t.failureReason,
        sender: t.senderWallet
            ? {
                name: t.senderWallet.user.name,
                username: t.senderWallet.user.username,
            }
            : null,
        receiver: t.receiverWallet
            ? {
                name: t.receiverWallet.user.name,
                username: t.receiverWallet.user.username,
            }
            : null,
        createdAt: t.createdAt,
    };
}