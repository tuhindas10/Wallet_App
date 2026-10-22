import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

@Module({
    imports: [UsersModule], // gives access to PinService
    controllers: [TransactionsController],
    providers: [TransactionsService],
})
export class TransactionsModule { }