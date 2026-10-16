import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useOrganization } from '@/contexts/OrganizationContext';

export type ExcludableRoomType = 'bedroom' | 'bathroom' | 'full_bath';

export interface RoomReductionPrices {
  bedroom: number;
  bathroom: number;
  full_bath: number;
}

export const DEFAULT_ROOM_REDUCTION_PRICES: RoomReductionPrices = {
  bedroom: 25,
  bathroom: 20,
  full_bath: 25,
};

export interface OrganizationPricingSettings {
  id?: string;
  organization_id: string;
  show_sqft_on_booking: boolean;
  show_addons_on_booking: boolean;
  show_frequency_discount: boolean;
  show_pet_options: boolean;
  show_home_condition: boolean;
  show_bed_bath_on_booking: boolean;
  sales_tax_percent: number;
  loyalty_program_enabled: boolean;
  booking_form_theme: string;
  form_bg_color: string | null;
  form_card_color: string | null;
  form_text_color: string | null;
  form_button_color: string | null;
  form_button_text_color: string | null;
  form_accent_color: string | null;
  // New: pet toggle + exclude parameters
  pet_fee: number;
  pet_toggle_enabled: boolean;
  excluded_room_types: ExcludableRoomType[];
  room_reduction_prices: RoomReductionPrices;
}

const defaultSettings: Omit<OrganizationPricingSettings, 'organization_id'> = {
  show_sqft_on_booking: true,
  show_addons_on_booking: true,
  show_frequency_discount: true,
  show_pet_options: true,
  show_home_condition: true,
  show_bed_bath_on_booking: true,
  sales_tax_percent: 0,
  loyalty_program_enabled: true,
  booking_form_theme: 'dark',
  form_bg_color: null,
  form_card_color: null,
  form_text_color: null,
  form_button_color: null,
  form_button_text_color: null,
  form_accent_color: null,
  pet_fee: 25,
  pet_toggle_enabled: true,
  excluded_room_types: [],
  room_reduction_prices: { ...DEFAULT_ROOM_REDUCTION_PRICES },
};

