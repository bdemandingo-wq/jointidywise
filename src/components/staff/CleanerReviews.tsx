import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { withStaffCustomers, withStaffCustomer, fetchStaffCustomers } from '@/lib/staffCustomers';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Star, MessageSquare, Calendar, TrendingUp } from 'lucide-react';
import { format } from 'date-fns';
import { QueryError } from '@/components/QueryError';

interface Review {
  id: string;
  rating: number | null;
  review_text: string | null;
  responded_at: string | null;
  created_at: string;
  booking: {
    booking_number: number;
    scheduled_at: string;
    service: {
      name: string;
    } | null;
  } | null;
  customer: {
    first_name: string;
    last_name: string;
  } | null;
}

interface CleanerReviewsProps {
  staffId: string;
}

export function CleanerReviews({ staffId }: CleanerReviewsProps) {
  const { data: reviews = [], isLoading, error: reviewsError } = useQuery({
    queryKey: ['staff-reviews', staffId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('review_requests')
        .select(`
          id, rating, review_text, responded_at, created_at,
          booking:bookings(booking_number, scheduled_at, service:services(name)),
          customer_id
        `)
        .eq('staff_id', staffId)
        .gte('rating', 4)
        .not('rating', 'is', null)
        .order('responded_at', { ascending: false });

      if (error) throw error;
      return (await withStaffCustomers(data)) as unknown as Review[];
    },
    enabled: !!staffId,
  });

  const averageRating = reviews.length > 0
    ? reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / reviews.length
    : 0;

  const ratingCounts = reviews.reduce((acc, r) => {
    if (r.rating) {
      acc[r.rating] = (acc[r.rating] || 0) + 1;
    }
    return acc;
  }, {} as Record<number, number>);

  if (reviewsError) {
    return <QueryError subject="reviews" />;
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats Overview */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center">
                <Star className="w-6 h-6 text-amber-600 fill-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{averageRating.toFixed(1)}</p>
                <p className="text-sm text-muted-foreground">Average Rating</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center">
                <MessageSquare className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">{reviews.length}</p>
                <p className="text-sm text-muted-foreground">Total Reviews</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center">
                <TrendingUp className="w-6 h-6 text-emerald-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {reviews.filter(r => r.rating && r.rating >= 4).length}
                </p>
                <p className="text-sm text-muted-foreground">5-Star Reviews</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Rating Distribution */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rating Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[5, 4, 3, 2, 1].map((star) => {
              const count = ratingCounts[star] || 0;
              const percentage = reviews.length > 0 ? (count / reviews.length) * 100 : 0;
              return (
                <div key={star} className="flex items-center gap-3">
                  <span className="w-4 text-sm font-medium">{star}</span>
                  <Star className="w-4 h-4 text-amber-500 fill-amber-500" />
                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-amber-500 transition-all"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                  <span className="w-8 text-sm text-muted-foreground text-right">{count}</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Reviews List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Reviews</CardTitle>
        </CardHeader>
        <CardContent>
          {reviews.length === 0 ? (
            <div className="text-center py-8">
              <MessageSquare className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
              <p className="text-muted-foreground">No reviews yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Complete more jobs to start receiving customer feedback!
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {reviews.map((review) => (
                <div key={review.id} className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-1 mb-1">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <Star
                            key={star}
                            className={`w-4 h-4 ${
                              star <= (review.rating || 0)
                                ? 'text-amber-500 fill-amber-500'
                                : 'text-gray-300'
                            }`}
                          />
                        ))}
                      </div>
                      <p className="text-sm font-medium">
                        {review.customer
                          ? `${review.customer.first_name} ${review.customer.last_name}`
                          : 'Anonymous'}
                      </p>
                    </div>
                    <div className="text-right">
                      {review.booking && (
                        <Badge variant="secondary" className="text-xs mb-1">
                          #{review.booking.booking_number}
                        </Badge>
                      )}
                      {review.responded_at && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {format(new Date(review.responded_at), 'MMM d, yyyy')}
                        </p>
                      )}
                    </div>
                  </div>
                  {review.review_text && (
                    <p className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">
                      "{review.review_text}"
                    </p>
                  )}
                  {review.booking?.service && (
                    <p className="text-xs text-muted-foreground">
                      Service: {review.booking.service.name}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
