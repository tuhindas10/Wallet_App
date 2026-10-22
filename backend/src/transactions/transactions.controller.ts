import {
    BadRequestException,
    Body,
    Controller,
    Get,
    Headers,
    Param,
    Post,
    UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { isUUID } from 'class-validator';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthUser } from '../common/current-user.decorator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { SendMoneyDto } from './dto/send-money.dto';
import { TransactionsService } from './transactions.service';

@ApiTags('transactions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('transactions')
export class TransactionsController {
    constructor(private readonly transactions: TransactionsService) { }

    @Post('send')
    @ApiHeader({
        name: 'Idempotency-Key',
        required: true,
        description: 'A fresh UUID for every new payment attempt',
    })
    send(
        @CurrentUser() user: AuthUser,
        @Headers('idempotency-key') idempotencyKey: string | undefined,
        @Body() dto: SendMoneyDto,
    ) {
        if (!idempotencyKey || !isUUID(idempotencyKey)) {
            throw new BadRequestException(
                'Idempotency-Key header must be a valid UUID',
            );
        }
        return this.transactions.send(user.userId, idempotencyKey, dto);
    }

    @Get(':txnId')
    receipt(@CurrentUser() user: AuthUser, @Param('txnId') txnId: string) {
        return this.transactions.getReceipt(user.userId, txnId);
    }
}