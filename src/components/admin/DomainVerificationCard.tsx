import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Globe, Plus, RefreshCw, Trash2, Loader2, CheckCircle, AlertTriangle, Clock, Copy } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { useOrganization } from '@/contexts/OrganizationContext';
import { confirmDialog } from "@/components/AppDialogs";

interface DnsRecord {
  record: string;
  name: string;
  type: string;
  ttl: string;
  status: string;
  value: string;
  priority?: number;
}

interface DomainRecord {
  id: string;
  organization_id: string;
  domain_name: string;
  resend_domain_id: string | null;
  status: string;
  dns_records: DnsRecord[] | null;
  created_at: string;
}

export function DomainVerificationCard() {
  const { organization, isAdmin } = useOrganization();
  const [domains, setDomains] = useState<DomainRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [newDomain, setNewDomain] = useState('');
  const [adding, setAdding] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    if (organization?.id) fetchDomains();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchDomains is recreated each render; runs once per org
  }, [organization?.id]);

  const fetchDomains = async () => {
    const { data, error } = await supabase
      .from('organization_email_domains')
      .select('*')
      .eq('organization_id', organization!.id)
      .order('created_at', { ascending: false });

    if (!error && data) setDomains(data as unknown as DomainRecord[]);
    setLoading(false);
  };

  const callEdgeFunction = async (action: string, extra: Record<string, string> = {}) => {
    const { data, error } = await supabase.functions.invoke('manage-resend-domain', {
      body: { action, organizationId: organization!.id, ...extra },
    });
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(data.error);
    return data;
  };

  const addDomain = async () => {
    let domain = newDomain.trim().toLowerCase();
    if (!domain) return;

    // If user entered an email address, extract just the domain part
    if (domain.includes('@')) {
      domain = domain.split('@').pop() || '';
    }
    if (!domain) {
      toast.error('Please enter a valid domain name (e.g. yourdomain.com)');
      return;
    }

    setAdding(true);
    try {
      await callEdgeFunction('add', { domain });
      toast.success('Domain added! Add the DNS records below to verify.');
      setNewDomain('');
      await fetchDomains();
    } catch (err: any) {
      toast.error(err.message || 'Failed to add domain');
    } finally {
      setAdding(false);
    }
  };

  const verifyDomain = async (resendDomainId: string) => {
    setActionLoading(resendDomainId);
    try {
      await callEdgeFunction('verify', { resendDomainId });
      // Check status after verify
      const result = await callEdgeFunction('check', { resendDomainId });
      await fetchDomains();
      if (result.status === 'verified') {
        toast.success('Domain verified successfully!');
      } else {
        toast.info('Verification initiated. DNS changes can take up to 72 hours to propagate.');
      }
    } catch (err: any) {
      toast.error(err.message || 'Verification failed');
    } finally {
      setActionLoading(null);
    }
  };

  const checkStatus = async (resendDomainId: string) => {
    setActionLoading(resendDomainId);
    try {
      const result = await callEdgeFunction('check', { resendDomainId });
      await fetchDomains();
      if (result.status === 'verified') {
        toast.success('Domain is verified!');
      } else {
        toast.info(`Current status: ${result.status}`);
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to check status');
    } finally {
      setActionLoading(null);
    }
  };

  const removeDomain = async (resendDomainId: string) => {
    if (!(await confirmDialog('Remove this domain? You will no longer be able to send emails from it.'))) return;
    setActionLoading(resendDomainId);
    try {
      await callEdgeFunction('remove', { resendDomainId });
      toast.success('Domain removed');
      await fetchDomains();
    } catch (err: any) {
      toast.error(err.message || 'Failed to remove domain');
    } finally {
      setActionLoading(null);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case 'verified':
        return <Badge variant="default" className="bg-success text-success-foreground"><CheckCircle className="w-3 h-3 mr-1" /> Verified</Badge>;
      case 'pending': case 'not_started':
        return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" /> Pending</Badge>;
      case 'temporary_failure': case 'failed':
        return <Badge variant="destructive"><AlertTriangle className="w-3 h-3 mr-1" /> Failed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (!isAdmin) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="w-5 h-5" />
          Email Domain Verification
        </CardTitle>
        <CardDescription>
          Verify your domain so emails are sent from your business address (e.g. bookings@yourdomain.com)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Alert variant="default" className="border-info/20 bg-info/10">
          <Globe className="h-4 w-4 text-info" />
          <AlertDescription className="text-info">
            Add your domain, then copy the DNS records to your domain registrar (GoDaddy, Cloudflare, Namecheap, etc.). Verification can take up to 72 hours.
          </AlertDescription>
        </Alert>

        {/* Add new domain */}
        <div className="flex gap-2">
          <div className="flex-1">
            <Label htmlFor="newDomain" className="sr-only">Domain name</Label>
            <Input
              id="newDomain"
              placeholder="yourdomain.com (domain only, not email)"
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addDomain()}
            />
          </div>
          <Button onClick={addDomain} disabled={adding || !newDomain.trim()} className="gap-2">
            {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add Domain
          </Button>
        </div>

        {/* Domain list */}
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : domains.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No domains added yet. Add your business domain above to get started.
          </p>
        ) : (
          <div className="space-y-4">
            {domains.map((d) => (
              <div key={d.id} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="font-medium">{d.domain_name}</span>
                    {statusBadge(d.status)}
                  </div>
                  <div className="flex gap-1">
                    {d.resend_domain_id && d.status !== 'verified' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => verifyDomain(d.resend_domain_id!)}
                        disabled={actionLoading === d.resend_domain_id}
                        className="gap-1"
                      >
                        {actionLoading === d.resend_domain_id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <RefreshCw className="w-3 h-3" />
                        )}
                        Verify
                      </Button>
                    )}
                    {d.resend_domain_id && d.status === 'verified' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => checkStatus(d.resend_domain_id!)}
                        disabled={actionLoading === d.resend_domain_id}
                      >
                        <RefreshCw className="w-3 h-3" />
                      </Button>
                    )}
                    {d.resend_domain_id && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeDomain(d.resend_domain_id!)}
                        disabled={actionLoading === d.resend_domain_id}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                </div>

                {/* DNS Records */}
                {d.dns_records && d.dns_records.length > 0 && (
                  <div className="space-y-3">
                    <div className="rounded-md border border-border bg-muted/50 p-3 space-y-2">
                      <p className="text-sm font-semibold">How to verify your domain:</p>
                      <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                        <li>Log in to your domain registrar (GoDaddy, Namecheap, Cloudflare, Google Domains, etc.)</li>
                        <li>Go to <strong>DNS Settings</strong> or <strong>DNS Management</strong> for <strong>{d.domain_name}</strong></li>
                        <li>Add each record from the table below — use the copy button to copy the values</li>
                        <li>Save your changes, then click the <strong>Verify</strong> button above</li>
                        <li>DNS changes can take up to 72 hours to propagate</li>
                      </ol>
                    </div>
                    <p className="text-sm font-medium text-muted-foreground">
                      DNS records to add:
                    </p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs border-collapse">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left p-2 font-medium text-muted-foreground">Type</th>
                            <th className="text-left p-2 font-medium text-muted-foreground">Name</th>
                            <th className="text-left p-2 font-medium text-muted-foreground">Value</th>
                            <th className="text-left p-2 font-medium text-muted-foreground">Status</th>
                            <th className="p-2"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {d.dns_records.map((rec, i) => (
                            <tr key={i} className="border-b last:border-0">
                              <td className="p-2 font-mono">{rec.type}</td>
                              <td className="p-2 font-mono max-w-[150px] truncate" title={rec.name}>{rec.name}</td>
                              <td className="p-2 font-mono max-w-[250px] truncate" title={rec.value}>{rec.value}</td>
                              <td className="p-2">
                                {rec.status === 'verified' ? (
                                  <CheckCircle className="w-3 h-3 text-success" />
                                ) : (
                                  <Clock className="w-3 h-3 text-muted-foreground" />
                                )}
                              </td>
                              <td className="p-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0"
                                  onClick={() => copyToClipboard(rec.value)}
                                >
                                  <Copy className="w-3 h-3" />
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {d.status === 'verified' && (
                  <p className="text-xs text-success">
                    ✓ You can now send emails from @{d.domain_name}. Set your From Email in the email settings above.
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
