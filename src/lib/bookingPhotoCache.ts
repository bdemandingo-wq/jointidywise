export interface MediaGalleryPage<T> {
  rows: T[];
  source: string;
  page: number;
}

/** Shape of the booking-media infinite query. pageParams stay untouched. */
export interface MediaGalleryCache<T> {
  pages: MediaGalleryPage<T>[];
  pageParams: unknown[];
}

/** Drop one media row from every loaded page. Other pages and params stay. */
export function withoutMediaId<T extends { id: string }>(
  data: MediaGalleryCache<T> | undefined,
  id: string,
): MediaGalleryCache<T> | undefined {
  if (!data) return data;
  return {
    pageParams: data.pageParams,
    pages: data.pages.map((page) => ({
      ...page,
      rows: page.rows.filter((row) => row.id !== id),
    })),
  };
}