export function useOrganizationSettings() {
  const { organization } = useOrganization();
  const [settings, setSettings] = useState<OrganizationPricingSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSettings = useCallback(async () => {
    if (!organization?.id) return;
    
    try {
      const { data, error } = await supabase
        .from('organization_pricing_settings')
        .select('*')
        .eq('organization_id', organization.id)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setSettings({
          id: data.id,
          organization_id: data.organization_id,
          show_sqft_on_booking: data.show_sqft_on_booking ?? true,
          show_addons_on_booking: data.show_addons_on_booking ?? true,
          show_frequency_discount: data.show_frequency_discount ?? true,
          show_pet_options: data.show_pet_options ?? true,
          show_home_condition: data.show_home_condition ?? true,
          show_bed_bath_on_booking: data.show_bed_bath_on_booking ?? true,
          sales_tax_percent: Number(data.sales_tax_percent) || 0,
          loyalty_program_enabled: (data as any).loyalty_program_enabled ?? true,
          booking_form_theme: (data as any).booking_form_theme ?? 'dark',
          form_bg_color: (data as any).form_bg_color ?? null,
          form_card_color: (data as any).form_card_color ?? null,
          form_text_color: (data as any).form_text_color ?? null,
          form_button_color: (data as any).form_button_color ?? null,
          form_button_text_color: (data as any).form_button_text_color ?? null,
          form_accent_color: (data as any).form_accent_color ?? null,
          pet_fee: Number((data as any).pet_fee ?? 25),
          pet_toggle_enabled: (data as any).pet_toggle_enabled ?? true,
          excluded_room_types: ((data as any).excluded_room_types ?? []) as ExcludableRoomType[],
          room_reduction_prices: {
            ...DEFAULT_ROOM_REDUCTION_PRICES,
            ...(((data as any).room_reduction_prices ?? {}) as Partial<RoomReductionPrices>),
          },
        });
      } else {
        // Create default settings
        setSettings({
          organization_id: organization.id,
          ...defaultSettings,
        });
      }
    } catch (error) {
      console.error('Error fetching organization settings:', error);
    } finally {
      setLoading(false);
    }
  }, [organization?.id]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const saveSettings = async (updates: Partial<OrganizationPricingSettings>) => {
    if (!organization?.id) return;

    try {
      // Re-fetch the latest row before merging so concurrent card saves on the
      // same page don't overwrite each other with stale local state.
      const { data: current } = await supabase
        .from('organization_pricing_settings')
        .select('*')
        .eq('organization_id', organization.id)
        .maybeSingle();

      const base: any = current ?? {};
      const pick = <K extends keyof OrganizationPricingSettings>(key: K, fallback: any) => {
        if ((updates as any)[key] !== undefined) return (updates as any)[key];
        if ((base as any)[key] !== undefined && (base as any)[key] !== null) return (base as any)[key];
        return (settings as any)?.[key] ?? fallback;
      };

      // demo_mode_enabled stays on the row and is unused. Leave it out of the
      // payload so a settings save does not rewrite the column.
      const settingsData = {
        organization_id: organization.id,
        show_sqft_on_booking: pick('show_sqft_on_booking', true),
        show_addons_on_booking: pick('show_addons_on_booking', true),
        show_frequency_discount: pick('show_frequency_discount', true),
        show_pet_options: pick('show_pet_options', true),
        show_home_condition: pick('show_home_condition', true),
        show_bed_bath_on_booking: pick('show_bed_bath_on_booking', true),
        sales_tax_percent: pick('sales_tax_percent', 0),
        loyalty_program_enabled: pick('loyalty_program_enabled', true),
        booking_form_theme: pick('booking_form_theme', 'dark'),
        form_bg_color: updates.form_bg_color !== undefined ? updates.form_bg_color : (base.form_bg_color ?? settings?.form_bg_color ?? null),
        form_card_color: updates.form_card_color !== undefined ? updates.form_card_color : (base.form_card_color ?? settings?.form_card_color ?? null),
        form_text_color: updates.form_text_color !== undefined ? updates.form_text_color : (base.form_text_color ?? settings?.form_text_color ?? null),
        form_button_color: updates.form_button_color !== undefined ? updates.form_button_color : (base.form_button_color ?? settings?.form_button_color ?? null),
        form_button_text_color: updates.form_button_text_color !== undefined ? updates.form_button_text_color : (base.form_button_text_color ?? settings?.form_button_text_color ?? null),
        form_accent_color: updates.form_accent_color !== undefined ? updates.form_accent_color : (base.form_accent_color ?? settings?.form_accent_color ?? null),
        pet_fee: pick('pet_fee', 25),
        pet_toggle_enabled: pick('pet_toggle_enabled', true),
        excluded_room_types: updates.excluded_room_types ?? base.excluded_room_types ?? settings?.excluded_room_types ?? [],
        room_reduction_prices: updates.room_reduction_prices ?? base.room_reduction_prices ?? settings?.room_reduction_prices ?? { ...DEFAULT_ROOM_REDUCTION_PRICES },
      };


      const { data, error } = await supabase
        .from('organization_pricing_settings')
        .upsert(settingsData as any, {
          onConflict: 'organization_id',
          ignoreDuplicates: false 
        })
        .select()
        .single();

      if (error) throw error;

      setSettings({
        id: data.id,
        organization_id: data.organization_id,
        show_sqft_on_booking: data.show_sqft_on_booking ?? true,
        show_addons_on_booking: data.show_addons_on_booking ?? true,
        show_frequency_discount: data.show_frequency_discount ?? true,
        show_pet_options: data.show_pet_options ?? true,
        show_home_condition: data.show_home_condition ?? true,
        show_bed_bath_on_booking: data.show_bed_bath_on_booking ?? true,
        sales_tax_percent: Number(data.sales_tax_percent) || 0,
        loyalty_program_enabled: (data as any).loyalty_program_enabled ?? true,
        booking_form_theme: (data as any).booking_form_theme ?? 'dark',
        form_bg_color: (data as any).form_bg_color ?? null,
        form_card_color: (data as any).form_card_color ?? null,
        form_text_color: (data as any).form_text_color ?? null,
        form_button_color: (data as any).form_button_color ?? null,
        form_button_text_color: (data as any).form_button_text_color ?? null,
        form_accent_color: (data as any).form_accent_color ?? null,
        pet_fee: Number((data as any).pet_fee ?? 25),
        pet_toggle_enabled: (data as any).pet_toggle_enabled ?? true,
        excluded_room_types: ((data as any).excluded_room_types ?? []) as ExcludableRoomType[],
        room_reduction_prices: {
          ...DEFAULT_ROOM_REDUCTION_PRICES,
          ...(((data as any).room_reduction_prices ?? {}) as Partial<RoomReductionPrices>),
        },
      });

      return true;
    } catch (error) {
      console.error('Error saving organization settings:', error);
      return false;
    }
  };

  return {
    settings,
    loading,
    saveSettings,
    refetch: fetchSettings,
  };
}
