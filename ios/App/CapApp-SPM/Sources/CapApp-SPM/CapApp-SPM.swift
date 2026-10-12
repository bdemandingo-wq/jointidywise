import class PushNotificationsPlugin.PushNotificationsPlugin

public let isCapacitorApp = true

// packageClassList registers plugins with NSClassFromString. A Swift class
// in this package can show up in the binary and still be missing from the
// ObjC runtime until something in the linked image names it. Build 1010 had
// the symbols and the class list, and the permission call still never ran.
public let tidyWisePushNotificationsPlugin: AnyClass = PushNotificationsPlugin.self
