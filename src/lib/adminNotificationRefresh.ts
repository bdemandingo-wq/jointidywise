/** Ask the owner notification bell to reload. Pull-to-refresh dispatches this. */
export const ADMIN_NOTIFICATION_REFRESH = 'tw-refresh-admin-notifications';

export function requestAdminNotificationRefresh() {
  window.dispatchEvent(new Event(ADMIN_NOTIFICATION_REFRESH));
}
