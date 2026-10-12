import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { DollarSign, LayoutGrid, Save, Loader2 } from 'lucide-react';
import { useOrganizationSettings } from '@/hooks/useOrganizationSettings';
import { toast } from 'sonner';
import { parseSalesTaxPercent } from '@/lib/validation';

export function PricingSettingsCard() {
  const { settings, loading, saveSettings } = useOrganizationSettings();
  const [showSqft, setShowSqft] = useState(true);
  const [salesTax, setSalesTax] = useState('0');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings) {
      setShowSqft(settings.show_sqft_on_booking);
      setSalesTax(settings.sales_tax_percent.toString());
    }
  }, [settings]);

  const handleSave = async () => {
    const tax = parseSalesTaxPercent(salesTax);
    if (!tax.ok) {
      toast.error(tax.message);
      return;
    }
    setSaving(true);
    const success = await saveSettings({
      show_sqft_on_booking: showSqft,
      sales_tax_percent: tax.value,
    });
    setSaving(false);
    
    if (success) {
      toast.success('Pricing settings saved');
    } else {
      toast.error('Failed to save settings');
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-32">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DollarSign className="w-5 h-5" />
          Pricing & Tax Settings
        </CardTitle>
        <CardDescription>
          Configure how pricing is displayed and calculated
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <LayoutGrid className="w-4 h-4 text-muted-foreground" />
              <p className="font-medium">Show Square Footage on Booking Form</p>
            </div>
            <p className="text-sm text-muted-foreground">
              When disabled, square footage selection will be hidden from the booking form.
              Pricing will be based on bedroom/bathroom count only.
            </p>
          </div>
          <Switch
            checked={showSqft}
            onCheckedChange={setShowSqft}
          />
        </div>

        <Separator />

        <div className="space-y-2">
          <Label htmlFor="salesTax">State Sales Tax (%)</Label>
          <div className="flex items-center gap-2">
            <Input
              id="salesTax"
              type="number"
              step="0.01"
              min="0"
              max="100"
              value={salesTax}
              onChange={(e) => setSalesTax(e.target.value)}
              className="w-32"
              placeholder="0"
            />
            <span className="text-muted-foreground">%</span>
          </div>
          <p className="text-sm text-muted-foreground">
            This percentage will be automatically added to the booking total at checkout.
            Leave at 0 to disable tax calculation.
          </p>
        </div>

        <Button className="gap-2" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Pricing Settings
        </Button>
      </CardContent>
    </Card>
  );
}
