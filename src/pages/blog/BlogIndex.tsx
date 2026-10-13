import { Link } from "react-router-dom";
import { SEOHead } from '@/components/SEOHead';
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, BookOpen, Clock, Calendar, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { format } from "date-fns";
import { blogSortTime } from "@/lib/blogDates";
import { CopyrightYear } from '@/components/CopyrightYear';
import { QueryError } from '@/components/QueryError';

// Static cornerstone posts that have dedicated pages
const staticPosts = [
  {
    slug: "crm-for-cleaning-business",
    title: "Best CRM for Cleaning Business: Complete Guide to Maid Service Software",
    excerpt: "Find the best CRM for your cleaning business. Compare top cleaning business CRM software with scheduling, invoicing, GPS tracking & customer management.",
    category: "CRM Software",
    readTime: "12 min read",
    date: "February 2026",
    featured: true,
    isStatic: true
  },
  {
    slug: "how-to-start-a-cleaning-business",
    title: "The Ultimate Guide on How to Start a Cleaning Business in 2026",
    excerpt: "Learn everything from automated payroll software for maid services to cleaning business inventory management. Complete step-by-step guide for aspiring entrepreneurs.",
    category: "Business Guide",
    readTime: "15 min read",
    date: "January 2026",
    featured: false,
    isStatic: true
  },
  {
    slug: "booking-koala-vs-jobber-vs-tidywise",
    title: "Booking Koala vs Jobber vs TidyWise: Which Software Wins in 2026?",
    excerpt: "Complete side-by-side comparison of pricing, features, and customer support. Find out which cleaning business software is best for your company.",
    category: "Comparison",
    readTime: "10 min read",
    date: "January 2026",
    featured: false,
    isStatic: true
  },
  {
    slug: "how-to-grow-cleaning-business-2025",
    title: "How to Grow Your Cleaning Business in 2025",
    excerpt: "Proven strategies from online booking to referral programs. Learn how to scale your maid service profitably with smart technology and targeted marketing.",
    category: "Business Growth",
    readTime: "10 min read",
    date: "December 2025",
    featured: false,
    isStatic: true
  },
  {
    slug: "best-software-for-cleaning-business",
    title: "Best Software for Cleaning Business Owners",
    excerpt: "Compare the top cleaning business software in 2025. Scheduling, CRM, invoicing, and automation tools reviewed for maid services and janitorial companies.",
    category: "Software Reviews",
    readTime: "12 min read",
    date: "November 2025",
    featured: false,
    isStatic: true
  },
  {
    slug: "how-to-automate-cleaning-company",
    title: "How to Automate Your Cleaning Company",
    excerpt: "Save 15+ hours per week by automating booking, scheduling, invoicing, and client communication. A complete automation guide for cleaning business owners.",
    category: "Automation",
    readTime: "8 min read",
    date: "October 2025",
    featured: false,
    isStatic: true
  },
  {
    slug: "payroll-software-for-cleaning-businesses",
    title: "Best Payroll Software for Cleaning Businesses (2026 Guide)",
    excerpt: "Compare the best payroll software for cleaning businesses. Automate cleaner wages, tips, mileage, and tax filings. Save hours every pay period.",
    category: "Payroll",
    readTime: "9 min read",
    date: "April 2026",
    featured: false,
    isStatic: true
  },
  {
    slug: "gps-tracking-cleaning-business",
    title: "GPS Tracking for Cleaning Businesses — Do You Need It?",
    excerpt: "GPS tracking for cleaning teams: what it actually does, when it's worth it, and how to implement it without micromanaging your staff.",
    category: "Operations",
    readTime: "7 min read",
    date: "April 2026",
    featured: false,
    isStatic: true
  },
  {
    slug: "scheduling-software-for-cleaning-business",
    title: "Scheduling Software for Cleaning Businesses (2026 Guide)",
    excerpt: "What makes scheduling different for cleaning businesses, which features actually matter, and how to choose the right platform for your maid service.",
    category: "Software",
    readTime: "8 min read",
    date: "April 2026",
    featured: false,
    isStatic: true
  },
  {
    slug: "invoicing-software-for-cleaning-business",
    title: "Invoicing Software for Cleaning Businesses — Get Paid Faster",
    excerpt: "Automatic invoices, recurring billing, card-on-file charging, and deposit collection — how the right invoicing software eliminates payment chasing.",
    category: "Payments",
    readTime: "7 min read",
    date: "April 2026",
    featured: false,
    isStatic: true
  },
  {
    slug: "maid-service-software",
    title: "Best Maid Service Software in 2026 — Complete Buyer's Guide",
    excerpt: "Compare the best maid service software for scheduling, invoicing, payroll, and client management. What to look for and how the top options stack up.",
    category: "Software Reviews",
    readTime: "10 min read",
    date: "April 2026",
    featured: false,
    isStatic: true
  },
  {
    slug: "cleaning-business-management-software",
    title: "Cleaning Business Management Software — What You Actually Need",
    excerpt: "A practical guide to what cleaning business management software does, which modules matter most, and how to evaluate your options without getting lost in feature lists.",
    category: "Operations",
    readTime: "9 min read",
    date: "April 2026",
    featured: false,
    isStatic: true
  }
];

