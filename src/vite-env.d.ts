/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_APP_BUILD_ID?: string;
  /**
   * TidyWise-owned Meta Pixel, GA4, and Google Ads tags.
   * Leave them unset. The privacy policy names these products; that is not a
   * signal to fill in IDs. Blank or invalid values load nothing.
   * VITE_TIDYWISE_TAG_TEST_HOSTS is ignored in production builds.
   */
  readonly VITE_TIDYWISE_META_PIXEL_ID?: string;
  readonly VITE_TIDYWISE_GA4_ID?: string;
  readonly VITE_TIDYWISE_GOOGLE_ADS_ID?: string;
  readonly VITE_TIDYWISE_TAG_TEST_HOSTS?: string;
}
