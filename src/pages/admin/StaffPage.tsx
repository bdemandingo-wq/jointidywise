import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { useAllStaff } from '@/hooks/useBookings';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Search, Plus, MoreHorizontal, Mail, Phone, Edit, Trash2, Calendar, KeyRound, Copy, Check, Users, FileText, Bell, MapPin, CalendarOff } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { TimeOffRequestsPanel } from '@/components/admin/TimeOffRequestsPanel';
import { useOrgRole } from '@/hooks/useOrgRole';


import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import { AddStaffDialog } from '@/components/admin/AddStaffDialog';
import { EditStaffDialog } from '@/components/admin/EditStaffDialog';
import { supabase } from '@/lib/supabase';
import { readEdgeFunctionError } from '@/lib/edgeFunctionError';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useTestMode } from '@/contexts/TestModeContext';
import { CleanerCalendar } from '@/components/staff/CleanerCalendar';
import { useOrgId } from '@/hooks/useOrgId';
import { cn } from '@/lib/utils';
import { StaffEventNotifications } from '@/components/admin/StaffEventNotifications';
import { StaffComplianceDashboard } from '@/components/admin/StaffComplianceDashboard';
import { AdminSignableDocManager } from '@/components/admin/AdminSignableDocManager';
import { PendingDocumentsReview } from '@/components/admin/PendingDocumentsReview';
import { SEOHead } from '@/components/SEOHead';
import { AttentionStrip } from '@/components/admin/AttentionStrip';
import { usePageBadgeReasons } from '@/hooks/useSidebarBadges';
import { useOrgStaffWages } from '@/hooks/useOrgStaffWages';

interface StaffMember {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  hourly_rate: number | null;
  bio: string | null;
  is_active: boolean;
  tax_classification?: string | null;
  base_wage?: number | null;
  default_hours?: number | null;
}

type StatusFilter = 'all' | 'active' | 'inactive';

