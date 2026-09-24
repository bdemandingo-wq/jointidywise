import { lazy, Suspense, useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider, MutationCache } from "@tanstack/react-query";
import { refreshBadges } from "@/lib/badgeRefresh";

import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { BrowserRouter, HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { AuthProvider } from "@/hooks/useAuth";
import { AuthProviderNoSession } from "@/hooks/useAuthNoSession";
import { OrganizationProvider } from "@/contexts/OrganizationContext";
import { AiCreditLimitModal } from "@/components/ai-credits/AiCreditLimitModal";
import { CurrencySync } from "@/components/CurrencySync";
import { TestModeProvider } from "@/contexts/TestModeContext";
import { ClientPortalProvider } from "@/contexts/ClientPortalContext";
import { AdminRoute } from "@/components/AdminRoute";
import { FinancialRoute } from "@/components/FinancialRoute";
import { StaffRoute } from "@/components/StaffRoute";
import { ProtectedPortalRoute } from "@/components/ProtectedPortalRoute";
import { PlatformAdminRoute } from "@/components/PlatformAdminRoute";
import { PlatformOwnerRoute } from "@/components/PlatformOwnerRoute";
import { SessionTrackerProvider } from "@/components/SessionTrackerProvider";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { CopilotProvider } from "@/components/copilot/CopilotProvider";
import { CopilotMount } from "@/components/copilot/CopilotMount";
import { ProductTour } from "@/components/copilot/ProductTour";
import { Capacitor } from "@capacitor/core";
import { useAppStateHandler } from '@/hooks/useAppStateHandler';
import { captureReferralFromUrl } from '@/lib/referralAttribution';
import { requestTrackingPermission } from '@/lib/metaEvents';

// Critical path: keep the shell light; lazy-load even the public entry pages
const LandingPage = lazy(() => import("./pages/LandingPage"));
const ScoreSearchPage = lazy(() => import("./pages/score/ScoreSearchPage"));
const ScoreCityPage = lazy(() => import("./pages/score/ScoreCityPage"));
const ScoreCompanyPage = lazy(() => import("./pages/score/ScoreCompanyPage"));
const ScoreGeneratePage = lazy(() => import("./pages/score/ScoreGeneratePage"));

// New auth pages with no session persistence
const LoginPage = lazy(() => import("./pages/LoginPage"));
const AcceptInvitePage = lazy(() => import("./pages/AcceptInvitePage"));
const SignupPage = lazy(() => import("./pages/SignupPage"));
// Native signup page (email/password + stubbed Apple/Google OAuth)
const NativeSignupPage = lazy(() => import("./pages/NativeSignupRedirect"));
const LogoutPage = lazy(() => import("./pages/LogoutPage"));

// Legacy auth page (kept for backwards compatibility)
const ForgotPasswordPage = lazy(() => import("./pages/ForgotPasswordPage"));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage"));
const AuthCallbackPage = lazy(() => import("./pages/AuthCallbackPage"));
const SetPasswordPage = lazy(() => import("./pages/SetPasswordPage"));
const ContactPage = lazy(() => import("./pages/ContactPage"));
const OAuthConsentPage = lazy(() => import("./pages/OAuthConsentPage"));

// Lazy-loaded page skeleton for loading states
const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
  </div>
);

// Lazy load all routes for code splitting
const PublicBookingPage = lazy(() => import("./pages/PublicBookingPage"));
const OnboardingPage = lazy(() => import("./pages/OnboardingPage"));
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard"));
const SchedulerPage = lazy(() => import("./pages/admin/SchedulerPage"));
const BookingsPage = lazy(() => import("./pages/admin/BookingsPage"));
const CustomersPage = lazy(() => import("./pages/admin/CustomersPage"));
const CustomersDuplicatesPage = lazy(() => import("./pages/admin/CustomersDuplicatesPage"));
const ServicesPage = lazy(() => import("./pages/admin/ServicesPage"));
const StaffPage = lazy(() => import("./pages/admin/StaffPage"));
const PayrollPage = lazy(() => import("./pages/admin/PayrollPage"));
const FinancePage = lazy(() => import("./pages/admin/FinancePage"));
const ExpensesPage = lazy(() => import("./pages/admin/ExpensesPage"));
const ReportsPage = lazy(() => import("./pages/admin/ReportsPage"));
const SettingsPage = lazy(() => import("./pages/admin/SettingsPage"));
const NotificationsPage = lazy(() => import("./pages/admin/NotificationsPage"));
const RecurringBookingsPage = lazy(() => import("./pages/admin/RecurringBookingsPage"));
const LeadsPage = lazy(() => import("./pages/admin/LeadsPage"));
const InventoryPage = lazy(() => import("./pages/admin/InventoryPage"));
const InvoicesPage = lazy(() => import("./pages/admin/InvoicesPage"));
const OperationsTrackerPage = lazy(() => import("./pages/admin/OperationsTrackerPage"));
const BenchmarksPage = lazy(() => import("./pages/admin/BenchmarksPage"));
const ClientFeedbackPage = lazy(() => import("./pages/admin/ClientFeedbackPage"));
const CampaignsPage = lazy(() => import("./pages/admin/CampaignsPage"));
const ChecklistsPage = lazy(() => import("./pages/admin/ChecklistsPage"));
const PaymentIntegrationPage = lazy(() => import("./pages/admin/PaymentIntegrationPage"));
// Platform-aware subscription page: native apps show compliant version (no prices/payments)
const SubscriptionPage = lazy(() => 
  Capacitor.isNativePlatform() 
    ? import("./pages/admin/SubscriptionPageNative")
    : import("./pages/admin/SubscriptionPage")
);
const HelpPage = lazy(() => import("./pages/admin/HelpPage"));

