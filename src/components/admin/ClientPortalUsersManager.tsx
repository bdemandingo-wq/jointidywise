import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { 
  Users, 
  Plus, 
  Search, 
  Key, 
  Copy, 
  Check,
  Loader2,
  Eye,
  EyeOff,
  Trash2,
  MoreHorizontal,
  RefreshCw
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import { supabase } from '@/lib/supabase';
import { readEdgeFunctionError } from '@/lib/edgeFunctionError';
import { QueryError } from '@/components/QueryError';
import { useOrganization } from '@/contexts/OrganizationContext';

interface ClientPortalUser {
  id: string;
  username: string;
  customer_id: string;
  is_active: boolean;
  must_change_password: boolean;
  last_login_at: string | null;
  created_at: string;
  customer: {
    first_name: string;
    last_name: string;
    email: string;
  } | null;
}

interface Customer {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
}

export function ClientPortalUsersManager() {
  const { organization } = useOrganization();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [resetPasswordDialogOpen, setResetPasswordDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<ClientPortalUser | null>(null);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [generatedPassword, setGeneratedPassword] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [showResetPassword, setShowResetPassword] = useState(false);

  // Fetch portal users
  const { data: portalUsers = [], isLoading, error: portalUsersError } = useQuery({
    queryKey: ['client-portal-users', organization?.id],
    queryFn: async () => {
      if (!organization?.id) return [];
      const { data, error } = await supabase
        .from('client_portal_users')
        .select(`
          id, 
          username, 
          customer_id, 
          is_active, 
          must_change_password, 
          last_login_at, 
          created_at,
          customer:customers(first_name, last_name, email)
        `)
        .eq('organization_id', organization.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []) as ClientPortalUser[];
    },
    enabled: !!organization?.id,
  });

  // Fetch customers without portal access
  const { data: customersWithoutAccess = [], error: customersWithoutAccessError } = useQuery({
    queryKey: ['customers-without-portal', organization?.id, portalUsers],
    queryFn: async () => {
      if (!organization?.id) return [];
      
      const existingCustomerIds = portalUsers.map(u => u.customer_id);
      
      let query = supabase
        .from('customers')
        .select('id, first_name, last_name, email')
        .eq('organization_id', organization.id)
        .order('first_name');
      
      if (existingCustomerIds.length > 0) {
        query = query.not('id', 'in', `(${existingCustomerIds.join(',')})`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as Customer[];
    },
    enabled: !!organization?.id,
  });

  const filteredCustomers = customersWithoutAccess.filter((c) => {
    const q = customerSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      `${c.first_name} ${c.last_name}`.toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q)
    );
  }).slice(0, 50);

  // Create portal user mutation - uses secure RPC to avoid exposing password_hash
  const createUser = useMutation({
    mutationFn: async ({ username, password, customerId }: { username: string; password: string; customerId: string }) => {
      const { data, error } = await supabase.rpc('create_client_portal_user' as any, {
        p_username: username,
        p_password: password,
        p_customer_id: customerId,
        p_organization_id: organization?.id,
        p_must_change_password: false,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-portal-users'] });
      queryClient.invalidateQueries({ queryKey: ['customers-without-portal'] });
      toast.success('Portal user created!');
      setAddDialogOpen(false);
      resetForm();
    },
    onError: (error: any) => {
      if (error.code === '23505') {
        toast.error('That email already has portal access');
      } else {
        toast.error(error.message || 'Failed to create user');
      }
    },
  });

  // Delete portal user mutation
  const deleteUser = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase
        .from('client_portal_users')
        .delete()
        .eq('id', userId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-portal-users'] });
      queryClient.invalidateQueries({ queryKey: ['customers-without-portal'] });
      toast.success('Portal access removed');
      setDeleteDialogOpen(false);
      setSelectedUser(null);
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to remove access');
    },
  });

  // Toggle active status mutation
  const toggleActive = useMutation({
    mutationFn: async ({ userId, isActive }: { userId: string; isActive: boolean }) => {
      const { error } = await supabase
        .from('client_portal_users')
        .update({ is_active: isActive })
        .eq('id', userId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-portal-users'] });
      toast.success('User status updated');
    },
  });

  // Reset password mutation
  //
  // Goes through the admin-reset-portal-password edge function, not the RPC
  // directly. reset_client_portal_password has no authorization of its own —
  // no auth.uid(), no org scoping — so it stays revoked and service-role only.
  // The edge function resolves which organisation owns the portal user from
  // the portal user id server-side, then checks the caller is an admin of THAT
  // organisation. Passing an org id from here would defeat the check: an admin
  // of one org could name their own org alongside another org's portal user.
  const resetPasswordMutation = useMutation({
    mutationFn: async ({ userId, newPassword }: { userId: string; newPassword: string }) => {
      const { data, error } = await supabase.functions.invoke('admin-reset-portal-password', {
        body: { portalUserId: userId, newPassword },
      });
      // The function distinguishes "not found" from "not your organisation"
      // from "password too short". Read the body so those survive instead of
      // collapsing into supabase-js's generic non-2xx string.
      //
      // Note: on a non-2xx, supabase-js sets `data` to null and leaves the body
      // unread on error.context. Reading `data?.error` on the error path (as an
      // earlier version did) therefore always yields undefined and falls back to
      // the generic wrapper.
      if (error) throw new Error(await readEdgeFunctionError(error, 'Failed to reset password'));
      if (data && (data as { success?: boolean }).success === false) {
        throw new Error(String((data as { error?: string }).error ?? 'Failed to reset password'));
      }
      return data;
    },

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-portal-users'] });
      toast.success('Password reset successfully! User will be prompted to change it on next login.');
      setResetPasswordDialogOpen(false);
      setResetPassword('');
      setShowResetPassword(false);
      setSelectedUser(null);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to reset password');
    },
  });

  const resetForm = () => {
    setNewUsername('');
    setNewPassword('');
    setSelectedCustomerId('');
    setGeneratedPassword('');
    setShowPassword(false);
  };

  const generateResetPassword = () => {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < 12; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setResetPassword(password);
  };

  const handleResetPassword = () => {
    if (!selectedUser || !resetPassword || resetPassword.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }
    resetPasswordMutation.mutate({
      userId: selectedUser.id,
      newPassword: resetPassword,
    });
  };

  const generatePassword = () => {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < 12; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setNewPassword(password);
    setGeneratedPassword(password);
  };

  const copyToClipboard = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    toast.success('Copied to clipboard');
  };

  const handleCreateUser = () => {
    const email = newUsername.trim().toLowerCase();
    if (!email) {
      toast.error('Email is required');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error('Enter the email address this customer will use to sign in.');
      return;
    }
    if (!newPassword.trim() || newPassword.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }
    if (!selectedCustomerId) {
      toast.error('Please select a customer');
      return;
    }

    createUser.mutate({
      username: email,
      password: newPassword,
      customerId: selectedCustomerId,
    });
  };

  const filteredUsers = portalUsers.filter((user) => {
    const customerName = `${user.customer?.first_name || ''} ${user.customer?.last_name || ''}`.toLowerCase();
    const search = searchTerm.toLowerCase();
    return (
      user.username.toLowerCase().includes(search) ||
      customerName.includes(search) ||
      user.customer?.email?.toLowerCase().includes(search)
    );
  });

  if (portalUsersError) return <QueryError subject="portal users" onRetry={() => queryClient.invalidateQueries({ queryKey: ['client-portal-users', organization?.id] })} />;
  if (customersWithoutAccessError) return <QueryError subject="customers without portal access" onRetry={() => queryClient.invalidateQueries({ queryKey: ['customers-without-portal', organization?.id] })} />;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            <div>
              <CardTitle>Client Portal Users</CardTitle>
              <CardDescription>
                Manage customer logins for the client portal
              </CardDescription>
            </div>
          </div>
          <Button onClick={() => setAddDialogOpen(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            Add User
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Search */}
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search users..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Users className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p>No portal users yet</p>
            <Button variant="link" onClick={() => setAddDialogOpen(true)}>
              Create the first one
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Login</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredUsers.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium">{user.username}</TableCell>
                  <TableCell>
                    <div>
                      <p>{user.customer?.first_name} {user.customer?.last_name}</p>
                      <p className="text-sm text-muted-foreground">{user.customer?.email}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={user.is_active ? 'default' : 'secondary'}>
                      {user.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {user.last_login_at
                      ? format(new Date(user.last_login_at), 'MMM d, yyyy')
                      : 'Never'}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => toggleActive.mutate({ userId: user.id, isActive: !user.is_active })}
                        >
                          {user.is_active ? 'Deactivate' : 'Activate'}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => {
                            setSelectedUser(user);
                            setResetPassword('');
                            setShowResetPassword(false);
                            setResetPasswordDialogOpen(true);
                          }}
                        >
                          <RefreshCw className="h-4 w-4 mr-2" />
                          Reset Password
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => {
                            setSelectedUser(user);
                            setDeleteDialogOpen(true);
                          }}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Remove Access
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* Add User Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={(open) => { setAddDialogOpen(open); if (!open) resetForm(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Portal User</DialogTitle>
            <DialogDescription>
              Give a customer access to the client portal.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Customer</Label>
              {/* Type-to-search picker — the old dropdown was unusable with a
                  long customer list on mobile. */}
              <Input
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                placeholder="Type a name, email, or phone to search…"
              />
              <div className="max-h-44 overflow-y-auto rounded-md border divide-y">
                {filteredCustomers.length === 0 ? (
                  <p className="p-3 text-sm text-muted-foreground">No customers match "{customerSearch}"</p>
                ) : (
                  filteredCustomers.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setSelectedCustomerId(c.id);
                        if (c.email) setNewUsername(c.email);
                      }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/60 ${selectedCustomerId === c.id ? 'bg-primary/10 font-medium' : ''}`}
                    >
                      {c.first_name} {c.last_name}
                      <span className="block text-xs text-muted-foreground truncate">{c.email}</span>
                    </button>
                  ))
                )}
              </div>
              {customersWithoutAccess.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  All customers already have portal access
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                autoComplete="off"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="customer@email.com"
              />
              <p className="text-xs text-muted-foreground">
                This is what they type on the client portal login screen.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Password</Label>
                <Button type="button" variant="ghost" size="sm" onClick={generatePassword}>
                  <Key className="h-4 w-4 mr-1" />
                  Generate
                </Button>
              </div>
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Eye className="h-4 w-4 text-muted-foreground" />
                  )}
                </Button>
              </div>
              {generatedPassword && (
                <div className="flex items-center gap-2 p-2 bg-muted rounded-md">
                  <code className="flex-1 text-sm">{generatedPassword}</code>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => copyToClipboard(generatedPassword, 'password')}
                  >
                    {copiedId === 'password' ? (
                      <Check className="h-4 w-4 text-primary" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateUser} disabled={createUser.isPending}>
              {createUser.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create User
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Portal Access</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove portal access for{' '}
              <strong>{selectedUser?.customer?.first_name} {selectedUser?.customer?.last_name}</strong>?
              They will no longer be able to log in.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedUser && deleteUser.mutate(selectedUser.id)}
              className="bg-destructive hover:bg-destructive/90"
            >
              Remove Access
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reset Password Dialog */}
      <Dialog open={resetPasswordDialogOpen} onOpenChange={(open) => {
        setResetPasswordDialogOpen(open);
        if (!open) {
          setResetPassword('');
          setShowResetPassword(false);
          setSelectedUser(null);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset User Password</DialogTitle>
            <DialogDescription>
              Set a new password for{' '}
              <strong>{selectedUser?.customer?.first_name} {selectedUser?.customer?.last_name}</strong>.
              They will be required to change it on their next login.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>New Password</Label>
                <Button type="button" variant="ghost" size="sm" onClick={generateResetPassword}>
                  <Key className="h-4 w-4 mr-1" />
                  Generate
                </Button>
              </div>
              <div className="relative">
                <Input
                  type={showResetPassword ? 'text' : 'password'}
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  placeholder="••••••••"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                  onClick={() => setShowResetPassword((v) => !v)}
                >
                  {showResetPassword ? (
                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Eye className="h-4 w-4 text-muted-foreground" />
                  )}
                </Button>
              </div>
              {resetPassword && (
                <div className="flex items-center gap-2 p-2 bg-muted rounded-md">
                  <code className="flex-1 text-sm">{resetPassword}</code>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => copyToClipboard(resetPassword, 'reset-password')}
                  >
                    {copiedId === 'reset-password' ? (
                      <Check className="h-4 w-4 text-primary" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setResetPasswordDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleResetPassword} disabled={resetPasswordMutation.isPending}>
              {resetPasswordMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Reset Password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
