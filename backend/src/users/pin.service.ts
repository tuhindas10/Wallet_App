import {
    BadRequestException,
    ForbiddenException,
    HttpException,
    HttpStatus,
    Injectable,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

@Injectable()
export class PinService {
    constructor(private readonly prisma: PrismaService) { }

    async setPin(userId: string, pin: string, currentPin?: string) {
        const user = await this.prisma.user.findUniqueOrThrow({
            where: { id: userId },
            select: { pinHash: true },
        });

        // Changing an existing PIN requires proving you know the old one
        if (user.pinHash) {
            if (!currentPin) {
                throw new BadRequestException('Enter your current PIN to change it');
            }
            await this.verifyPin(userId, currentPin);
        }

        await this.prisma.user.update({
            where: { id: userId },
            data: {
                pinHash: await argon2.hash(pin),
                pinFailedAttempts: 0,
                pinLockedUntil: null,
            },
        });
        return { message: 'PIN saved' };
    }

    /** Resolves if the PIN is right, throws otherwise. */
    async verifyPin(userId: string, pin: string): Promise<void> {
        const user = await this.prisma.user.findUniqueOrThrow({
            where: { id: userId },
            select: { pinHash: true, pinFailedAttempts: true, pinLockedUntil: true },
        });

        const pinHash = user.pinHash;
        if (!pinHash) throw new BadRequestException('Set a transaction PIN first');

        let attempts = user.pinFailedAttempts;
        const now = new Date();

        if (user.pinLockedUntil) {
            if (user.pinLockedUntil > now) {
                const minutes = Math.ceil(
                    (user.pinLockedUntil.getTime() - now.getTime()) / 60_000,
                );
                throw new HttpException(
                    `PIN is locked. Try again in ${minutes} minute(s).`,
                    HttpStatus.TOO_MANY_REQUESTS,
                );
            }
            // The lock has expired: start fresh
            await this.prisma.user.update({
                where: { id: userId },
                data: { pinLockedUntil: null, pinFailedAttempts: 0 },
            });
            attempts = 0;
        }

        if (await argon2.verify(pinHash, pin)) {
            if (attempts > 0) {
                await this.prisma.user.update({
                    where: { id: userId },
                    data: { pinFailedAttempts: 0 },
                });
            }
            return;
        }

        // Wrong PIN: atomic increment, so parallel guesses can't dodge the counter
        const { pinFailedAttempts } = await this.prisma.user.update({
            where: { id: userId },
            data: { pinFailedAttempts: { increment: 1 } },
            select: { pinFailedAttempts: true },
        });

        if (pinFailedAttempts >= MAX_ATTEMPTS) {
            await this.prisma.user.update({
                where: { id: userId },
                data: {
                    pinFailedAttempts: 0,
                    pinLockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000),
                },
            });
            throw new HttpException(
                `Too many wrong attempts. PIN locked for ${LOCK_MINUTES} minutes.`,
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }

        // 403, not 401. A 401 would make the frontend think the login expired
        throw new ForbiddenException(
            `Incorrect PIN. ${MAX_ATTEMPTS - pinFailedAttempts} attempt(s) left.`,
        );
    }
}