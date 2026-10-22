import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

const PIN_RULE = /^\d{4,6}$/;
const PIN_MSG = 'PIN must be 4 to 6 digits';

export class SetPinDto {
    @ApiProperty({ example: '4821' })
    @IsString()
    @Matches(PIN_RULE, { message: PIN_MSG })
    pin: string;

    @ApiPropertyOptional({
        description: 'Required only when changing an existing PIN',
    })
    @IsOptional()
    @IsString()
    @Matches(PIN_RULE, { message: PIN_MSG })
    currentPin?: string;
}