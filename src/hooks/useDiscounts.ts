import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useOrganization } from '@/contexts/OrganizationContext';

export interface Discount {
  id: string;
  organization_id: string;
  code: string;
  description: string | null;
  discount_type: 'percentage' | 'flat';
  discount_value: number;
  min_order_amount: number;
  max_uses: number | null;
  current_uses: number;
  valid_from: string;
  valid_until: string | null;
  is_active: boolean;
  is_test: boolean;
  created_at: string;
}

export function useDiscounts() {
  const { organization } = useOrganization();
  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDiscounts = useCallback(async () => {
    if (!organization?.id) return;

    try {
      const { data, error } = await supabase
        .from('discounts')
        .select('*')
        .eq('organization_id', organization.id)
        .eq('is_test', false)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setDiscounts((data || []) as Discount[]);
    } catch (error) {
      console.error('Error fetching discounts:', error);
    } finally {
      setLoading(false);
    }
  }, [organization?.id]);

  useEffect(() => {
    fetchDiscounts();
  }, [fetchDiscounts]);

  const createDiscount = async (discount: Omit<Discount, 'id' | 'organization_id' | 'current_uses' | 'created_at' | 'is_test'>) => {
    if (!organization?.id) return null;

    try {
      const { data, error } = await supabase
        .from('discounts')
        .insert({
          ...discount,
          organization_id: organization.id,
          is_test: false,
        })
        .select()
        .single();

      if (error) throw error;
      await fetchDiscounts();
      return data;
    } catch (error) {
      console.error('Error creating discount:', error);
      return null;
    }
  };

  const updateDiscount = async (id: string, updates: Partial<Discount>) => {
    try {
      const { error } = await supabase
        .from('discounts')
        .update(updates)
        .eq('id', id);

      if (error) throw error;
      await fetchDiscounts();
      return true;
    } catch (error) {
      console.error('Error updating discount:', error);
      return false;
    }
  };

  const deleteDiscount = async (id: string) => {
    try {
      const { error } = await supabase
        .from('discounts')
        .delete()
        .eq('id', id);

      if (error) throw error;
      await fetchDiscounts();
      return true;
    } catch (error) {
      console.error('Error deleting discount:', error);
      return false;
    }
  };

  const validateCoupon = async (code: string, orderAmount: number): Promise<Discount | null> => {
    if (!organization?.id) return null;

    try {
      const { data, error } = await supabase
        .from('discounts')
        .select('*')
        .eq('organization_id', organization.id)
        .eq('code', code.toUpperCase())
        .eq('is_active', true)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;

      const discount = data as Discount;

      // Check if within valid date range
      const now = new Date();
      if (discount.valid_from && new Date(discount.valid_from) > now) {
        return null;
      }
      if (discount.valid_until && new Date(discount.valid_until) < now) {
        return null;
      }

      // Check max uses
      if (discount.max_uses && discount.current_uses >= discount.max_uses) {
        return null;
      }

      // Check minimum order amount
      if (orderAmount < discount.min_order_amount) {
        return null;
      }

      if (discount.discount_type === 'percentage' && (discount.discount_value <= 0 || discount.discount_value > 100)) {
        return null;
      }

      return discount;
    } catch (error) {
      console.error('Error validating coupon:', error);
      return null;
    }
  };

  const calculateDiscountAmount = (discount: Discount, subtotal: number): number => {
    if (discount.discount_type === 'percentage') {
      const pct = Math.min(Math.max(discount.discount_value, 0), 100);
      return (subtotal * pct) / 100;
    }
    return Math.min(discount.discount_value, subtotal);
  };

  // NOTE: as of writing this has no callers anywhere in the app — coupon
  // max_uses is therefore unenforced regardless of this function's error
  // handling below, since current_uses never actually increments. Fixing
  // that requires wiring a call to this into wherever a coupon is
  // actually redeemed; out of scope here, flagging so it isn't mistaken
  // for "fixed" by the error-check alone.
  const incrementCouponUse = async (discountId: string): Promise<boolean> => {
    try {
      const discount = discounts.find(d => d.id === discountId);
      if (!discount) return false;
      const { error } = await supabase
        .from('discounts')
        .update({ current_uses: discount.current_uses + 1 })
        .eq('id', discountId);
      if (error) {
        console.error('Error incrementing coupon use:', error);
        return false;
      }
      return true;
    } catch (error) {
      console.error('Error incrementing coupon use:', error);
      return false;
    }
  };

  return {
    discounts,
    loading,
    createDiscount,
    updateDiscount,
    deleteDiscount,
    validateCoupon,
    calculateDiscountAmount,
    incrementCouponUse,
    refetch: fetchDiscounts,
  };
}