const DiscountsPage = lazy(() => import("./pages/admin/DiscountsPage"));
const PlatformAnalyticsPage = lazy(() => import("./pages/admin/PlatformAnalyticsPage"));
const MessagesPage = lazy(() => import("./pages/admin/MessagesPage"));
const TasksPage = lazy(() => import("./pages/admin/TasksPage"));
const AIIntelligencePage = lazy(() => import("./pages/admin/AIIntelligencePage"));
const ClientPortalAdminPage = lazy(() => import("./pages/admin/ClientPortalPage"));
const AutomationCenterPage = lazy(() => import("./pages/admin/AutomationCenterPage"));
const CustomWorkRequestPage = lazy(() => import("./pages/admin/CustomWorkRequestPage"));
const AdminCustomWorkRequestsPage = lazy(() => import("./pages/admin/AdminCustomWorkRequestsPage"));
const DataImportPage = lazy(() => import("./pages/admin/DataImportPage"));
const BookingPhotosPage = lazy(() => import("./pages/admin/BookingPhotosPage"));
const StaffPortal = lazy(() => import("./pages/staff/StaffPortal"));
const StaffLoginPage = lazy(() => import("./pages/staff/StaffLoginPage"));
const StaffResetPasswordPage = lazy(() => import("./pages/staff/StaffResetPasswordPage"));

// Client Portal Pages
const PortalLoginPage = lazy(() => import("./pages/portal/PortalLoginPage"));
const PortalDashboardPage = lazy(() => import("./pages/portal/PortalDashboardPage"));
const PortalRequestPage = lazy(() => import("./pages/portal/PortalRequestPage"));

const ReviewPage = lazy(() => import("./pages/ReviewPage"));
const BlogIndex = lazy(() => import("./pages/blog/BlogIndex"));
const HowToStartCleaningBusiness = lazy(() => import("./pages/blog/HowToStartCleaningBusiness"));
const BookingKoalaVsJobberVsTidywise = lazy(() => import("./pages/blog/BookingKoalaVsJobberVsTidywise"));
const CleaningBusinessCRM = lazy(() => import("./pages/blog/CleaningBusinessCRM"));
const DynamicBlogPost = lazy(() => import("./pages/blog/DynamicBlogPost"));
const GrowCleaningBusiness2025 = lazy(() => import("./pages/blog/GrowCleaningBusiness2025"));
const BestSoftwareForCleaners = lazy(() => import("./pages/blog/BestSoftwareForCleaners"));
const AutomateCleaningCompany = lazy(() => import("./pages/blog/AutomateCleaningCompany"));
const PayrollSoftwareForCleaners = lazy(() => import("./pages/blog/PayrollSoftwareForCleaners"));
const GPSTrackingForCleaners = lazy(() => import("./pages/blog/GPSTrackingForCleaners"));
const SchedulingSoftwareForCleaners = lazy(() => import("./pages/blog/SchedulingSoftwareForCleaners"));
const InvoicingSoftwareForCleaners = lazy(() => import("./pages/blog/InvoicingSoftwareForCleaners"));
const MaidServiceSoftware = lazy(() => import("./pages/blog/MaidServiceSoftware"));
const CleaningBusinessManagementSoftware = lazy(() => import("./pages/blog/CleaningBusinessManagementSoftware"));
const NotFound = lazy(() => import("./pages/NotFound"));
const CompareJobber = lazy(() => import("./pages/compare/CompareJobber"));
const CompareBookingKoala = lazy(() => import("./pages/compare/CompareBookingKoala"));
const CompareZenMaid = lazy(() => import("./pages/compare/CompareZenMaid"));
const CompareServiceTitan = lazy(() => import("./pages/compare/CompareServiceTitan"));
const CompareLaunch27 = lazy(() => import("./pages/compare/CompareLaunch27"));
const AutomatedDispatching = lazy(() => import("./pages/features/AutomatedDispatching"));
const QuoteSoftware = lazy(() => import("./pages/features/QuoteSoftware"));
const SMSNotifications = lazy(() => import("./pages/features/SMSNotifications"));
const PaymentProcessing = lazy(() => import("./pages/features/PaymentProcessing"));
const RouteOptimization = lazy(() => import("./pages/features/RouteOptimization"));
const InvoicingSoftware = lazy(() => import("./pages/features/InvoicingSoftware"));
const SchedulingSoftware = lazy(() => import("./pages/features/SchedulingSoftware"));
const BookingSoftware = lazy(() => import("./pages/features/BookingSoftware"));
const CRMSoftware = lazy(() => import("./pages/features/CRMSoftware"));
const PayrollSoftware = lazy(() => import("./pages/features/PayrollSoftware"));
const CompareHousecallPro = lazy(() => import("./pages/compare/CompareHousecallPro"));
const CompareNichePage = lazy(() => import("./pages/compare/CompareNichePage"));
const PricingPage = lazy(() => import("./pages/PricingPage"));
const GetTheAppPage = lazy(() => import("./pages/GetTheAppPage"));
const ChoosePlanPage = lazy(() => import("./pages/ChoosePlanPage"));
const CheckoutSuccessPage = lazy(() => import("./pages/CheckoutSuccessPage"));
const CleaningBusinessSoftware = lazy(() => import("./pages/CleaningBusinessSoftware"));
const LocationSoftwarePage = lazy(() => import("./pages/locations/LocationSoftwarePage"));
const DemoPage = lazy(() => import("./pages/DemoPage"));
const PrivacyPolicyPage = lazy(() => import("./pages/PrivacyPolicyPage"));
const TermsPage = lazy(() => import("./pages/TermsPage"));
const DeleteAccountPage = lazy(() => import("./pages/DeleteAccountPage"));
const RedirectPage = lazy(() => import("./pages/RedirectPage"));
const CardSavedPage = lazy(() => import("./pages/CardSavedPage"));
const TipPage = lazy(() => import("./pages/TipPage"));
const DepositPage = lazy(() => import("./pages/DepositPage"));
const TrackCleanerPage = lazy(() => import("./pages/TrackCleanerPage"));
const TrackingPage = lazy(() => import("./pages/admin/TrackingPage"));

