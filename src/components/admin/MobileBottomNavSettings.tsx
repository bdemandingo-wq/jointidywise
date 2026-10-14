import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useOrgId } from "@/hooks/useOrgId";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Navigation, Plus, RotateCcw } from "lucide-react";
import {
  ALL_NAV_PAGES,
  DEFAULT_SLOTS,
  ICON_MAP,
  type MobileNavItem,
} from "@/components/mobile/MobileBottomNav";
import { writeCachedMobileNav } from "@/lib/mobileNavSlots";

export function MobileBottomNavSettings() {
  const { organizationId } = useOrgId();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [slots, setSlots] = useState<MobileNavItem[]>([...DEFAULT_SLOTS]);

  useEffect(() => {
    if (!organizationId) return;
    setLoading(true);

    supabase
      .from("organization_mobile_nav_settings")
      .select("items")
      .eq("organization_id", organizationId)
      .eq("role", "admin")
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          console.error(error);
          setLoading(false);
          return;
        }
        const items = Array.isArray((data as any)?.items) ? ((data as any).items as MobileNavItem[]) : [];
        if (items.length === 4) setSlots(items);
        setLoading(false);
      });
  }, [organizationId]);

  const updateSlot = (index: number, pageId: string) => {
    const page = ALL_NAV_PAGES.find((p) => p.id === pageId);
    if (!page) return;
    setSlots((prev) => prev.map((s, i) => (i === index ? { ...page } : s)));
  };

  const save = async () => {
    if (!organizationId) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("organization_mobile_nav_settings")
        .upsert(
          {
            organization_id: organizationId,
            role: "admin",
            items: slots,
            updated_at: new Date().toISOString(),
          } as any,
          { onConflict: "organization_id,role" }
        );
      if (error) throw error;
      writeCachedMobileNav(organizationId, slots);
      window.dispatchEvent(new CustomEvent("tw:mobile-nav-saved", {
        detail: { organizationId, items: slots },
      }));
      toast.success("Navigation saved");
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const reset = () => setSlots([...DEFAULT_SLOTS]);

  const slotLabels = ["Left 1", "Left 2", "Right 1", "Right 2"];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Navigation className="h-5 w-5" />
          Customize Navigation
        </CardTitle>
        <CardDescription>
          Choose 4 pages for the mobile bottom bar. The <Plus className="inline h-3.5 w-3.5 -mt-0.5" /> button is always locked in the center.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            {/* Preview */}
            <div className="rounded-xl border bg-muted/40 p-3">
              <p className="text-xs text-muted-foreground mb-2 font-medium">Preview</p>
              <div className="grid grid-cols-5 gap-1">
                {slots.slice(0, 2).map((s) => {
                  const Icon = ICON_MAP[s.iconKey];
                  return (
                    <div key={s.id} className="flex flex-col items-center gap-0.5 text-[10px] text-muted-foreground">
                      {Icon && <Icon className="h-4 w-4" />}
                      <span className="text-center leading-tight break-words w-full">{s.label}</span>
                    </div>
                  );
                })}
                <div className="flex flex-col items-center gap-0.5">
                  <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center shadow-md">
                    <Plus className="h-5 w-5 text-primary-foreground" />
                  </div>
                </div>
                {slots.slice(2, 4).map((s) => {
                  const Icon = ICON_MAP[s.iconKey];
                  return (
                    <div key={s.id} className="flex flex-col items-center gap-0.5 text-[10px] text-muted-foreground">
                      {Icon && <Icon className="h-4 w-4" />}
                      <span className="text-center leading-tight break-words w-full">{s.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Slot selectors */}
            <div className="grid gap-3">
              {slots.map((slot, idx) => (
                <div key={idx} className="grid gap-1.5">
                  <Label className="text-xs text-muted-foreground">{slotLabels[idx]}</Label>
                  <Select value={slot.id} onValueChange={(v) => updateSlot(idx, v)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ALL_NAV_PAGES.map((page) => {
                        const Icon = ICON_MAP[page.iconKey];
                        return (
                          <SelectItem key={page.id} value={page.id}>
                            <span className="flex items-center gap-2">
                              {Icon && <Icon className="h-4 w-4" />}
                              {page.label}
                            </span>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <Button onClick={save} disabled={saving} className="gap-2">
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Save
              </Button>
              <Button variant="outline" onClick={reset} className="gap-2">
                <RotateCcw className="h-4 w-4" /> Reset
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
