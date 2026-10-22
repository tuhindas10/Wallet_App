import { Injectable } from '@nestjs/common';
import { formatRupees } from '../common/money.util';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WalletService {
    constructor(private readonly prisma: PrismaService) { }

    async getMyWallet(userId: string) {
        const wallet = await this.prisma.wallet.findUniqueOrThrow({
            where: { userId },
            select: { balancePaise: true, updatedAt: true },
        });
        return {
            balancePaise: wallet.balancePaise,
            balance: formatRupees(wallet.balancePaise),
            currency: 'INR',
            updatedAt: wallet.updatedAt,
        };
    }
}