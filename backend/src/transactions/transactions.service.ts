import {
    BadRequestException,
    Injectable,
    NotFoundException,
    UnprocessableEntityException,
} from '@nestjs/common';
import {
    NotificationType,
    Prisma,
    TransactionStatus,
    TransactionType,
} from '@prisma/client';
import { generatePublicTxnId } from '../common/crypto.util';
import { formatRupees } from '../common/money.util';
import { PrismaService } from '../prisma/prisma.service';
import { PinService } from '../users/pin.service';
import { SendMoneyDto } from './dto/send-money.dto';
import { toReceipt, txnInclude } from './transaction.mapper';
import type { TxnWithParties } from './transaction.mapper';

@Injectable()
export class TransactionsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly pin: PinService,
    ) { }

    async send(userId: string, idempotencyKey: string, dto: SendMoneyDto) {
        const recipientUsername = dto.recipientUsername.trim().toLowerCase();

        const sender = await this.prisma.user.findUniqueOrThrow({
            where: { id: userId },
            select: { username: true, wallet: { select: { id: true } } },
        });
        if (!sender.wallet) throw new BadRequestException('Wallet not found');
        const senderWalletId = sender.wallet.id;

        // 1. Seen this key before? Return the stored result, never pay twice
        const existing = await this.findByKey(senderWalletId, idempotencyKey);
        if (existing) {
            return this.replay(existing, senderWalletId, recipientUsername, dto.amountPaise);
        }

        // 2. Validate the recipient
        const recipient = await this.prisma.user.findUnique({
            where: { username: recipientUsername },
            select: { id: true, username: true, wallet: { select: { id: true } } },
        });
        if (!recipient || !recipient.wallet) {
            throw new NotFoundException('Recipient not found');
        }
        if (recipient.id === userId) {
            throw new BadRequestException('You cannot send money to yourself');
        }
        const recipientWalletId = recipient.wallet.id;

        // 3. Check the PIN OUTSIDE the money transaction
        await this.pin.verifyPin(userId, dto.pin);

        // 4. Move the money, all or nothing
        try {
            const txn = await this.prisma.$transaction(
                async (tx) => {
                    // Lock both wallets in a fixed order (by id) to prevent deadlocks
                    const lockOrder = [senderWalletId, recipientWalletId].sort();
                    const balances = new Map<string, number>();
                    for (const id of lockOrder) {
                        const rows = await tx.$queryRaw<
                            { id: string; balancePaise: number }[]
                        >`SELECT "id", "balancePaise" FROM "Wallet" WHERE "id" = ${id} FOR UPDATE`;
                        if (!rows[0]) throw new BadRequestException('Wallet not found');
                        balances.set(id, rows[0].balancePaise);
                    }

                    const base = {
                        publicTxnId: generatePublicTxnId(),
                        type: TransactionType.TRANSFER,
                        amountPaise: dto.amountPaise,
                        note: dto.note?.trim() || null,
                        idempotencyKey,
                        senderWalletId,
                        receiverWalletId: recipientWalletId,
                    };

                    // Not enough money: record the failure and commit (no balances change)
                    if ((balances.get(senderWalletId) ?? 0) < dto.amountPaise) {
                        return tx.transaction.create({
                            data: {
                                ...base,
                                status: TransactionStatus.FAILED,
                                failureReason: 'Insufficient balance',
                            },
                            include: txnInclude,
                        });
                    }

                    await tx.wallet.update({
                        where: { id: senderWalletId },
                        data: { balancePaise: { decrement: dto.amountPaise } },
                    });
                    await tx.wallet.update({
                        where: { id: recipientWalletId },
                        data: { balancePaise: { increment: dto.amountPaise } },
                    });

                    const created = await tx.transaction.create({
                        data: { ...base, status: TransactionStatus.SUCCESS },
                        include: txnInclude,
                    });

                    const amount = formatRupees(dto.amountPaise);
                    await tx.notification.createMany({
                        data: [
                            {
                                userId,
                                type: NotificationType.PAYMENT_SENT,
                                message: `You sent ₹${amount} to @${recipient.username}`,
                            },
                            {
                                userId: recipient.id,
                                type: NotificationType.PAYMENT_RECEIVED,
                                message: `You received ₹${amount} from @${sender.username}`,
                            },
                        ],
                    });

                    return created;
                },
                { maxWait: 10_000, timeout: 15_000 },
            );

            return toReceipt(txn, senderWalletId);
        } catch (e) {
            // Two requests with the same key raced: the database let only one win
            if (
                e instanceof Prisma.PrismaClientKnownRequestError &&
                e.code === 'P2002'
            ) {
                const winner = await this.findByKey(senderWalletId, idempotencyKey);
                if (winner) {
                    return this.replay(winner, senderWalletId, recipientUsername, dto.amountPaise);
                }
            }
            throw e;
        }
    }

    async getReceipt(userId: string, txnId: string) {
        const wallet = await this.prisma.wallet.findUniqueOrThrow({
            where: { userId },
            select: { id: true },
        });

        // Only the sender or the receiver may view a transaction
        const txn = await this.prisma.transaction.findFirst({
            where: {
                publicTxnId: txnId,
                OR: [{ senderWalletId: wallet.id }, { receiverWalletId: wallet.id }],
            },
            include: txnInclude,
        });
        if (!txn) throw new NotFoundException('Transaction not found');

        return toReceipt(txn, wallet.id);
    }

    private findByKey(senderWalletId: string, idempotencyKey: string) {
        return this.prisma.transaction.findFirst({
            where: { senderWalletId, idempotencyKey },
            include: txnInclude,
        });
    }

    private replay(
        t: TxnWithParties,
        walletId: string,
        recipientUsername: string,
        amountPaise: number,
    ) {
        const sameRequest =
            t.amountPaise === amountPaise &&
            t.receiverWallet?.user.username === recipientUsername;
        if (!sameRequest) {
            throw new UnprocessableEntityException(
                'This Idempotency-Key was already used for a different payment',
            );
        }
        return toReceipt(t, walletId);
    }
}