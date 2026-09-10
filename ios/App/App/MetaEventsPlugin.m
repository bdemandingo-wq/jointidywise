#import <Capacitor/Capacitor.h>

CAP_PLUGIN(MetaEventsPlugin, "MetaEvents",
    CAP_PLUGIN_METHOD(logEvent, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(logPurchase, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(requestTracking, CAPPluginReturnPromise);
)
