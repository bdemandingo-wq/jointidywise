import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";
import { useOrganization } from "@/contexts/OrganizationContext";
import { mustAffectRows } from "@/lib/mustAffectRows";

/**
 * Opt-out data layer for the Campaigns page.
 *
 * Extracted verbatim from CampaignsPage.tsx — query keys, filters, ordering,
 * error handling and toast copy are unchanged, so cached data and behaviour
 * carry over exactly.
 *
 * `useOptOutCustomerSearch` deliberately takes the search term as an argument
 * rather than owning it. The term stays in the component that renders the
 * input, so the existing keystroke-by-keystroke behaviour (and the 2-character
 * minimum that gates the query) is preserved exactly where it was.
 */

export interface OptOutCandidate {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
}

export function useOptOutCustomerSearch(orgId: string | null, search: string) {
  return useQuery({
    queryKey: ["customer-search-optout", orgId, search],
    queryFn: async () => {
      if (!orgId || search.trim().length < 2) return [];
      const term = `%${search.trim()}%`;
      const { data, error } = await supabase
        .from("customers")
        .select("id, first_name, last_name, phone, email")
        .eq("organization_id", orgId)
        .eq("marketing_status", "active")
        .or(`first_name.ilike.${term},last_name.ilike.${term},phone.ilike.${term},email.ilike.${term}`)
        .limit(8);
      if (error) throw error;
      return data || [];
    },
    enabled: !!orgId && search.trim().length >= 2,
  });
}

export function useOptedOutCount(orgId: string | null) {
  return useQuery({
    queryKey: ["opted-out-count", orgId],
    queryFn: async () => {
      if (!orgId) return 0;
      const { count, error } = await supabase
        .from("customers")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("marketing_status", "opted_out");
      if (error) return 0;
      return count || 0;
    },
    enabled: !!orgId,
  });
}

export function useOptedOutList(orgId: string | null) {
  return useQuery({
    queryKey: ["opted-out-list", orgId],
    queryFn: async () => {
      if (!orgId) return [];
      const { data, error } = await supabase
        .from("customers")
        .select(
          "id, first_name, last_name, phone, email, opted_out_at, opted_out_method, opted_out_campaign_id, updated_at",
        )
        .eq("organization_id", orgId)
        .eq("marketing_status", "opted_out")
        .order("opted_out_at", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!orgId,
  });
}

export function useSetOptOutStatus() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { organization } = useOrganization();

  return useMutation({
    mutationFn: async ({ customerId, optedOut }: { customerId: string; optedOut: boolean }) => {
      // The original inline version annotated this `any`, which under
      // noImplicitAny left the null branches untyped. Same shape, real type.
      const update: {
        marketing_status: string;
        opted_out_at: string | null;
        opted_out_method: string | null;
        opted_out_campaign_id?: string | null;
      } = optedOut
        ? {
            marketing_status: "opted_out",
            opted_out_at: new Date().toISOString(),
            opted_out_method: "manual",
          }
        : {
            marketing_status: "active",
            opted_out_at: null,
            opted_out_method: null,
            opted_out_campaign_id: null,
          };
      if (!organization?.id) throw new Error("No organization found");
      await mustAffectRows(
        supabase.from("customers").update(update).eq("id", customerId).eq("organization_id", organization.id),
        "Contact not updated. It may belong to a different business.",
        { table: "customers" },
      );
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["opted-out-list"] });
      queryClient.invalidateQueries({ queryKey: ["opted-out-count"] });
      toast({ title: vars.optedOut ? "Marked as opted out" : "Opted back in" });
    },
    onError: (err: Error) =>
      toast({ title: "Error", description: err.message, variant: "destructive" }),
  });
}
