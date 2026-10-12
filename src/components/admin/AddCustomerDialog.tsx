import { useState } from 'react';
import { AddressAutocomplete } from '@/components/address/AddressAutocomplete';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { PERSON_NAME_MAX } from '@/lib/displayName';
import { Loader2, User, Mail, Phone, Lock } from 'lucide-react';
import { useCreateCustomer, useCustomers } from '@/hooks/useBookings';
import { validateOptionalState, validateOptionalZip } from '@/lib/validation';
import { useSubscription } from '@/hooks/useSubscription';
import { useAuth } from '@/hooks/useAuth';

interface AddCustomerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddCustomerDialog({ open, onOpenChange }: AddCustomerDialogProps) {
  const createCustomer = useCreateCustomer();
  const { data: customers } = useCustomers();
  const { maxCustomers, hasFullAccess } = useSubscription();
  const { setShowSubscriptionDialog } = useAuth();
  const customerCount = customers?.length ?? 0;
  const atLimit = customerCount >= maxCustomers;
  
  const [formData, setFormData] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    state: '',
    zip_code: '',
    latitude: null as number | null,
    longitude: null as number | null,
    notes: '',
  });
  
  const [submitting, setSubmitting] = useState(false);

  const resetForm = () => {
    setFormData({
      first_name: '',
      last_name: '',
      email: '',
      phone: '',
      address: '',
      city: '',
      state: '',
      zip_code: '',
      latitude: null,
      longitude: null,
      notes: '',
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (atLimit) {
      toast.error(`Basic plan is limited to ${maxCustomers} customers. Upgrade to add more.`);
      setShowSubscriptionDialog(true);
      return;
    }
    
    if (!formData.first_name || !formData.last_name || !formData.email) {
      toast.error('Please fill in first name, last name, and email');
      return;
    }
    const stateError = validateOptionalState(formData.state);
    const zipError = validateOptionalZip(formData.zip_code);
    if (stateError || zipError) {
      toast.error(stateError || zipError || 'Check the address');
      return;
    }

    setSubmitting(true);

    try {
      await createCustomer.mutateAsync({
        first_name: formData.first_name,
        last_name: formData.last_name,
        email: formData.email,
        phone: formData.phone || undefined,
        address: formData.address || undefined,
        city: formData.city || undefined,
        state: formData.state.trim() ? formData.state.trim().toUpperCase() : undefined,
        zip_code: formData.zip_code.trim() || undefined,
        latitude: formData.latitude ?? undefined,
        longitude: formData.longitude ?? undefined,
      });

      resetForm();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error creating customer:', error);
      toast.error(error.message || 'Failed to create customer');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="w-5 h-5" />
            Add New Customer
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="first_name">First Name *</Label>
              <Input
                id="first_name"
                value={formData.first_name}
                maxLength={PERSON_NAME_MAX}
                onChange={(e) => setFormData(prev => ({ ...prev, first_name: e.target.value }))}
                placeholder="John"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="last_name">Last Name *</Label>
              <Input
                id="last_name"
                value={formData.last_name}
                maxLength={PERSON_NAME_MAX}
                onChange={(e) => setFormData(prev => ({ ...prev, last_name: e.target.value }))}
                placeholder="Doe"
              />
            </div>
          </div>

          {/* Contact */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="flex items-center gap-1">
                <Mail className="w-3.5 h-3.5" /> Email *
              </Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                placeholder="john@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone" className="flex items-center gap-1">
                <Phone className="w-3.5 h-3.5" /> Phone
              </Label>
              <Input
                id="phone"
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                placeholder="(555) 123-4567"
              />
            </div>
          </div>

          {/* Address */}
          <div className="space-y-2">
            <Label htmlFor="address">Street Address</Label>
            <AddressAutocomplete
              id="address"
              value={formData.address}
              onChange={(v) => setFormData(prev => ({ ...prev, address: v, latitude: null, longitude: null }))}
              onResolved={(r) => setFormData(prev => ({
                ...prev,
                city: r.city || prev.city,
                state: r.state || prev.state,
                zip_code: r.zip || prev.zip_code,
                latitude: r.lat,
                longitude: r.lng,
              }))}
              placeholder="123 Main St"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                value={formData.city}
                onChange={(e) => setFormData(prev => ({ ...prev, city: e.target.value }))}
                placeholder="City"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="state">State</Label>
              <Input
                id="state"
                value={formData.state}
                onChange={(e) => setFormData(prev => ({ ...prev, state: e.target.value }))}
                placeholder="State"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="zip_code">ZIP Code</Label>
              <Input
                id="zip_code"
                value={formData.zip_code}
                onChange={(e) => setFormData(prev => ({ ...prev, zip_code: e.target.value }))}
                placeholder="12345"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Add Customer
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
