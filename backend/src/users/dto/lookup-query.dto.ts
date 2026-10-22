import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class LookupQueryDto {
    @ApiProperty({ example: 'priya_k' })
    @IsString()
    @Matches(/^[a-zA-Z0-9_]{3,20}$/, { message: 'Enter a valid username' })
    username: string;
}