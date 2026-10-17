import { Link, useParams } from "react-router-dom";
import { ArticleBody, READING_COLUMN } from "@/components/ArticleBody";
import { SEOHead } from '@/components/SEOHead';
import { Button } from "@/components/ui/button";
import { ArrowLeft, Clock, Calendar, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { format } from "date-fns";
import { safeJsonLd } from "@/lib/safeJsonLd";
import { CopyrightYear } from '@/components/CopyrightYear';
import { DoNotSellShareLink } from '@/components/DoNotSellShareLink';
import { keywordCanonical } from '@/lib/keywordCanonicals';

export default function DynamicBlogPost() {
  const { slug } = useParams<{ slug: string }>();

  const { data: post, isLoading, error } = useQuery({
    queryKey: ["blog-post", slug],
    queryFn: async () => {
      if (!slug) throw new Error("No slug provided");
      
      const { data, error } = await supabase
        .from("blog_posts")
        .select("*")
        .eq("slug", slug)
        .eq("status", "published")
        .single();
      
      if (error) throw error;
      return data;
    },
    enabled: !!slug,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !post) {
    return (
      <div className="min-h-screen bg-background">
        <SEOHead ogType="article"
          title="Article not found | TidyWise Blog"
          description="The article you're looking for doesn't exist or has been removed."
          canonical={`/blog/post/${slug ?? ''}`}
          noIndex
        />
        <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md border-b border-border">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <Link to="/" className="flex items-center gap-2">
                <span className="font-bold text-xl text-foreground">TIDYWISE</span>
              </Link>
              <Button asChild>
                <Link to="/signup">Get started</Link>
              </Button>
            </div>
          </div>
        </nav>
        <div className="pt-24 pb-20 px-4 text-center">
          <h1 className="text-2xl font-bold mb-4">Article Not Found</h1>
          <p className="text-muted-foreground mb-6">This article may have been removed or doesn&apos;t exist.</p>
          <Button asChild>
            <Link to="/blog">Back to Blog</Link>
          </Button>
        </div>
      </div>
    );
  }

  const selfPath = `/blog/post/${post.slug}`;
  const canonicalPath = keywordCanonical(selfPath) ?? selfPath;
  const canonicalUrl = `https://www.jointidywise.com${canonicalPath}`;
  const publisher = {
    "@type": "Organization",
    name: "TIDYWISE",
    logo: {
      "@type": "ImageObject",
      url: "https://www.jointidywise.com/images/tidywise-logo.png",
    },
  };

  // Article schema
  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.meta_description || post.excerpt,
    image: post.featured_image_url || "https://www.jointidywise.com/images/tidywise-og.png",
    author: {
      "@type": "Organization",
      name: post.author || "TIDYWISE Team",
    },
    publisher,
    datePublished: post.published_at,
    dateModified: post.updated_at || post.published_at,
    mainEntityOfPage: { "@type": "WebPage", "@id": canonicalUrl },
  };

  // Breadcrumb schema: Home > Blog > Post Title
  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://www.jointidywise.com/" },
      { "@type": "ListItem", position: 2, name: "Blog", item: "https://www.jointidywise.com/blog" },
      { "@type": "ListItem", position: 3, name: post.title, item: canonicalUrl },
    ],
  };

  // FAQ schema — extract Q/A pairs from post content if present
  const extractFaqs = (html: string): Array<{ question: string; answer: string }> => {
    if (!html) return [];
    const faqs: Array<{ question: string; answer: string }> = [];
    // Find FAQ section: H2 containing "FAQ" or "Frequently Asked"
    const faqSectionMatch = html.match(
      /<h2[^>]*>[^<]*(?:faq|frequently asked)[^<]*<\/h2>([\s\S]*?)(?=<h2|$)/i
    );
    const scope = faqSectionMatch ? faqSectionMatch[1] : html;
    // Pair each H3 (question) with following text up to next H3/H2
    const qaRegex = /<h3[^>]*>([\s\S]*?)<\/h3>([\s\S]*?)(?=<h[23]|$)/gi;
    let m: RegExpExecArray | null;
    while ((m = qaRegex.exec(scope)) !== null) {
      const question = m[1].replace(/<[^>]+>/g, "").trim();
      const answer = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (question && answer && question.length < 300 && answer.length > 10) {
        faqs.push({ question, answer });
      }
    }
    return faqs.slice(0, 10);
  };
  const faqs = extractFaqs(post.content || "");
  const faqSchema = faqs.length
    ? {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faqs.map((f) => ({
          "@type": "Question",
          name: f.question,
          acceptedAnswer: { "@type": "Answer", text: f.answer },
        })),
      }
    : null;

  return (
    <div className="min-h-screen bg-background">
      <SEOHead 
        ogType="article"
        title={post.meta_title || `${post.title} | TIDYWISE Blog`}
        description={post.meta_description || post.excerpt}
        canonical={canonicalPath}
        noIndex={canonicalPath !== selfPath}
        ogImage={post.featured_image_url || undefined}
      />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(articleSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbSchema) }} />
      {faqSchema && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(faqSchema) }} />
      )}

      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
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

      {/* Article */}
      <article className="pt-24 pb-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          {/* Breadcrumb */}
          <Link 
            to="/blog" 
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-8 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Resources
          </Link>

          {/* Header */}
          <div className={READING_COLUMN}>
          <header className="mb-12">
            <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4 flex-wrap">
              <span className="px-3 py-1 bg-primary/10 text-primary rounded-full font-medium">
                {post.category}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-4 w-4" />
                {post.read_time}
              </span>
              <span className="flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                {post.published_at ? format(new Date(post.published_at), "MMMM d, yyyy") : null}
              </span>
            </div>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-foreground leading-tight mb-6">
              {post.title}
            </h1>
            <p className="text-xl text-muted-foreground leading-relaxed">
              {post.excerpt}
            </p>
          </header>

          {/* Body. ArticleBody sanitises the HTML itself — see its header. */}
          <ArticleBody html={post.content} />
          </div>

          {/* CTA */}
          <div className="mt-16 bg-primary/5 rounded-2xl p-8 sm:p-12 text-center border border-primary/20">
            <h2 className="text-2xl font-bold text-foreground mb-4">
              Ready to streamline your cleaning business?
            </h2>
            <p className="text-muted-foreground mb-6 max-w-xl mx-auto">
              Try TIDYWISE to manage bookings, staff, and payments for your cleaning business.
            </p>
            <Button size="lg" asChild>
              <Link to="/auth">See Pricing</Link>
            </Button>
          </div>
        </div>
      </article>

      {/* Footer */}
      <footer className="py-8 px-4 border-t border-border">
        <div className="max-w-7xl mx-auto text-center text-sm text-muted-foreground">
          © <CopyrightYear /> TIDYWISE. All rights reserved.
        </div>
              <DoNotSellShareLink />
      </footer>
    </div>
  );
}