import { Helmet } from "react-helmet-async";
import { breadcrumbSchema, type Crumb } from "@/lib/seo/schemas";
import { safeJsonLd } from "@/lib/safeJsonLd";

/**
 * Drop-in <BreadcrumbJsonLd /> for pages whose primary <SEOHead schemaJson>
 * slot is already occupied by Article/SoftwareApplication/etc. Emits a
 * separate JSON-LD <script> so multiple schemas can co-exist on one page.
 */
export function BreadcrumbJsonLd({ crumbs }: { crumbs: Crumb[] }) {
  const payload = safeJsonLd({
    "@context": "https://schema.org",
    ...breadcrumbSchema(crumbs),
  });
  return (
    <Helmet>
      <script type="application/ld+json">{payload}</script>
    </Helmet>
  );
}
