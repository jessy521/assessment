import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { ReviewData } from './reviews.interface';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ReviewQueryDto } from './review.dto';

@ApiTags('reviews')
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get()
  @ApiOperation({ summary: 'Scrape Google reviews for a business' })
  @ApiResponse({ status: 200, description: 'Data fetched successfully' })
  @ApiResponse({ status: 400, description: 'Bad-Request Exception' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async getReviews(@Query() query: ReviewQueryDto): Promise<ReviewData> {
    return this.reviewsService.getReviews(query);
  }
}