// Feature pages promoted as blog content for SEO
const featureArticles = [
  {
    slug: "/features/scheduling-software",
    title: "Cleaning Scheduling Software That Reduces No-Shows by 40%",
    excerpt: "Automated scheduling, smart reminders, and drag-and-drop calendars for cleaning businesses.",
    category: "Features",
    readTime: "5 min read",
    date: "January 2026",
    featured: false,
    isFeaturePage: true
  },
  {
    slug: "/features/route-optimization",
    title: "Route Optimization Software for Cleaning Businesses",
    excerpt: "Save 2+ hours daily with AI-powered route planning. Reduce fuel costs and maximize jobs per day.",
    category: "Features",
    readTime: "5 min read",
    date: "January 2026",
    featured: false,
    isFeaturePage: true
  },
  {
    slug: "/features/invoicing-software",
    title: "Cleaning Business Invoicing Software: Get Paid Faster",
    excerpt: "Professional invoices, automatic payment reminders, and seamless Stripe integration.",
    category: "Features",
    readTime: "5 min read",
    date: "January 2026",
    featured: false,
    isFeaturePage: true
  },
  {
    slug: "/compare/jobber",
    title: "TidyWise vs Jobber: Complete 2026 Comparison",
    excerpt: "See how TidyWise stacks up against Jobber on pricing, features, and ease of use.",
    category: "Comparison",
    readTime: "8 min read",
    date: "January 2026",
    featured: false,
    isFeaturePage: true
  },
  {
    slug: "/compare/booking-koala",
    title: "TidyWise vs Booking Koala: Feature-by-Feature Breakdown",
    excerpt: "Detailed comparison of two popular cleaning business software platforms.",
    category: "Comparison",
    readTime: "8 min read",
    date: "January 2026",
    featured: false,
    isFeaturePage: true
  },
  {
    slug: "/compare/housecall-pro",
    title: "Best Housecall Pro Alternative for Cleaning Businesses",
    excerpt: "Looking for a Housecall Pro alternative? See why cleaning companies are switching to TidyWise.",
    category: "Comparison",
    readTime: "6 min read",
    date: "January 2026",
    featured: false,
    isFeaturePage: true
  },
  {
    slug: "/features/payroll-software",
    title: "Payroll Software for Cleaning Businesses — Plans from $49/mo",
    excerpt: "Automate cleaner wages, tips, mileage reimbursements, and W-2/1099 docs. Built specifically for cleaning businesses.",
    category: "Features",
    readTime: "5 min read",
    date: "April 2026",
    featured: false,
    isFeaturePage: true
  }
];

