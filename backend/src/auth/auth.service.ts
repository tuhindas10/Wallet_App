import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma, TransactionStatus, TransactionType } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { SIGNUP_BONUS_PAISE } from '../common/constants';
import {
  generatePublicTxnId,
  randomToken,
  sha256,
} from '../common/crypto.util';
import { userSelect } from '../users/user.select';
import { LoginDto, SignupDto } from './dto/auth.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  // ---------- Signup ----------
  async signup(dto: SignupDto) {
    if (!dto.email && !dto.phone) {
      throw new BadRequestException('Provide an email or a phone number');
    }

    const passwordHash = await argon2.hash(dto.password);

    try {
      // User + wallet + bonus ledger entry succeed or fail together
      const user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            username: dto.username.toLowerCase(),
            name: dto.name.trim(),
            email: dto.email?.toLowerCase(),
            phone: dto.phone,
            passwordHash,
          },
          select: userSelect,
        });

        const wallet = await tx.wallet.create({
          data: { userId: created.id, balancePaise: SIGNUP_BONUS_PAISE },
        });

        await tx.transaction.create({
          data: {
            publicTxnId: generatePublicTxnId(),
            type: TransactionType.TOPUP,
            status: TransactionStatus.SUCCESS,
            amountPaise: SIGNUP_BONUS_PAISE,
            note: 'Demo signup bonus',
            receiverWalletId: wallet.id,
          },
        });

        return created;
      });

      return { user, ...(await this.issueTokens(user.id, user.username)) };
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(
          'Username, email or phone is already in use',
        );
      }
      throw e;
    }
  }

  // ---------- Login ----------
  async login(dto: LoginDto) {
    const user = await this.findByIdentifier(dto.identifier);

    // Same message for "no such user" and "wrong password"
    const valid =
      user && (await argon2.verify(user.passwordHash, dto.password));
    if (!user || !valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const profile = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: userSelect,
    });
    return {
      user: profile,
      ...(await this.issueTokens(user.id, user.username)),
    };
  }

  // ---------- Refresh (with rotation + reuse detection) ----------
  async refresh(refreshToken: string) {
    const record = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
      include: { user: { select: { id: true, username: true } } },
    });
    if (!record) throw new UnauthorizedException('Invalid refresh token');

    if (record.revokedAt) {
      // A revoked token came back: treat it as possible theft
      await this.revokeAllSessions(record.userId);
      throw new UnauthorizedException('Session expired, please log in again');
    }
    if (record.expiresAt < new Date()) {
      throw new UnauthorizedException('Session expired, please log in again');
    }

    // Atomically claim the token so two parallel refreshes can't both win
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: record.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return this.issueTokens(record.user.id, record.user.username);
  }

  // ---------- Logout ----------
  async logout(refreshToken: string) {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { message: 'Logged out' };
  }

  // ---------- Forgot / reset password ----------
  async forgotPassword(identifier: string) {
    const user = await this.findByIdentifier(identifier);

    if (user) {
      const token = randomToken(32);
      const minutes = Number(this.config.get('PASSWORD_RESET_MINUTES') ?? 15);
      await this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + minutes * 60_000),
        },
      });

      // DEV ONLY: a real app would email or SMS this link
      const url = this.config.get('FRONTEND_URL');
      this.logger.log(`[DEV] Password reset link: ${url}/reset-password?token=${token}`);
    }

    // Always the same reply, so nobody can discover which accounts exist
    return { message: 'If an account exists, a reset link has been sent.' };
  }

  async resetPassword(token: string, newPassword: string) {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: sha256(token) },
    });
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new BadRequestException('Reset link is invalid or has expired');
    }

    const passwordHash = await argon2.hash(newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      // Force every device to log in again with the new password
      this.prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    return { message: 'Password updated. Please log in.' };
  }

  // ---------- Helpers ----------
  private findByIdentifier(identifier: string) {
    const value = identifier.trim();
    return this.prisma.user.findFirst({
      where: {
        OR: [
          { username: value.toLowerCase() },
          { email: value.toLowerCase() },
          { phone: value },
        ],
      },
    });
  }

  private revokeAllSessions(userId: string) {
    return this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokens(userId: string, username: string) {
    const accessToken = await this.jwt.signAsync({ sub: userId, username });

    const refreshToken = randomToken(48);
    const days = Number(this.config.get('REFRESH_TOKEN_DAYS') ?? 7);
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + days * 86_400_000),
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: Number(this.config.get('JWT_ACCESS_EXPIRES_SECONDS') ?? 900),
    };
  }
}