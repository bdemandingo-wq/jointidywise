#import <Capacitor/Capacitor.h>

CAP_PLUGIN(TripBackgroundLocationPlugin, "TripBackgroundLocation",
    CAP_PLUGIN_METHOD(checkAuthorization, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(requestAlways, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(start, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(stop, CAPPluginReturnPromise);
)
