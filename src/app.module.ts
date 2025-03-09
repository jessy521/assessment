import { Module } from '@nestjs/common';
import { ReviewsModule } from './review/reviews.module';

@Module({
  imports: [ReviewsModule],
})
export class AppModule {}