// Blog admin (platform-admin only)
const PlatformRevenuePage = lazy(() => import("./pages/admin/PlatformRevenuePage"));
const BroadcastDetailPage = lazy(() => import("./pages/admin/BroadcastDetailPage"));
const PlatformFeedbackPage = lazy(() => import("./pages/admin/PlatformFeedbackPage"));

const BlogAdminListPage = lazy(() => import("./pages/admin/blog/BlogAdminListPage"));
const AccessCodesAdminPage = lazy(() => import("./pages/admin/AccessCodesAdminPage"));
const BlogAdminEditPage = lazy(() => import("./pages/admin/blog/BlogAdminEditPage"));
const BlogAdminGeneratePage = lazy(() => import("./pages/admin/blog/BlogAdminGeneratePage"));
const BlogAdminPreviewPage = lazy(() => import("./pages/admin/blog/BlogAdminPreviewPage"));
const BlogKeywordsPage = lazy(() => import("./pages/admin/blog/BlogKeywordsPage"));

// Optimized QueryClient with stale time and caching
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 60 * 24, // 24h — must cover offline persistence window
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
  // Every badge count lives in its own query, separate from the list a user
  // just acted on — so approving a document emptied the review list while the
  // tab badge kept showing the stale number. Refreshing badge counts after ANY
  // successful write means no action screen has to remember to do it.
  mutationCache: new MutationCache({
    onSuccess: () => {
      refreshBadges(queryClient);
    },
  }),
});


// Offline mode: persist the query cache to device storage so the app opens
// with yesterday's calendar, bookings, and customers even with no signal.
// Reads work offline; writes (confirmations, emails) still need a connection
// and the GlobalOfflineBanner explains that. Cache restores instantly on
// launch, then refetches silently once online.
// Map/Set instances don't survive the persister's JSON round-trip — they come
// back as {} and throw on the next .get()/.has(). Reject query data that is a
// Map/Set, or that holds one in a top-level property (the shape that broke the
// Staff Portal). Deliberately shallow: this runs over the whole cache on every
// throttled write, and one level covers the "batched lookups" object pattern
// these queries actually use.
const containsMapOrSet = (data: unknown): boolean => {
  if (data instanceof Map || data instanceof Set) return true;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  return Object.values(data as Record<string, unknown>).some(
    (v) => v instanceof Map || v instanceof Set,
  );
};

const offlinePersister = createSyncStoragePersister({
  storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  key: 'tw-offline-cache',
  throttleTime: 2000,
});

const AppStateHandler = (): null => {
  useAppStateHandler();
  // Capture ?ref= on first load so referral signups are credited later in
  // onboarding (readCapturedReferral -> claim-referral).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    captureReferralFromUrl(window.location.search);
  }, []);
  // Request ATT after the app is fully mounted and stable — never during
  // startup. The 3s delay lets the webview finish loading, session restore
  // complete, and the user see the UI before the system dialog appears.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const timer = setTimeout(() => { requestTrackingPermission(); }, 3000);
    return () => clearTimeout(timer);
  }, []);
  return null;
};

