import { useState, useEffect, useRef } from 'react';
import { useOrgId } from '@/hooks/useOrgId';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/lib/supabase';
import { saveBlob } from '@/lib/fileActions';
import { AddressAutocomplete } from '@/components/address/AddressAutocomplete';
import { maybeAdoptOrgCountry } from '@/lib/orgCountry';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Upload, FileText, Trash2, Download, Key, Eye, EyeOff, MapPin, Loader2 } from 'lucide-react';
import { StaffDocumentManager } from '@/components/admin/StaffDocumentManager';

import { AdminPayoutStatus } from '@/components/admin/AdminPayoutStatus';

const STAFF_COLOR_OPTIONS = [
  { value: '#3b82f6', label: 'Blue' },
  { value: '#22c55e', label: 'Green' },
  { value: '#8b5cf6', label: 'Purple' },
  { value: '#f59e0b', label: 'Amber' },
  { value: '#ec4899', label: 'Pink' },
  { value: '#14b8a6', label: 'Teal' },
  { value: '#f97316', label: 'Orange' },
  { value: '#ef4444', label: 'Red' },
  { value: '#06b6d4', label: 'Cyan' },
  { value: '#a855f7', label: 'Violet' },
  { value: '#eab308', label: 'Yellow' },
  { value: '#6366f1', label: 'Indigo' },
];

interface StaffMember {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  hourly_rate: number | null;
  percentage_rate?: number | null;
  bio: string | null;
  is_active: boolean;
  tax_classification?: string | null;
  base_wage?: number | null;
  tax_document_url?: string | null;
  ssn_last4?: string | null;
  ein?: string | null;
  user_id?: string | null;
  calendar_color?: string | null;
  default_hours?: number | null;
  home_address?: string | null;
  home_latitude?: number | null;
  home_longitude?: number | null;
}

interface EditStaffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  staff: StaffMember | null;
}

