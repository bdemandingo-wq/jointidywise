/**
 * Canned replies for the two public booking reads the form needs.
 * They never call the network.
 */

import { DEMO_ORG_ID } from '@/lib/demo/session';
import { getDemoTables } from '@/lib/demo/dataset';

export function demoFunctionData(name: string): unknown | undefined {
  if (name === 'public-booking-data') {
    const services = getDemoTables().services.map((service) => ({
      id: service.id,
      name: service.name,
      description: service.description,
      price: service.price,
      duration: service.duration,
    }));
    return {
      success: true,
      organization: {
        id: DEMO_ORG_ID,
        name: 'Harbor & Pine Cleaning',
        logo_url: null,
      },
      services,
      servicePricing: [],
      bookingFormTheme: 'light',
      displaySettings: {
        show_sqft_on_booking: true,
        show_bed_bath_on_booking: true,
        show_addons_on_booking: true,
        show_frequency_discount: true,
        show_pet_options: true,
        show_home_condition: true,
      },
    };
  }
  if (name === 'check-availability') {
    return {
      timezone: 'America/Chicago',
      slots: ['09:00', '11:00', '13:00', '15:00'].map((time) => ({ time, available: true })),
    };
  }
  return undefined;
}
