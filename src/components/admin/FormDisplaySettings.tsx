import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, Save, Eye, EyeOff, Sun, Moon, Palette, RotateCcw } from 'lucide-react';
import { useOrganizationSettings } from '@/hooks/useOrganizationSettings';
import { toast } from 'sonner';
import { parseSalesTaxPercent } from '@/lib/validation';
import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';

export function FormDisplaySettings() {
  const { settings, loading, saveSettings } = useOrganizationSettings();
  const [saving, setSaving] = useState(false);
  const [salesTaxDraft, setSalesTaxDraft] = useState('0');
  const [localSettings, setLocalSettings] = useState({
    show_sqft_on_booking: true,
    show_addons_on_booking: true,
    show_frequency_discount: true,
    show_pet_options: true,
    show_home_condition: true,
    show_bed_bath_on_booking: true,
    sales_tax_percent: 0,
    booking_form_theme: 'dark' as string,
    form_bg_color: null as string | null,
    form_card_color: null as string | null,
    form_text_color: null as string | null,
    form_button_color: null as string | null,
    form_button_text_color: null as string | null,
    form_accent_color: null as string | null,
  });

  useEffect(() => {
    if (settings) {
      setLocalSettings({
        show_sqft_on_booking: settings.show_sqft_on_booking,
        show_addons_on_booking: settings.show_addons_on_booking,
        show_frequency_discount: settings.show_frequency_discount,
        show_pet_options: settings.show_pet_options,
        show_home_condition: settings.show_home_condition,
        show_bed_bath_on_booking: settings.show_bed_bath_on_booking,
        sales_tax_percent: settings.sales_tax_percent,
        booking_form_theme: settings.booking_form_theme || 'dark',
        form_bg_color: settings.form_bg_color,
        form_card_color: settings.form_card_color,
        form_text_color: settings.form_text_color,
        form_button_color: settings.form_button_color,
        form_button_text_color: settings.form_button_text_color,
        form_accent_color: settings.form_accent_color,
      });
      setSalesTaxDraft(
        settings.sales_tax_percent == null ? '0' : String(settings.sales_tax_percent),
      );
    }
  }, [settings]);

  const handleSave = async () => {
    const tax = parseSalesTaxPercent(salesTaxDraft);
    if (!tax.ok) {
      toast.error(tax.message);
      return;
    }
    setSaving(true);
    const success = await saveSettings({ ...localSettings, sales_tax_percent: tax.value });
    setSaving(false);
    if (success) {
      toast.success('Display settings saved');
    } else {
      toast.error('Failed to save settings');
    }
  };

  const hasCustomColors = localSettings.form_bg_color || localSettings.form_card_color || localSettings.form_text_color || localSettings.form_button_color || localSettings.form_button_text_color || localSettings.form_accent_color;

  const resetCustomColors = () => {
    setLocalSettings(prev => ({
      ...prev,
      form_bg_color: null,
      form_card_color: null,
      form_text_color: null,
      form_button_color: null,
      form_button_text_color: null,
      form_accent_color: null,
    }));
  };

  const colorOptions = [
    { key: 'form_bg_color' as const, label: 'Background', description: 'Page background color', defaultDark: '#0a0f1a', defaultLight: '#ffffff' },
    { key: 'form_card_color' as const, label: 'Cards', description: 'Card and section backgrounds', defaultDark: '#111827', defaultLight: '#f5f5f5' },
    { key: 'form_text_color' as const, label: 'Text', description: 'Main text and headings', defaultDark: '#f1f5f9', defaultLight: '#1a1a2e' },
    { key: 'form_button_color' as const, label: 'Buttons', description: 'Primary action buttons', defaultDark: '#3b82f6', defaultLight: '#2563eb' },
    { key: 'form_button_text_color' as const, label: 'Button Text', description: 'Text on buttons', defaultDark: '#ffffff', defaultLight: '#ffffff' },
    { key: 'form_accent_color' as const, label: 'Accent', description: 'Headings, borders, icons & highlights', defaultDark: '#22d3ee', defaultLight: '#0891b2' },
  ];

  const toggleOptions = [
    {
      key: 'show_sqft_on_booking' as const,
      label: 'Square Footage Pricing',
      description: 'Show square footage input field on booking form',
    },
    {
      key: 'show_bed_bath_on_booking' as const,
      label: 'Bed & Bath Selection',
      description: 'Show bedroom and bathroom selection on booking form',
    },
    {
      key: 'show_addons_on_booking' as const,
      label: 'Add-On Extras',
      description: 'Show add-on services selection on booking form',
    },
    {
      key: 'show_frequency_discount' as const,
      label: 'Frequency Discount',
      description: 'Show recurring service frequency options with discounts',
    },
    {
      key: 'show_pet_options' as const,
      label: 'Pet Options',
      description: 'Show pet fee options on booking form',
    },
    {
      key: 'show_home_condition' as const,
      label: 'Home Condition',
      description: 'Show home condition pricing options',
    },
  ];

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Eye className="h-5 w-5" />
          Form Display Settings
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Control which sections appear on the customer booking form
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Booking Form Theme */}
        <div>
          <Label className="text-sm font-medium mb-3 block">Booking Form Theme</Label>
          <p className="text-xs text-muted-foreground mb-3">Choose the appearance of your public booking form</p>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setLocalSettings(prev => ({ ...prev, booking_form_theme: 'dark' }))}
              className={cn(
                'flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all',
                localSettings.booking_form_theme === 'dark'
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/40'
              )}
            >
              <div className="w-full h-20 rounded-lg bg-gray-900 flex items-center justify-center">
                <Moon className="h-6 w-6 text-gray-300" />
              </div>
              <span className="text-sm font-medium">Dark</span>
            </button>
            <button
              type="button"
              onClick={() => setLocalSettings(prev => ({ ...prev, booking_form_theme: 'light' }))}
              className={cn(
                'flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all',
                localSettings.booking_form_theme === 'light'
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/40'
              )}
            >
              <div className="w-full h-20 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center">
                <Sun className="h-6 w-6 text-amber-500" />
              </div>
              <span className="text-sm font-medium">Light</span>
            </button>
          </div>
        </div>

        {/* Custom Form Colors */}
        <div className="border-t border-border/50 pt-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <Label className="text-sm font-medium flex items-center gap-2">
                <Palette className="h-4 w-4" />
                Custom Form Colors
              </Label>
              <p className="text-xs text-muted-foreground mt-1">Override default theme colors with your brand palette</p>
            </div>
            {hasCustomColors && (
              <Button variant="ghost" size="sm" onClick={resetCustomColors} className="text-xs gap-1">
                <RotateCcw className="h-3 w-3" />
                Reset
              </Button>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3">
            {colorOptions.map((opt) => {
              const currentValue = localSettings[opt.key];
              const placeholder = localSettings.booking_form_theme === 'dark' ? opt.defaultDark : opt.defaultLight;
              return (
                <div key={opt.key} className="flex items-center gap-3 p-3 rounded-lg border bg-secondary/20">
                  <label className="relative shrink-0 cursor-pointer">
                    <div
                      className="w-10 h-10 rounded-lg border border-border"
                      style={{ backgroundColor: currentValue || placeholder }}
                    />
                    <input
                      type="color"
                      value={currentValue || placeholder}
                      onChange={(e) => setLocalSettings(prev => ({ ...prev, [opt.key]: e.target.value }))}
                      className="sr-only"
                    />
                  </label>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{opt.label}</p>
                    <p className="text-xs text-muted-foreground">{opt.description}</p>
                    {currentValue && (
                      <p className="text-xs font-mono text-primary mt-0.5">{currentValue}</p>
                    )}
                  </div>
                  {currentValue && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 shrink-0"
                      onClick={() => setLocalSettings(prev => ({ ...prev, [opt.key]: null }))}
                    >
                      <RotateCcw className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Live Preview */}
          {hasCustomColors && (
            <div className="mt-4 p-4 rounded-xl border" style={{
              backgroundColor: localSettings.form_bg_color || (localSettings.booking_form_theme === 'dark' ? '#0a0f1a' : '#ffffff'),
              color: localSettings.form_text_color || (localSettings.booking_form_theme === 'dark' ? '#f1f5f9' : '#1a1a2e'),
            }}>
              <p className="text-xs font-medium mb-2 opacity-60">Preview</p>
              <div className="p-3 rounded-lg mb-2" style={{
                backgroundColor: localSettings.form_card_color || (localSettings.booking_form_theme === 'dark' ? '#111827' : '#f5f5f5'),
              }}>
                <p className="text-sm font-semibold" style={{ color: localSettings.form_text_color || undefined }}>
                  Sample Card Title
                </p>
                <p className="text-xs mt-1 opacity-70">This is how your form cards will look</p>
              </div>
              <button className="px-4 py-2 rounded-lg text-sm font-medium" style={{
                backgroundColor: localSettings.form_button_color || (localSettings.booking_form_theme === 'dark' ? '#3b82f6' : '#2563eb'),
                color: localSettings.form_button_text_color || '#ffffff',
              }}>
                Continue →
              </button>
            </div>
          )}
        </div>

        <div className="border-t border-border/50" />
        {/* Visibility Toggles */}
        <div className="space-y-4">
          {toggleOptions.map((option) => (
            <div
              key={option.key}
              className="flex items-center justify-between p-4 rounded-lg border bg-secondary/20 hover:bg-secondary/30 transition-colors"
            >
              <div className="space-y-0.5">
                <Label className="text-sm font-medium flex items-center gap-2">
                  {localSettings[option.key] ? (
                    <Eye className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                  )}
                  {option.label}
                </Label>
                <p className="text-xs text-muted-foreground">{option.description}</p>
              </div>
              <Switch
                checked={localSettings[option.key]}
                onCheckedChange={(checked) =>
                  setLocalSettings((prev) => ({ ...prev, [option.key]: checked }))
                }
              />
            </div>
          ))}
        </div>

        {/* Sales Tax Setting */}
        <div className="pt-4 border-t border-border/50">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">Sales Tax %</Label>
              <p className="text-xs text-muted-foreground">
                Applied after discount, shown as separate line item
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={salesTaxDraft}
                onChange={(e) => setSalesTaxDraft(e.target.value)}
                className="w-24 h-10"
              />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
          </div>
        </div>

        <Button onClick={handleSave} disabled={saving} className="w-full">
          {saving ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Save className="h-4 w-4 mr-2" />
          )}
          Save Display Settings
        </Button>
      </CardContent>
    </Card>
  );
}
