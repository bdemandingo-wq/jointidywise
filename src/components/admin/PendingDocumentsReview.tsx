import { useState } from 'react';
import { sendPushBestEffort } from '@/lib/pushNotify';
import { supabase } from '@/lib/supabase';
import { previewFile, downloadFile } from '@/lib/fileActions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { FileText, CheckCircle2, XCircle, Clock, Eye, Download, Loader2 } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useOrgId } from '@/hooks/useOrgId';
import { format } from 'date-fns';
import { QueryError } from '@/components/QueryError';
import { refreshBadges } from '@/lib/badgeRefresh';


const DOCUMENT_TYPES: Record<string, string> = {
  insurance: 'Insurance Certificate',
  w9: 'W-9 Form',
  id: 'Government ID',
  certification: 'Certification',
  other: 'Other',
};

interface StaffDocument {
  id: string;
  staff_id: string;
  file_name: string;
  file_path: string;
  document_type: string;
  uploaded_at: string;
  status: string;
  admin_note: string | null;
  reviewed_at: string | null;
  staff?: { name: string } | null;
}

export function PendingDocumentsReview() {
  const { organizationId } = useOrgId();
  const queryClient = useQueryClient();
  const [reviewingDocId, setReviewingDocId] = useState<string | null>(null);
  const [adminNote, setAdminNote] = useState('');

  const queryKey = ['admin-pending-documents', organizationId] as const;

  const { data: pendingDocuments = [], isLoading, error: pendingDocumentsError } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff_documents')
        .select('*, staff(name)')
        .eq('organization_id', organizationId!)
        .eq('status', 'pending')
        .order('uploaded_at', { ascending: false });

      if (error) throw error;
      return (data || []) as StaffDocument[];
    },
    enabled: !!organizationId,
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ docId, status, note }: { docId: string; status: 'approved' | 'rejected'; note: string }) => {
      const { error } = await supabase
        .from('staff_documents')
        .update({
          status,
          admin_note: note || null,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', docId);

      if (error) throw error;

      // Notify the cleaner (bell in the staff portal reads cleaner_notifications).
      // Fetch the row directly — the optimistic update already removed it from cache.
      const { data: doc } = await supabase
        .from('staff_documents')
        .select('staff_id, document_type')
        .eq('id', docId)
        .single();
      if (doc?.staff_id) {
        const docLabel = DOCUMENT_TYPES[doc.document_type] || doc.document_type;
        const { error: notifErr1 } = await supabase.from('cleaner_notifications').insert({
          staff_id: doc.staff_id,
          organization_id: organizationId,
          type: 'document_review',
          title: status === 'approved' ? 'Document approved' : 'Document rejected',
          message: status === 'approved'
            ? `Your ${docLabel} was approved.`
            : `Your ${docLabel} was rejected.${note ? ` Note: ${note}` : ' Please re-upload.'}`,
        });
        if (notifErr1) console.error('[cleaner-notify] insert failed:', notifErr1);
        // A push with no organisation cannot be routed. Skipping here is
        // visible; passing '' would be a silent no-op inside the helper.
        if (organizationId) sendPushBestEffort({
          organizationId,
          staffId: doc.staff_id,
          title: status === 'approved' ? 'Document approved' : 'Document rejected',
          body: status === 'approved' ? 'Your document was approved.' : 'Your document was rejected. Please re-upload.',
        });
      }
    },
    onMutate: async ({ docId }) => {
      await queryClient.cancelQueries({ queryKey });

      const previous = queryClient.getQueryData<StaffDocument[]>(queryKey) ?? [];
      queryClient.setQueryData<StaffDocument[]>(queryKey, (current = []) =>
        current.filter((doc) => doc.id !== docId)
      );

      return { previous };
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ['admin-staff-documents'] });
      queryClient.invalidateQueries({ queryKey: ['staff-event-notifications'] });
      // Tab badge + sidebar counts live in separate queries; without this the
      // review list empties while the red "7" stays put.
      refreshBadges(queryClient);
      toast.success(`Document ${variables.status}`);
      setReviewingDocId(null);
      setAdminNote('');
    },

    onError: (_error, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous);
      }
      toast.error('Failed to update document status');
    },
  });

  const handlePreview = (filePath: string) => previewFile('staff-documents', filePath);

  const handleDownload = (filePath: string, fileName: string) =>
    downloadFile('staff-documents', filePath, fileName);

  if (pendingDocumentsError) return <QueryError subject="pending documents" onRetry={() => queryClient.invalidateQueries({ queryKey })} />;

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4" />
            Document Review
          </CardTitle>
          <Badge variant="secondary" className="gap-1 text-xs">
            <Clock className="h-3 w-3" />
            {pendingDocuments.length} pending
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-2">
        {pendingDocuments.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No pending documents to review.
          </p>
        ) : (
          pendingDocuments.map((doc) => (
            <div key={doc.id} className="border rounded-lg p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">{doc.file_name}</p>
                    <Badge variant="secondary" className="text-xs capitalize shrink-0">
                      pending
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {doc.staff?.name || 'Unknown staff'} · {DOCUMENT_TYPES[doc.document_type] || doc.document_type} · {format(new Date(doc.uploaded_at), 'MMM d, yyyy')}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1 flex-wrap">
                <Button variant="outline" size="sm" className="gap-1 min-h-[44px] text-xs" onClick={() => handlePreview(doc.file_path)}>
                  <Eye className="h-3 w-3" /> Preview
                </Button>
                <Button variant="outline" size="sm" className="gap-1 min-h-[44px] text-xs" onClick={() => handleDownload(doc.file_path, doc.file_name)}>
                  <Download className="h-3 w-3" /> Download
                </Button>

                {reviewingDocId !== doc.id && (
                  <>
                    <Button
                      variant="default"
                      size="sm"
                      className="gap-1 min-h-[44px] text-xs ml-auto"
                      onClick={() => updateStatusMutation.mutate({ docId: doc.id, status: 'approved', note: '' })}
                    >
                      <CheckCircle2 className="h-3 w-3" /> Approve
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="gap-1 min-h-[44px] text-xs"
                      onClick={() => setReviewingDocId(doc.id)}
                    >
                      <XCircle className="h-3 w-3" /> Reject
                    </Button>
                  </>
                )}
              </div>

              {reviewingDocId === doc.id && (
                <div className="space-y-2 pt-1">
                  <Textarea
                    placeholder="Reason for rejection (optional)..."
                    value={adminNote}
                    onChange={(e) => setAdminNote(e.target.value)}
                    className="text-sm"
                    rows={2}
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="destructive"
                      size="sm"
                      className="text-xs"
                      onClick={() => updateStatusMutation.mutate({ docId: doc.id, status: 'rejected', note: adminNote })}
                    >
                      Confirm Reject
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs"
                      onClick={() => {
                        setReviewingDocId(null);
                        setAdminNote('');
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