const App = () => (
  <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} storageKey="tidywise-theme">
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: offlinePersister,
        maxAge: 1000 * 60 * 60 * 24,
        // Bump to discard previously-persisted caches (2026-07-20: old
        // caches contain Map data serialized to plain objects).
        buster: 'v2-no-maps',
        dehydrateOptions: {
          // Persist only successful reads; never persist mutations or
          // huge/ephemeral queries. Also exclude 'service-pricing': its
          // query data is a Map (see useServicePricing.ts), and Map
          // instances don't survive a JSON.stringify/parse round-trip —
          // they rehydrate as plain objects, so a later .get() call
          // throws "TypeError: [x].get is not a function" wherever
          // pricing is looked up (New/Edit Booking's Service step,
          // ServicePricingEditor, ExtrasPricingManager). Confirmed live
          // 2026-07-14. Excluding it also means pricing is never served
          // stale from an offline cache, which matters more here than
          // for bookings/customers since a stale price could mis-charge
          // a customer.
          shouldDehydrateQuery: (q) =>
            q.state.status === 'success' &&
            // Never persist Map/Set data — it rehydrates as a plain object
            // and crashes on the next .get()/.has() (same class of bug as
            // service-pricing above; also hit customer-stats-for-dedupe,
            // teamPaysByBooking, enrollmentsByCustomer on 2026-07-20).
            // The check is one level deep: staff-myjob-carddata returned an
            // *object containing* a Set (onTheWaySent), which passed the
            // top-level check and took down the Staff Portal on 2026-07-28.
            !containsMapOrSet(q.state.data) &&
            !JSON.stringify(q.queryKey).includes('signed') &&
            !JSON.stringify(q.queryKey).includes('service-pricing') &&
            // Campaign run progress is a live figure, not a cached fact.
            // Restoring yesterday's "Sending 12 of 300" would show a stalled
            // number that reads as current — worse than showing nothing,
            // because the operator has no way to tell it is stale and may
            // re-send thinking the run died. Always refetch this.
            !JSON.stringify(q.queryKey).includes('campaign-runs') &&
            // Loyalty tier thresholds are per-org and owner-editable. A stale
            // cached threshold would tell a customer they hold a tier they no
            // longer qualify for, or hide one they've earned — same reasoning
            // as service-pricing above: never serve tier status from an
            // offline cache.
            !JSON.stringify(q.queryKey).includes('org-tiers') &&
            // Membership lists change when a user is added/removed from an
            // org. A stale cached list can show the user in an org they've
            // been removed from, rendering data they can no longer write to.
            !JSON.stringify(q.queryKey).includes('org-memberships') &&
            !JSON.stringify(q.queryKey).includes('my-staff-orgs'),
        },
      }}
    >
      {/* AuthProviderNoSession MUST wrap AuthProvider since AuthProvider uses useAuthNoSession */}
      <AuthProviderNoSession>
        <AuthProvider>
          <SessionTrackerProvider>
            <OrganizationProvider>
              <CurrencySync />
              <TestModeProvider>
                <ClientPortalProvider>
                <TooltipProvider>
                <Toaster />
                <Sonner />
                <AppStateHandler />
                <AiCreditLimitModal />
                {/*
                  Native (Capacitor) builds should use HashRouter to avoid blank screens on launch
                  due to history-based routing not being handled by the embedded webview.
                */}
                {Capacitor.isNativePlatform() ? (
                  <HashRouter>
                    <CopilotProvider>
                     <ErrorBoundary featureName="App">
                       <Suspense fallback={<PageLoader />}>
                          <Routes>
                    {/* Auth Routes - No Session Persistence */}
                         <Route path="/login" element={<LoginPage />} />
                         <Route path="/signup" element={<NativeSignupPage />} />
                          {/* /auth renders LoginPage directly (not a redirect) so its
                              unique title/description from LoginPage's isAuthPath logic
                              can actually take effect. Canonical still points to /login. */}
                          <Route path="/auth" element={<LoginPage />} />
                         <Route path="/forgot-password" element={<Navigate to="/login" replace />} />
                         <Route path="/reset-password" element={<Navigate to="/login" replace />} />
                         {/* Supabase auth redirect target for invite / recovery / magiclink */}
                         <Route path="/auth/callback" element={<AuthCallbackPage />} />
                         <Route path="/auth/confirm" element={<AuthCallbackPage />} />
                         <Route path="/set-password" element={<SetPasswordPage />} />
                         <Route path="/accept-invite" element={<AcceptInvitePage />} />
                         <Route path="/contact" element={<ContactPage />} />
                    <Route path="/.lovable/oauth/consent" element={<OAuthConsentPage />} />
                         <Route path="/logout" element={<LogoutPage />} />
                        
                      {/* Public Routes - Critical Path */}
                        <Route path="/" element={<LoginPage />} />

                      {/* Public Routes - Lazy Loaded */}
                      <Route path="/book/:orgSlug" element={<PublicBookingPage />} />
                      <Route path="/c/:code" element={<RedirectPage />} />
                      <Route path="/card-saved" element={<CardSavedPage />} />
                      <Route path="/tip/:token" element={<TipPage />} />
                      <Route path="/deposit/:token" element={<DepositPage />} />
                      <Route path="/track/:token" element={<TrackCleanerPage />} />
                      <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
                      <Route path="/terms" element={<TermsPage />} />
                      <Route path="/delete-account" element={<DeleteAccountPage />} />
                      {/* App Store 3.1.1: No pricing/marketing on native */}
                      <Route path="/pricing" element={<Navigate to="/login" replace />} />
                      {/* Native already IS the app — pointing someone at the
                          App Store from inside it makes no sense, and marketing
                          routes are redirected here anyway (App Store 3.1.1). */}
                      <Route path="/get-the-app" element={<Navigate to="/login" replace />} />
                      <Route path="/choose-plan" element={<Navigate to="/login" replace />} />
                      {/* Onboarding is OUTSIDE AdminRoute. Moving it inside would
                          create an infinite redirect — AdminRoute's needs_onboarding
                          gate sends users here, so it must not be behind it. */}
                      <Route path="/onboarding" element={<OnboardingPage />} />
                      <Route path="/demo" element={<Navigate to="/login" replace />} />
                      <Route path="/review/:token" element={<ReviewPage />} />
                      {/* Redirect all marketing pages to login on native */}
                      <Route path="/blog/*" element={<Navigate to="/login" replace />} />
                      <Route path="/compare/*" element={<Navigate to="/login" replace />} />
                      <Route path="/features/*" element={<Navigate to="/login" replace />} />
                      <Route path="/cleaning-business-software/*" element={<Navigate to="/login" replace />} />

                      {/* Staff Portal */}
                      <Route path="/staff/login" element={<StaffLoginPage />} />
                      <Route path="/staff/reset-password" element={<StaffResetPasswordPage />} />
                      <Route path="/staff" element={<StaffRoute><ErrorBoundary featureName="Staff Portal"><StaffPortal /></ErrorBoundary></StaffRoute>} />

                      {/* Client Portal */}
                      <Route path="/portal" element={<PortalLoginPage />} />
                      <Route path="/portal/login" element={<PortalLoginPage />} />
                      <Route path="/portal/dashboard" element={<ProtectedPortalRoute><PortalDashboardPage /></ProtectedPortalRoute>} />
                      <Route path="/portal/request" element={<ProtectedPortalRoute><PortalRequestPage /></ProtectedPortalRoute>} />

                      {/* Dashboard Routes - All Lazy Loaded (AdminRoute enforces owner/manager role) */}
                      <Route path="/dashboard" element={<AdminRoute><FinancialRoute><ErrorBoundary featureName="Dashboard"><AdminDashboard /></ErrorBoundary></FinancialRoute></AdminRoute>} />

                      <Route path="/dashboard/scheduler" element={<AdminRoute><ErrorBoundary featureName="Scheduler"><SchedulerPage /></ErrorBoundary></AdminRoute>} />
                      <Route path="/dashboard/bookings" element={<AdminRoute><ErrorBoundary featureName="Bookings"><BookingsPage /></ErrorBoundary></AdminRoute>} />
                      <Route path="/dashboard/tracking" element={<AdminRoute><ErrorBoundary featureName="Tracking"><TrackingPage /></ErrorBoundary></AdminRoute>} />
                      <Route path="/dashboard/customers" element={<AdminRoute><ErrorBoundary featureName="Customers"><CustomersPage /></ErrorBoundary></AdminRoute>} />
                      <Route path="/dashboard/customers/duplicates" element={<AdminRoute><ErrorBoundary featureName="Duplicates"><CustomersDuplicatesPage /></ErrorBoundary></AdminRoute>} />
                      <Route path="/dashboard/services" element={<AdminRoute><ErrorBoundary featureName="Services"><ServicesPage /></ErrorBoundary></AdminRoute>} />
                      <Route path="/dashboard/staff" element={<AdminRoute><ErrorBoundary featureName="Staff Management"><StaffPage /></ErrorBoundary></AdminRoute>} />
                      <Route path="/dashboard/payroll" element={<AdminRoute><FinancialRoute><ErrorBoundary featureName="Payroll"><PayrollPage /></ErrorBoundary></FinancialRoute></AdminRoute>} />
                      <Route path="/dashboard/finance" element={<AdminRoute><FinancialRoute><ErrorBoundary featureName="Finance"><FinancePage /></ErrorBoundary></FinancialRoute></AdminRoute>} />
                      <Route path="/dashboard/expenses" element={<AdminRoute><FinancialRoute><ErrorBoundary featureName="Expenses"><ExpensesPage /></ErrorBoundary></FinancialRoute></AdminRoute>} />
                      <Route path="/dashboard/reports" element={<AdminRoute><FinancialRoute><ErrorBoundary featureName="Reports"><ReportsPage /></ErrorBoundary></FinancialRoute></AdminRoute>} />

                      <Route path="/dashboard/settings" element={<AdminRoute><ErrorBoundary featureName="Settings"><SettingsPage /></ErrorBoundary></AdminRoute>} />
                      <Route path="/dashboard/notifications" element={<AdminRoute><ErrorBoundary featureName="Notifications"><NotificationsPage /></ErrorBoundary></AdminRoute>} />
                      <Route path="/dashboard/recurring" element={<AdminRoute><ErrorBoundary featureName="Recurring Bookings"><RecurringBookingsPage /></ErrorBoundary></AdminRoute>} />
                      <Route path="/dashboard/leads" element={<AdminRoute><ErrorBoundary featureName="Leads"><LeadsPage /></ErrorBoundary></AdminRoute>} />
                      <Route path="/dashboard/inventory" element={<AdminRoute><ErrorBoundary featureName="Inventory"><InventoryPage /></ErrorBoundary></AdminRoute>} />
                      <Route path="/dashboard/invoices" element={<AdminRoute><ErrorBoundary featureName="Invoices"><InvoicesPage /></ErrorBoundary></AdminRoute>} />
                      <Route path="/dashboard/operations" element={<AdminRoute><ErrorBoundary featureName="Operations Tracker"><OperationsTrackerPage /></ErrorBoundary></AdminRoute>} />
                      <Route path="/dashboard/feedback" element={<AdminRoute><ErrorBoundary featureName="Client Feedback"><ClientFeedbackPage /></ErrorBoundary></AdminRoute>} />
                      <Route path="/dashboard/campaigns" element={<AdminRoute><ErrorBoundary featureName="Campaigns"><CampaignsPage /></ErrorBoundary></AdminRoute>} />
                      <Route path="/dashboard/checklists" element={<AdminRoute><ErrorBoundary featureName="Checklists"><ChecklistsPage /></ErrorBoundary></AdminRoute>} />
                      <Route path="/dashboard/payment-integration" element={<AdminRoute><ErrorBoundary featureName="Payment Integration"><PaymentIntegrationPage /></ErrorBoundary></AdminRoute>} />
                      <Route path="/dashboard/subscription" element={<AdminRoute><FinancialRoute><ErrorBoundary featureName="Subscription"><SubscriptionPage /></ErrorBoundary></FinancialRoute></AdminRoute>} />
                      <Route path="/dashboard/help" element={<AdminRoute><ErrorBoundary featureName="Help Center"><HelpPage /></ErrorBoundary></AdminRoute>} />
                      <Route path="/dashboard/discounts" element={<AdminRoute><ErrorBoundary featureName="Discounts"><DiscountsPage /></ErrorBoundary></AdminRoute>} />
                      <Route path="/dashboard/messages" element={<AdminRoute><ErrorBoundary featureName="Messages"><MessagesPage /></ErrorBoundary></AdminRoute>} />
                      <Route path="/dashboard/tasks" element={<AdminRoute><ErrorBoundary featureName="Tasks"><TasksPage /></ErrorBoundary></AdminRoute>} />
                      <Route path="/dashboard/platform-analytics" element={<AdminRoute><ErrorBoundary featureName="Platform Analytics"><PlatformAnalyticsPage /></ErrorBoundary></AdminRoute>} />
                      <Route path="/dashboard/disputes" element={<Navigate to="/dashboard/platform-analytics?tab=evidence" replace />} />
                      <Route path="/dashboard/ai-intelligence" element={<AdminRoute><ErrorBoundary featureName="AI Intelligence"><AIIntelligencePage /></ErrorBoundary></AdminRoute>} />
                      <Route path="/dashboard/client-portal" element={<AdminRoute><ErrorBoundary featureName="Client Portal"><ClientPortalAdminPage /></ErrorBoundary></AdminRoute>} />
                      <Route path="/dashboard/automation-center" element={<AdminRoute><ErrorBoundary featureName="Automation Center"><AutomationCenterPage /></ErrorBoundary></AdminRoute>} />
                      <Route path="/dashboard/custom-work" element={<AdminRoute><ErrorBoundary featureName="Custom Work"><CustomWorkRequestPage /></ErrorBoundary></AdminRoute>} />
                      <Route path="/dashboard/admin/custom-work" element={<PlatformAdminRoute><ErrorBoundary featureName="Custom Work Admin"><AdminCustomWorkRequestsPage /></ErrorBoundary></PlatformAdminRoute>} />
                       <Route path="/dashboard/import" element={<AdminRoute><ErrorBoundary featureName="Data Import"><DataImportPage /></ErrorBoundary></AdminRoute>} />
                       <Route path="/dashboard/booking-photos" element={<AdminRoute><ErrorBoundary featureName="Booking Photos"><BookingPhotosPage /></ErrorBoundary></AdminRoute>} />
                       <Route path="/dashboard/benchmarks" element={<AdminRoute><ErrorBoundary featureName="Benchmarks"><BenchmarksPage /></ErrorBoundary></AdminRoute>} />

                      <Route path="/admin" element={<AdminRoute><ErrorBoundary featureName="Dashboard"><AdminDashboard /></ErrorBoundary></AdminRoute>} />
                      <Route path="/admin/*" element={<AdminRoute><ErrorBoundary featureName="Dashboard"><AdminDashboard /></ErrorBoundary></AdminRoute>} />

                      {/* Catch-all */}
                      <Route path="*" element={<NotFound />} />
                       </Routes>
                     </Suspense>
                   </ErrorBoundary>
                    <CopilotMount />
                    <ProductTour />
                    </CopilotProvider>
                </HashRouter>
              ) : (
                <BrowserRouter>
                  <CopilotProvider>
                 <ErrorBoundary featureName="App">
                   <Suspense fallback={<PageLoader />}>
                     <Routes>
                  {/* Auth Routes - No Session Persistence */}
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/signup" element={<SignupPage />} />
                    <Route path="/logout" element={<LogoutPage />} />
                    
                  {/* Public Routes - Critical Path */}
                    <Route path="/" element={<LandingPage />} />
                    <Route path="/cleaning-business-software" element={<CleaningBusinessSoftware />} />
                    <Route path="/cleaning-business-software/:locationSlug" element={<LocationSoftwarePage />} />
                    {/* /auth renders LoginPage directly (not a redirect) so its
                        unique title/description from LoginPage's isAuthPath logic
                        can actually take effect. Canonical still points to /login. */}
                    <Route path="/auth" element={<LoginPage />} />
                    <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                    <Route path="/reset-password" element={<ResetPasswordPage />} />
                    <Route path="/contact" element={<ContactPage />} />
                    <Route path="/.lovable/oauth/consent" element={<OAuthConsentPage />} />
                    <Route path="/accept-invite" element={<AcceptInvitePage />} />

                    {/* Public Routes - Lazy Loaded */}
                    <Route path="/book/:orgSlug" element={<PublicBookingPage />} />
                    <Route path="/c/:code" element={<RedirectPage />} />
                    <Route path="/card-saved" element={<CardSavedPage />} />
                    <Route path="/tip/:token" element={<TipPage />} />
                     <Route path="/deposit/:token" element={<DepositPage />} />
                     <Route path="/track/:token" element={<TrackCleanerPage />} />
                      <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
                      <Route path="/terms" element={<TermsPage />} />
                     <Route path="/delete-account" element={<DeleteAccountPage />} />
                     <Route path="/pricing" element={<ErrorBoundary featureName="Pricing"><PricingPage /></ErrorBoundary>} />
                     <Route path="/get-the-app" element={<ErrorBoundary featureName="Get the app"><GetTheAppPage /></ErrorBoundary>} />
                     <Route path="/choose-plan" element={<ErrorBoundary featureName="Choose Plan"><ChoosePlanPage /></ErrorBoundary>} />
                     <Route path="/checkout/success" element={<ErrorBoundary featureName="Checkout Success"><CheckoutSuccessPage /></ErrorBoundary>} />
                     <Route path="/demo" element={<DemoPage />} />
                    {/* Onboarding is OUTSIDE AdminRoute. Moving it inside would
                        create an infinite redirect — AdminRoute's needs_onboarding
                        gate sends users here, so it must not be behind it. */}
                    <Route path="/onboarding" element={<OnboardingPage />} />
                    <Route path="/review/:token" element={<ReviewPage />} />
                     <Route path="/blog" element={<BlogIndex />} />
                     <Route path="/score/search" element={<ScoreSearchPage />} />
                     <Route path="/score/generate" element={<ScoreGeneratePage />} />
                     <Route path="/score/city/:citySlug" element={<ScoreCityPage />} />
                     <Route path="/score/c/:slug" element={<ScoreCompanyPage />} />
                    <Route path="/blog/how-to-start-a-cleaning-business" element={<HowToStartCleaningBusiness />} />
                    <Route path="/blog/booking-koala-vs-jobber-vs-tidywise" element={<BookingKoalaVsJobberVsTidywise />} />
                    <Route path="/blog/crm-for-cleaning-business" element={<CleaningBusinessCRM />} />
                    <Route path="/blog/post/:slug" element={<DynamicBlogPost />} />
                    <Route path="/blog/how-to-grow-cleaning-business-2025" element={<GrowCleaningBusiness2025 />} />
                    <Route path="/blog/best-software-for-cleaning-business" element={<BestSoftwareForCleaners />} />
                    <Route path="/blog/how-to-automate-cleaning-company" element={<AutomateCleaningCompany />} />
                    <Route path="/blog/payroll-software-for-cleaning-businesses" element={<PayrollSoftwareForCleaners />} />
                    <Route path="/blog/gps-tracking-cleaning-business" element={<GPSTrackingForCleaners />} />
                    <Route path="/blog/scheduling-software-for-cleaning-business" element={<SchedulingSoftwareForCleaners />} />
                    <Route path="/blog/invoicing-software-for-cleaning-business" element={<InvoicingSoftwareForCleaners />} />
                    <Route path="/blog/maid-service-software" element={<MaidServiceSoftware />} />
                    <Route path="/blog/cleaning-business-management-software" element={<CleaningBusinessManagementSoftware />} />

                    {/* Comparison Pages */}
                    <Route path="/compare/jobber" element={<CompareJobber />} />
                    <Route path="/compare/booking-koala" element={<CompareBookingKoala />} />
                    <Route path="/compare/housecall-pro" element={<CompareHousecallPro />} />
                    <Route path="/compare/zenmaid" element={<CompareZenMaid />} />
                    <Route path="/compare/servicetitan" element={<CompareServiceTitan />} />
                    <Route path="/compare/launch27" element={<CompareLaunch27 />} />
                    <Route path="/compare/:competitorSlug/for/:nicheSlug" element={<CompareNichePage />} />
                    
                    {/* Feature Pages */}
                    <Route path="/features/automated-dispatching" element={<AutomatedDispatching />} />
                    <Route path="/features/quote-software" element={<QuoteSoftware />} />
                    <Route path="/features/sms-notifications" element={<SMSNotifications />} />
                    <Route path="/features/payment-processing" element={<PaymentProcessing />} />
                    <Route path="/features/route-optimization" element={<RouteOptimization />} />
                    <Route path="/features/invoicing-software" element={<InvoicingSoftware />} />
                    <Route path="/features/scheduling-software" element={<SchedulingSoftware />} />
                    <Route path="/features/booking" element={<BookingSoftware />} />
                    <Route path="/features/crm" element={<CRMSoftware />} />
                    <Route path="/features/payroll-software" element={<PayrollSoftware />} />

                    {/* Staff Portal */}
                    <Route path="/staff/login" element={<StaffLoginPage />} />
                    <Route path="/staff/reset-password" element={<StaffResetPasswordPage />} />
                    <Route path="/staff" element={<StaffRoute><ErrorBoundary featureName="Staff Portal"><StaffPortal /></ErrorBoundary></StaffRoute>} />

                    {/* Client Portal */}
                    <Route path="/portal" element={<PortalLoginPage />} />
                    <Route path="/portal/login" element={<PortalLoginPage />} />
                    <Route path="/portal/dashboard" element={<ProtectedPortalRoute><PortalDashboardPage /></ProtectedPortalRoute>} />
                    <Route path="/portal/request" element={<ProtectedPortalRoute><PortalRequestPage /></ProtectedPortalRoute>} />

                    <Route path="/dashboard" element={<AdminRoute><FinancialRoute><ErrorBoundary featureName="Dashboard"><AdminDashboard /></ErrorBoundary></FinancialRoute></AdminRoute>} />
                    <Route path="/dashboard/scheduler" element={<AdminRoute><ErrorBoundary featureName="Scheduler"><SchedulerPage /></ErrorBoundary></AdminRoute>} />
                    <Route path="/dashboard/bookings" element={<AdminRoute><ErrorBoundary featureName="Bookings"><BookingsPage /></ErrorBoundary></AdminRoute>} />
                    <Route path="/dashboard/tracking" element={<AdminRoute><ErrorBoundary featureName="Tracking"><TrackingPage /></ErrorBoundary></AdminRoute>} />
                    <Route path="/dashboard/customers" element={<AdminRoute><ErrorBoundary featureName="Customers"><CustomersPage /></ErrorBoundary></AdminRoute>} />
                    <Route path="/dashboard/customers/duplicates" element={<AdminRoute><ErrorBoundary featureName="Duplicates"><CustomersDuplicatesPage /></ErrorBoundary></AdminRoute>} />
                    <Route path="/dashboard/services" element={<AdminRoute><ErrorBoundary featureName="Services"><ServicesPage /></ErrorBoundary></AdminRoute>} />
                    <Route path="/dashboard/staff" element={<AdminRoute><ErrorBoundary featureName="Staff Management"><StaffPage /></ErrorBoundary></AdminRoute>} />
                    <Route path="/dashboard/payroll" element={<AdminRoute><FinancialRoute><ErrorBoundary featureName="Payroll"><PayrollPage /></ErrorBoundary></FinancialRoute></AdminRoute>} />
                    <Route path="/dashboard/finance" element={<AdminRoute><FinancialRoute><ErrorBoundary featureName="Finance"><FinancePage /></ErrorBoundary></FinancialRoute></AdminRoute>} />
                    <Route path="/dashboard/expenses" element={<AdminRoute><FinancialRoute><ErrorBoundary featureName="Expenses"><ExpensesPage /></ErrorBoundary></FinancialRoute></AdminRoute>} />
                    <Route path="/dashboard/reports" element={<AdminRoute><FinancialRoute><ErrorBoundary featureName="Reports"><ReportsPage /></ErrorBoundary></FinancialRoute></AdminRoute>} />

                    <Route path="/dashboard/settings" element={<AdminRoute><ErrorBoundary featureName="Settings"><SettingsPage /></ErrorBoundary></AdminRoute>} />
                    <Route path="/dashboard/notifications" element={<AdminRoute><ErrorBoundary featureName="Notifications"><NotificationsPage /></ErrorBoundary></AdminRoute>} />
                    <Route path="/dashboard/recurring" element={<AdminRoute><ErrorBoundary featureName="Recurring Bookings"><RecurringBookingsPage /></ErrorBoundary></AdminRoute>} />
                    <Route path="/dashboard/leads" element={<AdminRoute><ErrorBoundary featureName="Leads"><LeadsPage /></ErrorBoundary></AdminRoute>} />
                    <Route path="/dashboard/inventory" element={<AdminRoute><ErrorBoundary featureName="Inventory"><InventoryPage /></ErrorBoundary></AdminRoute>} />
                    <Route path="/dashboard/invoices" element={<AdminRoute><ErrorBoundary featureName="Invoices"><InvoicesPage /></ErrorBoundary></AdminRoute>} />
                    <Route path="/dashboard/operations" element={<AdminRoute><ErrorBoundary featureName="Operations Tracker"><OperationsTrackerPage /></ErrorBoundary></AdminRoute>} />
                    <Route path="/dashboard/feedback" element={<AdminRoute><ErrorBoundary featureName="Client Feedback"><ClientFeedbackPage /></ErrorBoundary></AdminRoute>} />
                    <Route path="/dashboard/campaigns" element={<AdminRoute><ErrorBoundary featureName="Campaigns"><CampaignsPage /></ErrorBoundary></AdminRoute>} />
                    <Route path="/dashboard/checklists" element={<AdminRoute><ErrorBoundary featureName="Checklists"><ChecklistsPage /></ErrorBoundary></AdminRoute>} />
                    <Route path="/dashboard/payment-integration" element={<AdminRoute><ErrorBoundary featureName="Payment Integration"><PaymentIntegrationPage /></ErrorBoundary></AdminRoute>} />
                    <Route path="/dashboard/subscription" element={<AdminRoute><FinancialRoute><ErrorBoundary featureName="Subscription"><SubscriptionPage /></ErrorBoundary></FinancialRoute></AdminRoute>} />
                    <Route path="/dashboard/help" element={<AdminRoute><ErrorBoundary featureName="Help Center"><HelpPage /></ErrorBoundary></AdminRoute>} />
                    
                    <Route path="/dashboard/discounts" element={<AdminRoute><ErrorBoundary featureName="Discounts"><DiscountsPage /></ErrorBoundary></AdminRoute>} />
                    <Route path="/dashboard/messages" element={<AdminRoute><ErrorBoundary featureName="Messages"><MessagesPage /></ErrorBoundary></AdminRoute>} />
                    <Route path="/dashboard/tasks" element={<AdminRoute><ErrorBoundary featureName="Tasks"><TasksPage /></ErrorBoundary></AdminRoute>} />
                    <Route path="/dashboard/platform-analytics" element={<AdminRoute><ErrorBoundary featureName="Platform Analytics"><PlatformAnalyticsPage /></ErrorBoundary></AdminRoute>} />
                    <Route path="/dashboard/disputes" element={<Navigate to="/dashboard/platform-analytics?tab=evidence" replace />} />
                    <Route path="/dashboard/ai-intelligence" element={<AdminRoute><ErrorBoundary featureName="AI Intelligence"><AIIntelligencePage /></ErrorBoundary></AdminRoute>} />
                    <Route path="/dashboard/client-portal" element={<AdminRoute><ErrorBoundary featureName="Client Portal"><ClientPortalAdminPage /></ErrorBoundary></AdminRoute>} />
                    <Route path="/dashboard/automation-center" element={<AdminRoute><ErrorBoundary featureName="Automation Center"><AutomationCenterPage /></ErrorBoundary></AdminRoute>} />
                    <Route path="/dashboard/import" element={<AdminRoute><ErrorBoundary featureName="Data Import"><DataImportPage /></ErrorBoundary></AdminRoute>} />
                    <Route path="/dashboard/booking-photos" element={<AdminRoute><ErrorBoundary featureName="Booking Photos"><BookingPhotosPage /></ErrorBoundary></AdminRoute>} />
                    <Route path="/dashboard/benchmarks" element={<AdminRoute><ErrorBoundary featureName="Benchmarks"><BenchmarksPage /></ErrorBoundary></AdminRoute>} />

                    {/* Platform-admin Blog Editor (must come BEFORE the legacy /admin/* catch-all) */}
                    <Route path="/dashboard/platform-revenue" element={<PlatformAdminRoute><ErrorBoundary featureName="Platform Revenue"><PlatformRevenuePage /></ErrorBoundary></PlatformAdminRoute>} />
                    <Route path="/dashboard/platform-feedback" element={<PlatformAdminRoute><ErrorBoundary featureName="Platform Feedback"><PlatformFeedbackPage /></ErrorBoundary></PlatformAdminRoute>} />
                    {/* The composer lives as a Platform Analytics tab, not its own page.
                        Redirect rather than drop the path, same as /dashboard/disputes above,
                        so any bookmark or link already pointing here still lands somewhere. */}
                    <Route path="/dashboard/broadcasts" element={<Navigate to="/dashboard/platform-analytics?tab=broadcasts" replace />} />
                    {/* Per-broadcast drill-down stays a route: a tab has no URL segment to
                        carry the record id, and this is where a send's per-recipient status
                        and retry live. */}
                    <Route path="/dashboard/broadcasts/:id" element={<PlatformOwnerRoute><ErrorBoundary featureName="Broadcast Detail"><BroadcastDetailPage /></ErrorBoundary></PlatformOwnerRoute>} />

                    <Route path="/admin/blog" element={<PlatformAdminRoute><ErrorBoundary featureName="Blog Admin"><BlogAdminListPage /></ErrorBoundary></PlatformAdminRoute>} />
                    <Route path="/admin/blog/keywords" element={<PlatformAdminRoute><ErrorBoundary featureName="Blog Keywords"><BlogKeywordsPage /></ErrorBoundary></PlatformAdminRoute>} />
                    <Route path="/admin/blog/new" element={<PlatformAdminRoute><ErrorBoundary featureName="Blog Editor"><BlogAdminEditPage mode="new" /></ErrorBoundary></PlatformAdminRoute>} />
                    <Route path="/admin/blog/generate" element={<PlatformAdminRoute><ErrorBoundary featureName="Blog Generate"><BlogAdminGeneratePage /></ErrorBoundary></PlatformAdminRoute>} />
                    <Route path="/admin/blog/:id/edit" element={<PlatformAdminRoute><ErrorBoundary featureName="Blog Editor"><BlogAdminEditPage mode="edit" /></ErrorBoundary></PlatformAdminRoute>} />
                    <Route path="/admin/blog/:id/preview" element={<PlatformAdminRoute><ErrorBoundary featureName="Blog Preview"><BlogAdminPreviewPage /></ErrorBoundary></PlatformAdminRoute>} />
                    <Route path="/admin/access-codes" element={<PlatformAdminRoute><ErrorBoundary featureName="Access Codes"><AccessCodesAdminPage /></ErrorBoundary></PlatformAdminRoute>} />

                    {/* Legacy admin routes */}
                    <Route path="/admin" element={<AdminRoute><ErrorBoundary featureName="Dashboard"><AdminDashboard /></ErrorBoundary></AdminRoute>} />
                    <Route path="/admin/*" element={<AdminRoute><ErrorBoundary featureName="Dashboard"><AdminDashboard /></ErrorBoundary></AdminRoute>} />

                    {/* Catch-all */}
                    <Route path="*" element={<NotFound />} />
                     </Routes>
                   </Suspense>
                 </ErrorBoundary>
                   <CopilotMount />
                   <ProductTour />
                  </CopilotProvider>
                </BrowserRouter>
              )}
              </TooltipProvider>
              </ClientPortalProvider>
              </TestModeProvider>
            </OrganizationProvider>
          </SessionTrackerProvider>
        </AuthProvider>
      </AuthProviderNoSession>
    </PersistQueryClientProvider>
  </ThemeProvider>
);

export default App;
