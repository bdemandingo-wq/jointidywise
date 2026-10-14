/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_APP_BUILD_ID?: string;
  /**
   * TidyWise-owned Meta Pixel and Google tag (GA4 or Google Ads).
   * Leave both unset until the privacy policy names Google, Meta, and UTM storage.
   * Blank or invalid values load nothing.
   */
  readonly VITE_TIDYWISE_META_PIXEL_ID?: string;
  readonly VITE_TIDYWISE_GA_ID?: string;
}
