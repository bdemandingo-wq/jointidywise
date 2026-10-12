#import <Capacitor/Capacitor.h>

CAP_PLUGIN(NotificationAuthPlugin, "NotificationAuth",
    CAP_PLUGIN_METHOD(checkPermissions, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(requestPermissions, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(register, CAPPluginReturnPromise);
)
