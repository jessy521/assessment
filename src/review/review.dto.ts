import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReviewQueryDto {
  @ApiProperty({
    description: 'Name of the business to search for',
    example: 'Starbucks',
    type: String,
  })
  business: string;

  @ApiProperty({
    enum: ['puppeteer', 'chrome-remote-interface'],
    example: 'puppeteer',
    type: String,
  })
  method: string;
}
