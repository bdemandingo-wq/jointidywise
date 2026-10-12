/**
 * Platform detection hook for iOS App Store compliance
 * Used to conditionally show/hide payment flows on native vs web
 */

import { Capacitor } from '@capacitor/core';

export function usePlatform() {
  const isNative = Capacitor.isNativePlatform();
  const platform = Capacitor.getPlatform(); // 'ios' | 'android' | 'web'
  const isIOS = platform === 'ios';
  const isAndroid = platform === 'android';
  const isWeb = platform === 'web';
  
  // For App Store compliance: no payment flows on native apps
  const canShowPaymentFlows = !isNative;
  
  // Website URL for directing users to web for payments/signup
  const websiteUrl = import.meta.env.VITE_APP_URL || 'https://jointidywise.com';
  const billingUrl = `${websiteUrl}/dashboard/settings?tab=subscription`;
  const signupUrl = `${websiteUrl}/signup`;
  
  return {
    isNative,
    isIOS,
    isAndroid,
    isWeb,
    canShowPaymentFlows,
    websiteUrl,
    billingUrl,
    signupUrl,
  };
}