export default function StaffPage() {
  const { hasFinancialAccess } = useOrgRole();
  const [searchTerm, setSearchTerm] = useState('');

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'team';
  const [activeTab, setActiveTab] = useState(initialTab);
  useEffect(() => {
    const t = searchParams.get('tab');
    if (t && t !== activeTab) setActiveTab(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  const handleTabChange = (v: string) => {
    setActiveTab(v);
    const next = new URLSearchParams(searchParams);
    if (v === 'team') next.delete('tab'); else next.set('tab', v);
    setSearchParams(next, { replace: true });
  };
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState<StaffMember | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [permanentDeleteDialogOpen, setPermanentDeleteDialogOpen] = useState(false);
  const [staffToDelete, setStaffToDelete] = useState<StaffMember | null>(null);
  const [resendLinkDialogOpen, setResendLinkDialogOpen] = useState(false);
  // `link` is absent for a cleaner who works for more than one business. The
  // function emails the link to them directly in that case rather than handing
  // it to an admin, because a recovery link authenticates the whole account —
  // including the other business's staff portal. See resend-staff-password-link.
  const [resendLinkData, setResendLinkData] = useState<
    { name: string; email: string; link: string; maskedEmail?: undefined }
    | { name: string; email?: undefined; link?: undefined; maskedEmail: string }
    | null
  >(null);
  const [isResendingLink, setIsResendingLink] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isDeletingPermanently, setIsDeletingPermanently] = useState(false);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  
  const { data: staff = [], isLoading } = useAllStaff();
  // base_wage is owner-only and no longer part of the staff row (see
  // src/lib/staffColumns.ts); owners read it through this RPC-backed hook.
  const { wagesById } = useOrgStaffWages();
  const queryClient = useQueryClient();
  const { isTestMode, maskName, maskEmail, maskPhone } = useTestMode();
  const { organizationId } = useOrgId();
  const { data: pendingTimeOff = 0, error: pendingTimeOffError } = useQuery({
    queryKey: ['time-off-pending-count', organizationId],
    queryFn: async () => {
      if (!organizationId) return 0;
      const { count } = await (supabase as any)
        .from('time_off_requests')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .eq('status', 'pending');
      return count || 0;
    },
    enabled: !!organizationId,
  });
  const { data: pendingDocs = 0, error: pendingDocsError } = useQuery({
    queryKey: ['staff-docs-pending-count', organizationId],
    queryFn: async () => {
      if (!organizationId) return 0;
      const { count } = await supabase
        .from('staff_documents')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .eq('status', 'pending');
      return count || 0;
    },
    enabled: !!organizationId,
  });

  useEffect(() => {
    if (pendingTimeOffError) toast.error('Failed to load time-off requests');
    if (pendingDocsError) toast.error('Failed to load pending documents');
  }, [pendingTimeOffError, pendingDocsError]);

  const staffReasons = usePageBadgeReasons('/dashboard/staff');
  const handleStaffReason = (key: string) => {
    if (key === 'time_off') handleTabChange('time-off');
    else if (key === 'docs') handleTabChange('documents');
    else if (key === 'payout') handleTabChange('team');
  };


  const filteredStaff = staff.filter((s) => {
    const matchesSearch = s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.email.toLowerCase().includes(searchTerm.toLowerCase());
    if (statusFilter === 'active') return matchesSearch && s.is_active;
    if (statusFilter === 'inactive') return matchesSearch && !s.is_active;
    return matchesSearch;
  });

  const activeCount = staff.filter(s => s.is_active).length;
  const inactiveCount = staff.filter(s => !s.is_active).length;

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase();
  };

  const getColorFromName = (name: string) => {
    const colors = [
      '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
      '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1'
    ];
    const index = name.charCodeAt(0) % colors.length;
    return colors[index];
  };

  const handleEditClick = (member: StaffMember) => {
    setSelectedStaff(member);
    setEditDialogOpen(true);
  };

  const handleDeleteClick = (member: StaffMember) => {
    setStaffToDelete(member);
    setDeleteDialogOpen(true);
  };

  const handlePermanentDeleteClick = (member: StaffMember) => {
    setStaffToDelete(member);
    setPermanentDeleteDialogOpen(true);
  };

  const handleConfirmPermanentDelete = async () => {
    if (!staffToDelete) return;

    setIsDeletingPermanently(true);
    try {
      const { error } = await supabase
        .from('staff')
        .delete()
        .eq('id', staffToDelete.id);

      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['staff'] });
      toast.success('Staff member permanently deleted');
      setPermanentDeleteDialogOpen(false);
      setStaffToDelete(null);
    } catch (error: any) {
      console.error('Error permanently deleting staff:', error);
      toast.error(error.message || 'Failed to delete staff member. They may have associated bookings.');
    } finally {
      setIsDeletingPermanently(false);
    }
  };

  const handleToggleActive = async (member: StaffMember, checked: boolean) => {
    try {
      const { error } = await supabase
        .from('staff')
        .update({ is_active: checked })
        .eq('id', member.id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['staff'] });
      toast.success(`${member.name} ${checked ? 'activated. Now available for bookings.' : 'deactivated. Removed from booking assignments.'}`);
    } catch (error) {
      console.error('Error updating staff status:', error);
      toast.error('Failed to update staff status');
    }
  };

  const handleResendPasswordLink = async (member: StaffMember) => {
    setIsResendingLink(true);
    try {
      const response = await supabase.functions.invoke('resend-staff-password-link', {
        body: {
          staffId: member.id,
          redirectUrl: `${window.location.origin}/staff/reset-password`,
          organizationId,
        },
      });

      if (response.error) {
        // Not response.error.message — supabase-js reports every non-2xx as
        // "Edge Function returned a non-2xx status code" and discards what the
        // function actually said.
        throw new Error(await readEdgeFunctionError(response.error, 'Failed to generate password link'));
      }

      const data = response.data;
      
      if (data.error) {
        throw new Error(data.error);
      }

      // A cleaner who works for more than one business never has their link
      // returned here — the function emails it to them instead, because a
      // recovery link opens the whole account, not just this business's portal.
      if (data.emailed) {
        // Fallback text rather than an empty modal if maskedEmail is ever
        // absent — the admin still needs to know delivery happened.
        setResendLinkData({
          name: data.staffName,
          maskedEmail: data.maskedEmail || 'their email address',
        });
        setResendLinkDialogOpen(true);
        toast.success('Setup link emailed to the staff member');
      } else {
        setResendLinkData({
          name: data.staffName,
          email: data.staffEmail,
          link: data.resetLink,
        });
        setResendLinkDialogOpen(true);
        toast.success('Password reset link generated');
      }
    } catch (error) {
      console.error('Error generating password link:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to generate password link');
    } finally {
      setIsResendingLink(false);
    }
  };

  const copyLink = () => {
    // No link on the emailed path — the button is not rendered there, but guard
    // anyway so a future edit cannot copy "undefined" to someone's clipboard.
    if (resendLinkData?.link) {
      navigator.clipboard.writeText(resendLinkData.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleResendLinkDialogClose = () => {
    setResendLinkDialogOpen(false);
    setResendLinkData(null);
    setCopied(false);
  };

  const handleConfirmDeactivate = async () => {
    if (!staffToDelete) return;

    try {
      const { error } = await supabase
        .from('staff')
        .update({ is_active: false })
        .eq('id', staffToDelete.id);

      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['staff'] });
      toast.success('Staff member deactivated. They remain in your records.');
      setDeleteDialogOpen(false);
      setStaffToDelete(null);
    } catch (error) {
      console.error('Error deactivating staff:', error);
      toast.error('Failed to deactivate staff member');
    }
  };

  return (
    <AdminLayout
      title="Staff"
      subtitle={`${staff.length} team members`}
      actions={
        <Button className="gap-2" onClick={() => setAddDialogOpen(true)}>
          <Plus className="w-4 h-4" />
          Add Staff
        </Button>
      }
    >
<div className="portal-v2 portal-v2-scroll">
      <SEOHead title="Staff | TidyWise" description="Manage your cleaning staff" noIndex />
      <AttentionStrip href="/dashboard/staff" onReasonClick={(r) => handleStaffReason(r.key)} />
      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <TabsList className="grid w-full max-w-2xl grid-cols-4 mb-4">
          <TabsTrigger value="team" className="gap-2">
            <Users className="h-4 w-4" />
            Team
          </TabsTrigger>
          <TabsTrigger value="documents" className="gap-2 relative">
            <FileText className="h-4 w-4" />
            Documents
            {pendingDocs > 0 && (
              <Badge variant="destructive" className="ml-1 h-5 min-w-5 px-1.5 text-xs">
                {pendingDocs}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="activity" className="gap-2">
            <Bell className="h-4 w-4" />
            Activity
          </TabsTrigger>
          <TabsTrigger value="time-off" className="gap-2 relative">
            <CalendarOff className="h-4 w-4" />
            Time Off
            {pendingTimeOff > 0 && (
              <Badge variant="destructive" className="ml-1 h-5 min-w-5 px-1.5 text-xs">
                {pendingTimeOff}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ─── TAB 1: Team ─── */}
        <TabsContent value="team">
          {/* Search and Filters */}
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search staff..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <TabsList>
                <TabsTrigger value="all" className="gap-1.5">
                  All Staff
                  <Badge variant="secondary" className="ml-1 text-xs h-5 px-1.5">{staff.length}</Badge>
                </TabsTrigger>
                <TabsTrigger value="active" className="gap-1.5">
                  Active
                  <Badge variant="secondary" className="ml-1 text-xs h-5 px-1.5">{activeCount}</Badge>
                </TabsTrigger>
                <TabsTrigger value="inactive" className="gap-1.5">
                  Inactive
                  {inactiveCount > 0 && (
                    <Badge variant="secondary" className="ml-1 text-xs h-5 px-1.5">{inactiveCount}</Badge>
                  )}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* Staff Grid */}
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading staff...</div>
          ) : filteredStaff.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {searchTerm ? 'No staff found matching your search' : statusFilter === 'inactive' ? 'No inactive staff members' : 'No staff members yet. Add your first team member!'}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredStaff.map((member) => {
                const color = getColorFromName(member.name);
                const isInactive = !member.is_active;
                return (
                  <Card
                    key={member.id}
                    className={cn(
                      "hover:shadow-md transition-all",
                      isInactive && "opacity-60 border-dashed"
                    )}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <Avatar className={cn("h-12 w-12", isInactive && "grayscale")}>
                            <AvatarFallback 
                              className="font-medium text-lg"
                              style={{ 
                                backgroundColor: `${color}20`,
                                color: color 
                              }}
                            >
                              {getInitials(member.name)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <h3 className="font-semibold">{maskName(member.name)}</h3>
                            <div className="flex items-center gap-2">
                              {hasFinancialAccess && ((wagesById.get(member.id)?.base_wage ?? null) || member.hourly_rate) && (
                                <span className="text-sm text-muted-foreground">
                                  {isTestMode ? '$XX/hr' : `$${wagesById.get(member.id)?.base_wage ?? member.hourly_rate}/hr`}
                                </span>
                              )}

                              <Badge variant={member.tax_classification === '1099' ? 'secondary' : 'default'} className="text-xs">
                                {member.tax_classification === '1099' ? '1099' : 'W-2'}
                              </Badge>
                            </div>
                          </div>
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem 
                              className="gap-2"
                              onClick={() => {
                                setSelectedStaff(member);
                                setScheduleDialogOpen(true);
                              }}
                            >
                              <Calendar className="w-4 h-4" /> View Schedule
                            </DropdownMenuItem>
                            <DropdownMenuItem 
                              className="gap-2"
                              onClick={() => handleEditClick(member)}
                            >
                              <Edit className="w-4 h-4" /> Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem 
                              className="gap-2"
                              onClick={() => handleResendPasswordLink(member)}
                              disabled={isResendingLink}
                            >
                              <KeyRound className="w-4 h-4" /> Resend Password Link
                            </DropdownMenuItem>
                            {isInactive && (
                              <DropdownMenuItem 
                                className="gap-2"
                                onClick={() => handlePermanentDeleteClick(member)}
                              >
                                <Trash2 className="w-4 h-4 text-destructive" />
                                <span className="text-destructive">Delete Permanently</span>
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 text-sm">
                          <Mail className="w-4 h-4 text-muted-foreground" />
                          <span className="truncate">{maskEmail(member.email)}</span>
                        </div>
                        {member.phone && (
                          <div className="flex items-center gap-2 text-sm">
                            <Phone className="w-4 h-4 text-muted-foreground" />
                            <span>{maskPhone(member.phone)}</span>
                          </div>
                        )}
                        {member.home_address && (
                          <div className="flex items-center gap-2 text-sm">
                            <MapPin className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                            <span className="truncate">{isTestMode ? '123 Test St, City, ST' : member.home_address}</span>
                          </div>
                        )}
                        {member.bio && (
                          <p className="text-sm text-muted-foreground line-clamp-2">{member.bio}</p>
                        )}
                        <div className="flex items-center justify-between pt-3 border-t">
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-muted-foreground">Status</span>
                            <Badge
                              variant={member.is_active ? "default" : "secondary"}
                              className={cn(
                                "text-xs",
                                member.is_active
                                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
                                  : "bg-muted text-muted-foreground"
                              )}
                            >
                              {member.is_active ? 'Active' : 'Inactive'}
                            </Badge>
                          </div>
                          <Switch 
                            checked={member.is_active} 
                            onCheckedChange={(checked) => {
                              if (!checked) {
                                setStaffToDelete(member);
                                setDeleteDialogOpen(true);
                              } else {
                                handleToggleActive(member, true);
                              }
                            }}
                          />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ─── TAB 2: Documents ─── */}
        <TabsContent value="documents" className="space-y-4">
          {/* Signable Documents */}
          <Card>
            <CardContent className="pt-6">
              <AdminSignableDocManager />
            </CardContent>
          </Card>

          {/* Document Review */}
          <PendingDocumentsReview />
        </TabsContent>

        {/* ─── TAB 3: Activity ─── */}
        <TabsContent value="activity" className="space-y-4">
          <StaffEventNotifications />

          {organizationId && (
            <StaffComplianceDashboard organizationId={organizationId} />
          )}
        </TabsContent>

        <TabsContent value="time-off" className="space-y-4">
          <TimeOffRequestsPanel />
        </TabsContent>
      </Tabs>


      <AddStaffDialog open={addDialogOpen} onOpenChange={setAddDialogOpen} />
      <EditStaffDialog 
        open={editDialogOpen} 
        onOpenChange={setEditDialogOpen} 
        staff={selectedStaff}
      />

      {/* Deactivate Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate Staff Member</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to deactivate <strong>{staffToDelete?.name}</strong>?
              <br /><br />
              • They will be marked as <strong>Inactive</strong> and remain in your staff list
              <br />
              • They will be <strong>excluded from booking assignment</strong> dropdowns
              <br />
              • Their records, history, and data will be <strong>fully preserved</strong>
              <br />
              • You can <strong>reactivate them at any time</strong> with a single toggle
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDeactivate}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Permanent Delete Confirmation */}
      <AlertDialog open={permanentDeleteDialogOpen} onOpenChange={setPermanentDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">Permanently Delete Staff Member</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="text-destructive">Warning:</strong> This will permanently delete {staffToDelete?.name} from the database. 
              This action cannot be undone. All associated data will be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeletingPermanently}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmPermanentDelete}
              disabled={isDeletingPermanently}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeletingPermanently ? 'Deleting...' : 'Delete Permanently'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Password Reset Link Dialog */}
      <Dialog open={resendLinkDialogOpen} onOpenChange={handleResendLinkDialogClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Password Setup Link</DialogTitle>
          </DialogHeader>
          {/* Emailed path — this person works for more than one business, so the
              link went straight to them and is deliberately not shown here. */}
          {resendLinkData?.maskedEmail && (
            <div className="space-y-4 py-4">
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3">
                <p className="text-sm font-medium flex items-center gap-2">
                  <Mail className="w-4 h-4" />
                  Setup link sent to {resendLinkData.maskedEmail}
                </p>
              </div>
              <p className="text-sm text-muted-foreground">
                {resendLinkData.name} works for more than one business, so the link was
                emailed to them directly rather than shown here — it would sign in to all
                of their businesses, not just yours. Ask them to check their inbox.
              </p>
              <p className="text-xs text-muted-foreground text-center">
                The link will expire after use. You can generate a new one if needed.
              </p>
            </div>
          )}

          {/* Single-business path — unchanged. */}
          {resendLinkData?.link && (
            <div className="space-y-4 py-4">
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3">
                <p className="text-sm font-medium flex items-center gap-2">
                  <Mail className="w-4 h-4" />
                  Send this link to {resendLinkData.name}
                </p>
              </div>
              <p className="text-sm text-muted-foreground">
                Share this password setup link with the staff member. They'll use it to create or reset their password and access the staff portal.
              </p>
              <div className="bg-muted p-4 rounded-lg space-y-3">
                <div>
                  <Label className="text-xs text-muted-foreground">Email</Label>
                  <p className="font-mono text-sm">{resendLinkData.email}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Password Setup Link</Label>
                  <p className="font-mono text-xs break-all bg-background p-2 rounded border mt-1">
                    {resendLinkData.link}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={copyLink}
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Copied!' : 'Copy Setup Link'}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                The link will expire after use. You can generate a new one if needed.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button onClick={handleResendLinkDialogClose}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Schedule Dialog */}
      <Dialog open={scheduleDialogOpen} onOpenChange={setScheduleDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedStaff?.name}'s Schedule
            </DialogTitle>
          </DialogHeader>
          {/* The admin's own org — this staff list is already scoped to it, so
              this is the same value useOrgTimezone() resolved before. */}
          {selectedStaff && (
            <CleanerCalendar staffId={selectedStaff.id} organizationId={organizationId} />
          )}
          <DialogFooter>
            <Button onClick={() => setScheduleDialogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
</AdminLayout>
  );
}