export default function BlogIndex() {
  // Fetch dynamic blog posts from database
  const { data: dynamicPosts = [], isLoading, error: dynamicPostsError } = useQuery({
    queryKey: ["blog-posts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("blog_posts")
        .select("*")
        .eq("status", "published")
        .order("published_at", { ascending: false })
        .limit(50);
      
      if (error) throw error;
      return data || [];
    },
  });

  if (dynamicPostsError) return <QueryError subject="blog posts" />;

  // Newest first. Static cards used to be concatenated ahead of the
  // database, so the February 2026 cornerstone stayed on top of later posts.
  const allPosts = [
    ...staticPosts.map(post => ({ ...post, isFeaturePage: false as const, sortAt: blogSortTime({ dateLabel: post.date }) })),
    ...featureArticles.map(post => ({ ...post, isStatic: false as const, sortAt: blogSortTime({ dateLabel: post.date }) })),
    ...dynamicPosts.map(post => ({
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      category: post.category,
      readTime: post.read_time,
      // published_at is nullable. new Date(null) is Invalid Date and date-fns
      // format() THROWS on it — that took the whole index down rather than
      // hiding one post. An unpublished post simply shows no date.
      date: post.published_at ? format(new Date(post.published_at), "MMMM d, yyyy") : "",
      featured: post.is_featured,
      isStatic: false as const,
      isFeaturePage: false as const,
      sortAt: blogSortTime({ publishedAt: post.published_at, dateLabel: "" }),
    }))
  ].sort((a, b) => b.sortAt - a.sortAt || String(a.title).localeCompare(String(b.title)));

  return (
    <div className="min-h-screen bg-background">
      <SEOHead 
        title="Cleaning Business Resources & Guides | TIDYWISE Blog"
        description="Tips, guides, and insights for cleaning business owners. Learn how to grow your company, manage your team, and run smarter operations with TidyWise."
        canonical="/blog"
        ogImage="/images/og/og-blog.png"
        schemaJson={{
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: "https://www.jointidywise.com/" },
            { "@type": "ListItem", position: 2, name: "Blog", item: "https://www.jointidywise.com/blog" },
          ],
        }}
      />

      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link to="/" className="flex items-center gap-2">
              <span className="font-bold text-xl text-foreground">TIDYWISE</span>
            </Link>
            <Button asChild>
              <Link to="/auth">Get started</Link>
            </Button>
          </div>
        </div>
      </nav>

      <main className="pt-24 pb-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="mb-12">
            <Link 
              to="/" 
              className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-6 transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Home
            </Link>
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 rounded-full text-primary text-sm font-medium mb-4 ml-4">
              <BookOpen className="h-4 w-4" />
              Resources & Guides
            </div>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground mb-4">
              Cleaning Business Resources
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl">
              Expert insights on growing your cleaning business. From automated payroll to inventory management, we&apos;ve got you covered.
            </p>
          </div>

          {/* Loading State */}
          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          )}

          {/* Articles Grid */}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {allPosts.map((post) => (
              <Link 
                key={post.slug}
                to={post.isFeaturePage ? post.slug : (post.isStatic ? `/blog/${post.slug}` : `/blog/post/${post.slug}`)}
                className="group"
              >
                <article className="bg-card rounded-xl border border-border p-6 h-full hover:shadow-lg hover:border-primary/50 transition-all duration-300 flex flex-col">
                  {post.featured && (
                    <span className="self-start px-2 py-1 bg-primary text-primary-foreground text-xs rounded mb-4">
                      Featured
                    </span>
                  )}
                  <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4 flex-wrap">
                    <span className="px-3 py-1 bg-secondary text-foreground rounded-full font-medium">
                      {post.category}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-4 w-4" />
                      {post.readTime}
                    </span>
                  </div>
                  <h2 className="text-xl font-semibold text-foreground mb-3 group-hover:text-primary transition-colors line-clamp-2">
                    {post.title}
                  </h2>
                  <p className="text-muted-foreground mb-4 flex-1 line-clamp-3">
                    {post.excerpt}
                  </p>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {post.date}
                    </span>
                    <span className="flex items-center gap-2 text-primary text-sm font-medium group-hover:gap-3 transition-all">
                      Read <ArrowRight className="h-4 w-4" />
                    </span>
                  </div>
                </article>
              </Link>
            ))}
          </div>

          {/* Newsletter CTA */}
          <div className="mt-16 bg-secondary/50 rounded-2xl p-8 sm:p-12 text-center border border-border">
            <h2 className="text-2xl font-bold text-foreground mb-4">
              Get cleaning business tips in your inbox
            </h2>
            <p className="text-muted-foreground mb-6 max-w-xl mx-auto">
              Join 5,000+ cleaning business owners who receive weekly insights on growing their business.
            </p>
            <Button size="lg" asChild>
              <Link to="/auth">
                Subscribe for Free <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-8 px-4 border-t border-border">
        <div className="max-w-7xl mx-auto text-center text-sm text-muted-foreground">
          © <CopyrightYear /> TIDYWISE. All rights reserved.
        </div>
      </footer>
    </div>
  );
}