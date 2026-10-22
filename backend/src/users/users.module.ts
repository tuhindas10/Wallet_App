import { Module } from '@nestjs/common';
import { PinService } from './pin.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService, PinService],
  exports: [UsersService, PinService],
})
export class UsersModule { }