export function EditStaffDialog({ open, onOpenChange, staff }: EditStaffDialogProps) {
  const queryClient = useQueryClient();
  const { organizationId } = useOrgId();
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /**
   * Whether this caller may READ (and therefore safely WRITE) the sensitive
   * tax columns. Proven by get_staff_sensitive_fields succeeding — that RPC is
   * owner-gated (has_org_financial_access). Managers and legacy admins cannot
   * read ssn_last4 / ein / tax_document_url, so writing them back from an
   * empty form would erase real data, or trip the wage-guard trigger and fail
   * the whole edit.
   */
  const [canEditSensitive, setCanEditSensitive] = useState(false);
  
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    hourly_rate: '',
    percentage_rate: '',
    default_hours: '5',
    bio: '',
    is_active: true,
    tax_classification: 'w2' as 'w2' | '1099',
    tax_document_url: '',
    ssn_last4: '',
    ein: '',
    calendar_color: '',
    home_address: '',
    home_latitude: null as number | null,
    home_longitude: null as number | null,
  });

  useEffect(() => {
    if (staff) {
      setFormData({
        name: staff.name,
        email: staff.email,
        phone: staff.phone || '',
        hourly_rate: staff.hourly_rate?.toString() || '',
        percentage_rate: staff.percentage_rate?.toString() || '',
        default_hours: staff.default_hours?.toString() || '5',
        bio: staff.bio || '',
        is_active: staff.is_active,
        tax_classification: (staff.tax_classification as 'w2' | '1099') || 'w2',
        tax_document_url: staff.tax_document_url || '',
        ssn_last4: '',
        ein: '',
        calendar_color: staff.calendar_color || '',
        home_address: staff.home_address || '',
        home_latitude: staff.home_latitude ?? null,
        home_longitude: staff.home_longitude ?? null,
      });

      // Load SSN/EIN via the owner-only RPC (not readable via SELECT).
      // Success here is also what unlocks editing of the tax fields.
      setCanEditSensitive(false);
      (async () => {
        const { data, error } = await supabase.rpc('get_staff_sensitive_fields' as any, {
          _staff_id: staff.id,
        });
        if (error) return;
        setCanEditSensitive(true);
        if (Array.isArray(data) && data[0]) {
          const row = data[0] as { ssn_last4: string | null; ein: string | null };
          setFormData((prev) => ({
            ...prev,
            ssn_last4: row.ssn_last4 || '',
            ein: row.ein || '',
          }));
        }
      })();
    }
  }, [staff]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staff) return;
    
    setIsLoading(true);

    try {
      // Coordinates now come from Google Places when the address is picked
      // from autocomplete — no separate geocoding round-trip. The old
      // fallback went through geocode-address, which is hard-locked to the
      // US and failed silently for every non-US address.
      const latitude = formData.home_latitude;
      const longitude = formData.home_longitude;

      if (formData.home_address && (latitude == null || longitude == null)) {
        toast.warning(
          'Address saved without a map location. Pick an address from the dropdown to enable distance-based assignment.',
        );
      }

      // Only owners send the tax columns. For anyone else they were never
      // loaded, so including them would write NULL over real values (legacy
      // admin) or trip the wage-guard trigger and fail the entire save
      // (manager).
      const updates: Record<string, unknown> = {
        name: formData.name,
        phone: formData.phone || null,
        hourly_rate: formData.hourly_rate ? parseFloat(formData.hourly_rate) : null,
        percentage_rate: formData.percentage_rate ? parseFloat(formData.percentage_rate) : null,
        default_hours: formData.default_hours ? parseFloat(formData.default_hours) : 5,
        bio: formData.bio || null,
        is_active: formData.is_active,
        tax_classification: formData.tax_classification,
        calendar_color: formData.calendar_color || null,
        home_address: formData.home_address || null,
        home_latitude: latitude,
        home_longitude: longitude,
      };
      if (canEditSensitive) {
        updates.tax_document_url = formData.tax_document_url || null;
        updates.ssn_last4 = formData.ssn_last4 || null;
        updates.ein = formData.ein || null;
      }

      const { error } = await supabase
        .from('staff')
        .update(updates)
        .eq('id', staff.id);

      if (error) throw error;

      // This line was already here and already looked right, but matched only
      // ['staff', orgId] — never ['staff-all', orgId] — so editing a staff
      // member left StaffPage's list stale exactly the way adding one did. The
      // shared prefix makes it reach both without a second call.
      queryClient.invalidateQueries({ queryKey: ['staff'] });
      toast.success('Staff member updated');
      onOpenChange(false);
    } catch (error) {
      console.error('Error updating staff:', error);
      toast.error('Failed to update staff member');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !staff) return;

    // Validate file type
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
    if (!allowedTypes.includes(file.type)) {
      toast.error('Please upload a PDF, JPG, or PNG file');
      return;
    }

    // Max 10MB
    if (file.size > 10 * 1024 * 1024) {
      toast.error('File must be less than 10MB');
      return;
    }

    setIsUploading(true);

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${staff.id}/${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('tax-documents')
        .upload(fileName, file, { upsert: true });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('tax-documents')
        .getPublicUrl(fileName);

      setFormData({ ...formData, tax_document_url: fileName });
      toast.success('Tax document uploaded');
    } catch (error) {
      console.error('Error uploading file:', error);
      toast.error('Failed to upload tax document');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDeleteDocument = async () => {
    if (!formData.tax_document_url) return;

    try {
      const { error } = await supabase.storage
        .from('tax-documents')
        .remove([formData.tax_document_url]);

      if (error) throw error;

      setFormData({ ...formData, tax_document_url: '' });
      toast.success('Tax document deleted');
    } catch (error) {
      console.error('Error deleting document:', error);
      toast.error('Failed to delete tax document');
    }
  };

  const handleDownloadDocument = async () => {
    if (!formData.tax_document_url) return;

    try {
      const { data, error } = await supabase.storage
        .from('tax-documents')
        .download(formData.tax_document_url);

      if (error) throw error;

      await saveBlob(data, formData.tax_document_url.split('/').pop() || 'tax-document');
    } catch (error) {
      console.error('Error downloading document:', error);
      toast.error('Failed to download tax document');
    }
  };

  const handleResetPassword = async () => {
    if (!staff?.user_id || !newPassword) return;
    
    if (newPassword.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }

    setIsResettingPassword(true);

    try {
      const { data, error } = await supabase.functions.invoke('reset-staff-password', {
        body: { userId: staff.user_id, newPassword, organizationId }
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast.success('Password reset successfully');
      setNewPassword('');
    } catch (error: any) {
      console.error('Error resetting password:', error);
      toast.error(error.message || 'Failed to reset password');
    } finally {
      setIsResettingPassword(false);
    }
  };

  const taxDocLabel = formData.tax_classification === 'w2' ? 'W-4 Form' : 'W-9 Form';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Staff Member</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-name">Full Name *</Label>
            <Input
              id="edit-name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="John Smith"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-email">Email</Label>
            <Input
              id="edit-email"
              type="email"
              value={formData.email}
              disabled
              className="bg-muted"
            />
            <p className="text-xs text-muted-foreground">Email cannot be changed</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-phone">Phone</Label>
            <Input
              id="edit-phone"
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              placeholder="(555) 123-4567"
            />
          </div>

          <div className="space-y-2">
            <Label>Calendar Color</Label>
            <div className="flex flex-wrap gap-2">
              {STAFF_COLOR_OPTIONS.map((color) => (
                <button
                  key={color.value}
                  type="button"
                  className={`w-8 h-8 rounded-full border-2 transition-all ${
                    formData.calendar_color === color.value 
                      ? 'border-foreground scale-110' 
                      : 'border-transparent hover:scale-105'
                  }`}
                  style={{ backgroundColor: color.value }}
                  onClick={() => setFormData({ ...formData, calendar_color: color.value })}
                  title={color.label}
                />
              ))}
              {formData.calendar_color && (
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground underline ml-2"
                  onClick={() => setFormData({ ...formData, calendar_color: '' })}
                >
                  Clear
                </button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">Used for calendar bookings</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-tax_classification">Tax Classification</Label>
            <Select
              value={formData.tax_classification}
              onValueChange={(value: 'w2' | '1099') => setFormData({ ...formData, tax_classification: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="w2">W-2 (Employee)</SelectItem>
                <SelectItem value="1099">1099 (Independent Contractor)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-hourly_rate">Hourly Rate ($)</Label>
              <Input
                id="edit-hourly_rate"
                type="number"
                step="0.01"
                min="0"
                value={formData.hourly_rate}
                onChange={(e) => setFormData({ ...formData, hourly_rate: e.target.value, percentage_rate: '' })}
                placeholder="25.00"
                disabled={!!formData.percentage_rate}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-percentage_rate">Percentage (%)</Label>
              <Input
                id="edit-percentage_rate"
                type="number"
                step="0.1"
                min="0"
                max="100"
                value={formData.percentage_rate}
                onChange={(e) => setFormData({ ...formData, percentage_rate: e.target.value, hourly_rate: '' })}
                placeholder="50"
                disabled={!!formData.hourly_rate}
              />
              <p className="text-xs text-muted-foreground">% of job total</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-default_hours">Default Hours Per Job</Label>
            <Input
              id="edit-default_hours"
              type="number"
              step="0.5"
              min="0.5"
              max="24"
              value={formData.default_hours}
              onChange={(e) => setFormData({ ...formData, default_hours: e.target.value })}
              placeholder="5"
            />
            <p className="text-xs text-muted-foreground">Used for pay calculations when not using check-in/out times</p>
          </div>

          {/* SSN / EIN / tax document — owner-only.
              These columns are not readable by managers or legacy admins
              (column-level grants), so for them the inputs would render blank
              and saving would wipe the real values. Hide the whole block
              unless the sensitive-fields RPC succeeded. */}
          {canEditSensitive && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-ssn_last4">SSN (Last 4 digits)</Label>
                  <Input
                    id="edit-ssn_last4"
                    value={formData.ssn_last4}
                    onChange={(e) => setFormData({ ...formData, ssn_last4: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                    placeholder="1234"
                    maxLength={4}
                  />
                  <p className="text-xs text-muted-foreground">For 1099-NEC filing</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-ein">EIN (if applicable)</Label>
                  <Input
                    id="edit-ein"
                    value={formData.ein}
                    onChange={(e) => setFormData({ ...formData, ein: e.target.value })}
                    placeholder="XX-XXXXXXX"
                  />
                  <p className="text-xs text-muted-foreground">For contractors with EIN</p>
                </div>
              </div>

              {/* Tax Document Upload */}
              <div className="space-y-2">
                <Label>{taxDocLabel} (Tax Document)</Label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                {formData.tax_document_url ? (
                  <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
                    <FileText className="w-5 h-5 text-primary" />
                    <span className="flex-1 text-sm truncate">
                      {formData.tax_document_url.split('/').pop()}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={handleDownloadDocument}
                    >
                      <Download className="w-4 h-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="text-destructive"
                      onClick={handleDeleteDocument}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full gap-2"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                  >
                    <Upload className="w-4 h-4" />
                    {isUploading ? 'Uploading...' : `Upload ${taxDocLabel}`}
                  </Button>
                )}
                <p className="text-xs text-muted-foreground">PDF, JPG, or PNG. Max 10MB. Owner-only access.</p>
              </div>
            </>
          )}


          {/* Home Address */}
          <div className="space-y-2">
            <Label htmlFor="edit-home_address" className="flex items-center gap-2">
              <MapPin className="w-4 h-4" />
              Home Address
            </Label>
            <AddressAutocomplete
              id="edit-home_address"
              value={formData.home_address}
              onChange={(v) =>
                setFormData({
                  ...formData,
                  home_address: v,
                  // Clear existing coordinates so we never keep an old geotag for a new address
                  home_latitude: null,
                  home_longitude: null,
                })
              }
              onResolved={(r) => {
                const full = [r.street, r.city, [r.state, r.zip].filter(Boolean).join(' ')]
                  .filter(Boolean)
                  .join(', ');
                setFormData((prev) => ({
                  ...prev,
                  home_address: full || prev.home_address,
                  home_latitude: r.lat,
                  home_longitude: r.lng,
                }));
                // Staff live in the market the business operates in, so this
                // is a safe country signal. Customer addresses are not.
                void maybeAdoptOrgCountry(organizationId, r.country);
              }}
              placeholder="Start typing an address..."
            />
            <p className="text-xs text-muted-foreground">
              Used for distance calculations when assigning jobs
              {formData.home_latitude && formData.home_longitude ? (
                <span className="text-primary ml-1">✓ Location saved ({formData.home_latitude.toFixed(2)}, {formData.home_longitude.toFixed(2)})</span>
              ) : formData.home_address ? (
                <span className="text-muted-foreground ml-1 font-medium">⚠ Pick a suggestion to save the location</span>
              ) : null}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-bio">Bio</Label>
            <Textarea
              id="edit-bio"
              value={formData.bio}
              onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
              placeholder="Brief description..."
              rows={3}
            />
          </div>

          {/* Staff Documents Section */}
          <div className="space-y-2 pt-4 border-t">
            <Label className="flex items-center gap-2">
              <FileText className="w-4 h-4" />
              Uploaded Documents
            </Label>
            {staff && (
              <StaffDocumentManager staffId={staff.id} staffName={staff.name} />
            )}
          </div>


          {/* Payout Status Section */}
          <div className="space-y-2 pt-4 border-t">
            {staff && <AdminPayoutStatus staffId={staff.id} staffName={staff.name} />}
          </div>

          {/* Password Reset Section */}
          <div className="space-y-2 pt-4 border-t">
            <Label className="flex items-center gap-2">
              <Key className="w-4 h-4" />
              Reset Password
            </Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Enter new password"
                  minLength={6}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={handleResetPassword}
                disabled={isResettingPassword || !newPassword || newPassword.length < 8}
              >
                {isResettingPassword ? 'Resetting...' : 'Reset'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Minimum 6 characters. Give these credentials to the staff member.</p>
          </div>

          <div className="flex items-center justify-between">
            <Label htmlFor="edit-active">Active Status</Label>
            <Switch
              id="edit-active"
              checked={formData.is_active}
              onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
