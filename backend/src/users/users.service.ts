import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { userSelect } from './user.select';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) { }

  getMe(userId: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: userSelect,
    });
  }
  async lookup(username: string) {
    const user = await this.prisma.user.findUnique({
      where: { username: username.trim().toLowerCase() },
      select: { username: true, name: true, photoUrl: true },
    });
    if (!user) throw new NotFoundException('No user with that username');
    return user;
  }

  async updateMe(userId: string, dto: UpdateProfileDto) {
    try {
      return await this.prisma.user.update({
        where: { id: userId },
        data: {
          name: dto.name?.trim(),
          email: dto.email?.toLowerCase(),
          phone: dto.phone,
        },
        select: userSelect,
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException('Email or phone is already in use');
      }
      throw e;
    }
  }

  setPhoto(userId: string, filename: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { photoUrl: `/uploads/${filename}` },
      select: userSelect,
    });
  }
}