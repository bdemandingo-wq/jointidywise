# Adding the Facebook iOS SDK back

The iOS app does not include the Facebook SDK or App Tracking Transparency. That is what cleared App Store review error `BINARY_INDICATES_APP_TRACKS_USERS`. The website Meta pixel in `src/components/TrackingPixels.tsx` is still there. Facebook lead webhooks are still there. This note is only about the native binary.

Do this only when you are ready for the App Store privacy labels to say the app tracks users, and you have a tracking permission string Apple will accept.

## 1. Swift package

In `ios/App/App.xcodeproj`, add the remote package `https://github.com/facebook/facebook-ios-sdk` (17.x) and link the **FacebookCore** product to the App target. Do not add it to `ios/App/CapApp-SPM/Package.swift`. That file is Capacitor's plugin list, and `npx cap sync ios` rewrites it.

## 2. Info.plist

Put these keys back in `ios/App/App/Info.plist`:

- `FacebookAppID` = `1068634425721355`
- `FacebookClientToken` = `f8aee381403adf83a9cdee6227697835`
- `FacebookDisplayName` = `TidyWise`
- `FacebookAutoLogAppEventsEnabled` = true
- `FacebookAdvertiserIDCollectionEnabled` = true
- `LSApplicationQueriesSchemes`: `fbapi`, `fb-messenger-share-api`, `fbauth2`, `fbshareextension`
- `NSUserTrackingUsageDescription` with the reason you show the tracking prompt
- URL scheme `fb1068634425721355` under `CFBundleURLTypes`

## 3. App delegate and plugin

- `import FBSDKCoreKit` in `AppDelegate.swift`.
- Call `ApplicationDelegate.shared.application(...)` from `didFinishLaunching` and from the Facebook `fb` open-URL path. Other URLs stay on Capacitor's `ApplicationDelegateProxy`.
- Restore `MetaEventsPlugin.swift` and `MetaEventsPlugin.m` (they called `AppEvents` and `ATTrackingManager.requestTrackingAuthorization`) and register the plugin on the bridge.

## 4. JavaScript

`src/lib/metaEvents.ts` is a no-op. Point `logMetaEvent`, `logMetaPurchase`, and `requestTrackingPermission` at the `MetaEvents` Capacitor plugin again, and call `requestTrackingPermission()` only after the first screen is on screen (the old call waited 3 seconds in `AppStateHandler`). Do not call it during launch.

## 5. Ship

Archive a new build and confirm the privacy report has no Facebook tracking domains and no `NSPrivacyTracking` = true until you intend to declare tracking. Update App Store Connect privacy answers in the same release.
