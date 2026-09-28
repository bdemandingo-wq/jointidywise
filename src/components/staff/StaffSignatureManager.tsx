import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { previewFile } from '@/lib/fileActions';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

import { toast } from 'sonner';
import { FileText, CheckCircle2, PenLine, Loader2, Eye, Clock } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { format } from 'date-fns';
import { SignaturePad } from './SignaturePad';
import { QueryError } from '@/components/QueryError';
import { OrgTimestamp } from '@/components/OrgTimestamp';


interface SignableDoc {
  id: string;
  title: string;
  description: string | null;
  file_path: string;
  file_name: string;
}

interface Signature {
  id: string;
  signable_document_id: string;
  signature_data: string;
  signature_type: string;
  signed_at: string;
  signed_pdf_path: string | null;
}

interface Props {
  staffId: string;
  organizationId: string;
}

export function StaffSignatureManager({ staffId, organizationId }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [signingDocId, setSigningDocId] = useState<string | null>(null);

  // Fetch signable documents for this org
  const { data: signableDocs = [], isLoading: loadingDocs, error: docsError } = useQuery({
    queryKey: ['signable-documents', organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff_signable_documents')
        .select('id, title, description, file_path, file_name')
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []) as SignableDoc[];
    },
    enabled: !!organizationId,
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
  });

  // Fetch this staff's signatures
  const { data: signatures = [], isLoading: loadingSigs, error: sigsError } = useQuery({
    queryKey: ['staff-signatures', staffId, organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff_signatures')
        .select('id, signable_document_id, signature_data, signature_type, signed_at, signed_pdf_path')
        .eq('staff_id', staffId)
        .eq('organization_id', organizationId);
      if (error) throw error;
      return (data || []) as Signature[];
    },
    enabled: !!staffId && !!organizationId,
  });

  const signMutation = useMutation({
    mutationFn: async ({ docId, signatureData, signatureType, placement }: { docId: string; signatureData: string; signatureType: 'draw' | 'type'; placement?: any }) => {
      if (!user) throw new Error('Not authenticated');

      // Store drawn signature image in storage
      let storedSignatureData = signatureData;
      if (signatureType === 'draw') {
        const blob = await (await fetch(signatureData)).blob();
        const path = `signatures/${organizationId}/${staffId}/${docId}_${Date.now()}.png`;
        const { error: uploadError } = await supabase.storage
          .from('staff-documents')
          .upload(path, blob);
        if (uploadError) throw uploadError;
        storedSignatureData = path;
      }

      // Get staff name for the signed PDF
      const { data: staffData } = await supabase
        .from('staff')
        .select('name')
        .eq('id', staffId)
        .single();

      // Call edge function to generate signed PDF with placement coordinates
      const { data: signedPdfResult, error: pdfError } = await supabase.functions.invoke(
        'generate-signed-pdf',
        {
          body: {
            document_id: docId,
            staff_id: staffId,
            organization_id: organizationId,
            signature_data: storedSignatureData,
            signature_type: signatureType,
            staff_name: staffData?.name || 'N/A',
            placement: placement || null,
          },
        }
      );

      if (pdfError) {
        console.error('PDF generation error:', pdfError);
        // Continue with saving signature even if PDF fails
      }

      const { error } = await supabase.from('staff_signatures').insert({
        signable_document_id: docId,
        staff_id: staffId,
        organization_id: organizationId,
        user_id: user.id,
        signature_data: storedSignatureData,
        signature_type: signatureType,
        signed_pdf_path: signedPdfResult?.signed_pdf_path || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff-signatures', staffId, organizationId] });
      queryClient.invalidateQueries({ queryKey: ['onboarding-sigs', staffId, organizationId] });
      toast.success('Document signed successfully! A signed PDF has been generated.');
      setSigningDocId(null);
    },
    onError: (err: any) => {
      console.error('Signature error:', err);
      toast.error('Failed to sign document');
    },
  });

  // Uses fileActions: in the iOS app this opens the in-app browser. The old
  // version fell back to window.location on native, which navigated the whole
  // app to the PDF with no way back.
  const handlePreview = (filePath: string) => previewFile('staff-documents', filePath);

  const regeneratePdfMutation = useMutation({
    mutationFn: async (sig: Signature) => {
      if (!user) throw new Error('Not authenticated');
      const { data: staffData } = await supabase
        .from('staff')
        .select('name')
        .eq('id', staffId)
        .single();

      const doc = signableDocs.find(d => d.id === sig.signable_document_id);
      if (!doc) throw new Error('Document not found');

      const { data: result, error: pdfError } = await supabase.functions.invoke(
        'generate-signed-pdf',
        {
          body: {
            document_id: doc.id,
            staff_id: staffId,
            organization_id: organizationId,
            signature_data: sig.signature_data,
            signature_type: sig.signature_type,
            staff_name: staffData?.name || 'N/A',
          },
        }
      );

      if (pdfError) throw pdfError;
      // The edge function persists signed_pdf_path server-side (service role).
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff-signatures', staffId, organizationId] });
      queryClient.invalidateQueries({ queryKey: ['onboarding-sigs', staffId, organizationId] });
      toast.success('Signed PDF regenerated successfully!');
    },
    onError: () => {
      toast.error('Failed to regenerate signed PDF');
    },
  });

  const isLoading = loadingDocs || loadingSigs;
  const queryError = docsError || sigsError;

  if (queryError) {
    return <QueryError subject="signature documents" />;
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Loader2 className="h-6 w-6 animate-spin mx-auto" />
        </CardContent>
      </Card>
    );
  }

  if (signableDocs.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <PenLine className="h-5 w-5" />
            E-Signatures
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4">
            <FileText className="h-8 w-8 mx-auto text-muted-foreground mb-2 opacity-50" />
            <p className="text-sm text-muted-foreground">No documents require your signature at this time.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const signed = signableDocs.filter(d => signatures.some(s => s.signable_document_id === d.id)).length;
  const total = signableDocs.length;

  return (
    <div className="space-y-4">
      {/* Summary */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <PenLine className="h-4 w-4" />
              E-Signatures
            </h3>
            <Badge variant={signed === total ? 'default' : 'secondary'} className="text-xs">
              {signed}/{total} Signed
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Documents */}
      {signableDocs.map((doc) => {
        const sig = signatures.find(s => s.signable_document_id === doc.id);
        const isSigning = signingDocId === doc.id;

        return (
          <Card key={doc.id}>
            <CardContent className="pt-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{doc.title}</p>
                  {doc.description && (
                    <p className="text-xs text-muted-foreground mt-0.5">{doc.description}</p>
                  )}
                </div>
                {sig ? (
                  <Badge variant="default" className="gap-1 text-xs shrink-0">
                    <CheckCircle2 className="h-3 w-3" />
                    Signed
                  </Badge>
                ) : (
                  <Badge variant="outline" className="gap-1 text-xs shrink-0">
                    <Clock className="h-3 w-3" />
                    Not Signed
                  </Badge>
                )}
              </div>

              {sig && (
                <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground space-y-2">
                  <p>Signed on <OrgTimestamp value={sig.signed_at} /></p>
                  {sig.signature_type === 'type' && (
                    <p className="text-base italic font-serif" style={{ fontFamily: "'Georgia', serif" }}>
                      {sig.signature_data}
                    </p>
                  )}
                  <div className="flex gap-2 flex-wrap">
                    {sig.signed_pdf_path && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1 h-8 text-xs"
                        onClick={() => handlePreview(sig.signed_pdf_path!)}
                      >
                        <Eye className="h-3 w-3" /> View Signed PDF
                      </Button>
                    )}
                    {!sig.signed_pdf_path && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1 h-8 text-xs"
                        disabled={regeneratePdfMutation.isPending}
                        onClick={() => regeneratePdfMutation.mutate(sig)}
                      >
                        {regeneratePdfMutation.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <FileText className="h-3 w-3" />
                        )}
                        Generate Signed PDF
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {!sig && !isSigning && (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1 flex-1 h-10"
                    onClick={() => handlePreview(doc.file_path)}
                  >
                    <Eye className="h-3.5 w-3.5" /> Review Document
                  </Button>
                  <Button
                    size="sm"
                    className="gap-1 flex-1 h-10"
                    onClick={() => setSigningDocId(doc.id)}
                  >
                    <PenLine className="h-3.5 w-3.5" /> Sign Now
                  </Button>
                </div>
              )}

              {isSigning && (
                <div className="space-y-3 border rounded-lg p-3 bg-muted/20">
                  <SignaturePad
                    saving={signMutation.isPending}
                    onSave={(data, type) => signMutation.mutate({ docId: doc.id, signatureData: data, signatureType: type })}
                    onCancel={() => setSigningDocId(null)}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

    </div>
  );
}
