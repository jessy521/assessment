export interface Review {
  username: string;
  datetime: string;
  rating: number;
  body: string;
}

export interface ReviewData {
  averageRating: number;
  totalReviews: number;
  latestReviews: Review[];
  error?: string;
}
