import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, Check, Eye, EyeOff } from 'lucide-react';
import { useOrganization } from '@/contexts/OrganizationContext';

interface AddStaffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddStaffDialog({ open, onOpenChange }: AddStaffDialogProps) {
  const queryClient = useQueryClient();
  const { organization } = useOrganization();
  const [isLoading, setIsLoading] = useState(false);
  const [showCredentials, setShowCredentials] = useState(false);
  const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    hourly_rate: '',
    percentage_rate: '',
    default_hours: '5',
    tax_classification: 'w2' as 'w2' | '1099',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session?.access_token) {
        toast.error('You must be logged in to add staff');
        return;
      }

      const formEl = e.currentTarget as HTMLFormElement;
      const typedPassword = (formEl.querySelector<HTMLInputElement>('#password')?.value || formData.password || '').trim();
      if (typedPassword !== formData.password) {
        setFormData((prev) => ({ ...prev, password: typedPassword }));
      }
      if (typedPassword.length < 6) {
        toast.error('Password must be at least 6 characters');
        setIsLoading(false);
        return;
      }

      const response = await supabase.functions.invoke('invite-staff', {
        body: {
          organizationId: organization?.id,
          email: formData.email,
          name: formData.name,
          phone: formData.phone || undefined,
          password: typedPassword,
          hourly_rate: formData.hourly_rate ? parseFloat(formData.hourly_rate) : undefined,
          percentage_rate: formData.percentage_rate ? parseFloat(formData.percentage_rate) : undefined,
          default_hours: formData.default_hours ? parseFloat(formData.default_hours) : 5,
          tax_classification: formData.tax_classification,
        },
      });

      if (response.error) {
        // Handle common error scenarios with user-friendly messages
        const errorMsg = response.error.message?.toLowerCase() || '';
        if (errorMsg.includes('already registered') || errorMsg.includes('already exists')) {
          throw new Error('This email is already registered. Please try a different email.');
        } else if (errorMsg.includes('admin access')) {
          throw new Error('You need admin permissions to add staff members.');
        } else if (errorMsg.includes('organization')) {
          throw new Error('Unable to find your organization. Please refresh and try again.');
        }
        throw new Error(response.error.message || 'Failed to create staff member');
      }

      const data = response.data;
      
      if (data.error) {
        // Handle common error scenarios with user-friendly messages
        const errorMsg = data.error.toLowerCase();
        if (errorMsg.includes('already registered') || errorMsg.includes('already exists')) {
          throw new Error('This email is already registered. Please try a different email.');
        } else if (errorMsg.includes('admin')) {
          throw new Error('You need admin permissions to add staff members.');
        }
        throw new Error(data.error);
      }

      // One call now covers both staff queries. They live under a shared prefix
      // — ['staff','active',orgId] and ['staff','all',orgId] — so ['staff']
      // genuinely matches both. This needed two calls while the keys were
      // ['staff'] and ['staff-all'], because react-query prefix-matches on array
      // elements and those are different strings; the version with only the
      // first refreshed nothing on StaffPage, which renders useAllStaff().
      queryClient.invalidateQueries({ queryKey: ['staff'] });

      if (data.alreadyExists) {
        toast.success('This staff member is already active in your organization.');
        handleCredentialsDone();
      } else if (data.existingAccount) {
        toast.success('Staff member added. They can use their existing TidyWise login.');
        handleCredentialsDone();
      } else if (data.reactivated) {
        // Reactivation does NOT rewrite the auth password, so showing the
        // typed password here would hand the admin credentials that cannot
        // sign in.
        toast.info('They keep their existing TidyWise password.');
        handleCredentialsDone();
      } else {
        // Only show a temporary password when this request created the login.
        setCredentials({
          email: formData.email,
          password: typedPassword,
        });
        setShowCredentials(true);
      }

      if (data.reactivated) {
        toast.success('Staff member reactivated successfully!');
      } else if (!data.alreadyExists && !data.existingAccount) {
        toast.success('Staff member created successfully!');
      }
      
    } catch (error) {
      console.error('Error creating staff:', error);
      const message = error instanceof Error ? error.message : 'Failed to create staff member';
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    if (!showCredentials) {
      setFormData({ name: '', email: '', phone: '', password: '', hourly_rate: '', percentage_rate: '', default_hours: '5', tax_classification: 'w2' });
    }
    onOpenChange(false);
  };

  const handleCredentialsDone = () => {
    setShowCredentials(false);
    setCredentials(null);
    setCopied(false);
    setFormData({ name: '', email: '', phone: '', password: '', hourly_rate: '', percentage_rate: '', default_hours: '5', tax_classification: 'w2' });
    onOpenChange(false);
  };

  const copyCredentials = () => {
    if (credentials) {
      const text = `Email: ${credentials.email}\nPassword: ${credentials.password}`;
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (showCredentials && credentials) {
    return (
      <Dialog open={open} onOpenChange={() => {}}>
        <DialogContent onPointerDownOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>Staff Member Created</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 dark:bg-green-950 dark:border-green-800">
              <p className="text-sm text-green-800 dark:text-green-200 font-medium">
                Share these login credentials with the staff member
              </p>
            </div>
            <div className="bg-muted p-4 rounded-lg space-y-3">
              <div>
                <Label className="text-xs text-muted-foreground">Email</Label>
                <p className="font-mono text-sm">{credentials.email}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Password</Label>
                <p className="font-mono text-sm">{credentials.password}</p>
              </div>
            </div>
            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={copyCredentials}
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copied ? 'Copied!' : 'Copy Credentials'}
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              Staff can log in at the staff portal with these credentials.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={handleCredentialsDone}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Staff Member</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="name">Full Name *</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="John Smith"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email *</Label>
            <Input
              id="email"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              placeholder="john@example.com"
              required
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password *</Label>
              <Button
                type="button"
                variant="link"
                className="h-auto p-0 text-xs"
                onClick={() => {
                  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
                  const bytes = new Uint8Array(10);
                  crypto.getRandomValues(bytes);
                  let generated = 'Tw';
                  for (const b of bytes) generated += alphabet[b % alphabet.length];
                  generated += '7';
                  setFormData((prev) => ({ ...prev, password: generated }));
                  setShowPassword(true);
                }}
              >
                Generate password
              </Button>
            </div>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                placeholder="Enter password (min 6 characters)"
                autoComplete="new-password"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">This will be the staff member's login password</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">Phone</Label>
            <Input
              id="phone"
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              placeholder="(555) 123-4567"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tax_classification">Tax Classification *</Label>
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
              <Label htmlFor="hourly_rate">Hourly Rate ($)</Label>
              <Input
                id="hourly_rate"
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
              <Label htmlFor="percentage_rate">Percentage (%)</Label>
              <Input
                id="percentage_rate"
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
            <Label htmlFor="default_hours">Default Hours Per Job</Label>
            <Input
              id="default_hours"
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

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Creating...' : 'Create Staff Member'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}