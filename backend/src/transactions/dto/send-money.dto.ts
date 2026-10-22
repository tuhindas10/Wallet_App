import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
    IsInt,
    IsOptional,
    IsString,
    Matches,
    Max,
    MaxLength,
    Min,
} from 'class-validator';

export class SendMoneyDto {
    @ApiProperty({ example: 'priya_k' })
    @IsString()
    @Matches(/^[a-zA-Z0-9_]{3,20}$/, { message: 'Enter a valid username' })
    recipientUsername: string;

    @ApiProperty({ example: 25000, description: 'Amount in paise (25000 = ₹250)' })
    @IsInt()
    @Min(100) // ₹1 minimum
    @Max(1_000_000) // ₹10,000 maximum per payment
    amountPaise: number;

    @ApiProperty({ example: '4821' })
    @IsString()
    @Matches(/^\d{4,6}$/, { message: 'PIN must be 4 to 6 digits' })
    pin: string;

    @ApiPropertyOptional({ example: 'Lunch' })
    @IsOptional()
    @IsString()
    @MaxLength(100)
    note?: string;
}