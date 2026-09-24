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
}

interface Props {
  staffId: string;
  staffName: string;
}

export function StaffDocumentManager({ staffId, staffName }: Props) {
  const { organizationId } = useOrgId();
  const queryClient = useQueryClient();
  const [reviewingDocId, setReviewingDocId] = useState<string | null>(null);
  const [adminNote, setAdminNote] = useState('');

  const { data: documents = [], isLoading, error: documentsError } = useQuery({
    queryKey: ['admin-staff-documents', staffId, organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff_documents')
        .select('*')
        .eq('staff_id', staffId)
        .eq('organization_id', organizationId!)
        .order('uploaded_at', { ascending: false });
      if (error) throw error;
      return (data || []) as StaffDocument[];
    },
    enabled: !!staffId && !!organizationId,
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ docId, status, note }: { docId: string; status: string; note: string }) => {
      const { error } = await supabase
        .from('staff_documents')
        .update({
          status,
          admin_note: note || null,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', docId);
      if (error) throw error;

      // Notify the cleaner's portal bell
      if (status === 'approved' || status === 'rejected') {
        const { data: doc } = await supabase
          .from('staff_documents')
          .select('staff_id, document_type, organization_id')
          .eq('id', docId)
          .single();
        if (doc?.staff_id) {
          const { error: notifErr1 } = await supabase.from('cleaner_notifications').insert({
            staff_id: doc.staff_id,
            organization_id: doc.organization_id,
            type: 'document_review',
            title: status === 'approved' ? 'Document approved' : 'Document rejected',
            message: status === 'approved'
              ? `Your ${doc.document_type} was approved.`
              : `Your ${doc.document_type} was rejected.${note ? ` Note: ${note}` : ' Please re-upload.'}`,
          });
          if (notifErr1) console.error('[cleaner-notify] insert failed:', notifErr1);
          sendPushBestEffort({
            organizationId: doc.organization_id,
            staffId: doc.staff_id,
            title: status === 'approved' ? 'Document approved' : 'Document rejected',
            body: status === 'approved' ? 'Your document was approved.' : 'Your document was rejected. Please re-upload.',
          });
        }
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['admin-staff-documents', staffId] });
      refreshBadges(queryClient);
      toast.success(`Document ${variables.status}`);
      setReviewingDocId(null);
      setAdminNote('');
    },

    onError: () => toast.error('Failed to update document status'),
  });

  const handlePreview = (filePath: string) => previewFile('staff-documents', filePath);

  const handleDownload = (filePath: string, fileName: string) =>
    downloadFile('staff-documents', filePath, fileName);

  const statusIcon = (status: string) => {
    if (status === 'approved') return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    if (status === 'rejected') return <XCircle className="h-4 w-4 text-destructive" />;
    return <Clock className="h-4 w-4 text-muted-foreground" />;
  };

  const statusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive'> = {
      approved: 'default',
      rejected: 'destructive',
      pending: 'secondary',
    };
    return (
      <Badge variant={variants[status] || 'secondary'} className="gap-1 text-xs capitalize">
        {statusIcon(status)}
        {status}
      </Badge>
    );
  };

  // Summary stats
  const pending = documents.filter(d => d.status === 'pending').length;
  const approved = documents.filter(d => d.status === 'approved').length;
  const rejected = documents.filter(d => d.status === 'rejected').length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (documentsError) {
    return <QueryError subject="staff documents" />;
  }

  if (documents.length === 0) {
    return (
      <div className="text-center py-6 text-sm text-muted-foreground">
        <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
        No documents uploaded by this staff member yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Summary */}
      <div className="flex gap-3 text-sm">
        <span className="text-muted-foreground">{documents.length} total</span>
        {pending > 0 && <Badge variant="secondary" className="text-xs">{pending} pending</Badge>}
        {approved > 0 && <Badge variant="default" className="text-xs">{approved} approved</Badge>}
        {rejected > 0 && <Badge variant="destructive" className="text-xs">{rejected} rejected</Badge>}
      </div>

      {/* Document List */}
      {documents.map((doc) => (
        <div key={doc.id} className="border rounded-lg p-3 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{doc.file_name}</p>
              <p className="text-xs text-muted-foreground">
                {DOCUMENT_TYPES[doc.document_type] || doc.document_type} · {format(new Date(doc.uploaded_at), 'MMM d, yyyy')}
              </p>
            </div>
            {statusBadge(doc.status)}
          </div>

          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="gap-1 min-h-[44px] text-xs" onClick={() => handlePreview(doc.file_path)}>
              <Eye className="h-3 w-3" /> Preview
            </Button>
            <Button variant="outline" size="sm" className="gap-1 min-h-[44px] text-xs" onClick={() => handleDownload(doc.file_path, doc.file_name)}>
              <Download className="h-3 w-3" /> Download
            </Button>

            {doc.status === 'pending' && reviewingDocId !== doc.id && (
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

            {doc.status !== 'pending' && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1 min-h-[44px] text-xs ml-auto"
                onClick={() => updateStatusMutation.mutate({ docId: doc.id, status: 'pending', note: '' })}
              >
                Reset to Pending
              </Button>
            )}
          </div>

          {/* Rejection note input */}
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
                  onClick={() => { setReviewingDocId(null); setAdminNote(''); }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {doc.admin_note && doc.status === 'rejected' && reviewingDocId !== doc.id && (
            <p className="text-xs text-destructive">Note: {doc.admin_note}</p>
          )}
        </div>
      ))}
    </div>
  );
}
