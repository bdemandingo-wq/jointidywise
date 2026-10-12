import { useEffect, useState } from "react";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { SEOHead } from "@/components/SEOHead";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Plus, Ban, RotateCcw, Copy, Gift, History } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { confirmDialog } from "@/components/AppDialogs";

interface AccessCode {
  id: string;
  code: string;
  duration_days: number;
  max_uses: number | null;
  uses: number;
  expires_at: string | null;
  active: boolean;
  reason: string | null;
  email_lock: string | null;
  created_at: string;
}

interface Comp {
  id: string;
  organization_id: string;
  expires_at: string;
  reason: string | null;
  revoked_at: string | null;
  created_at: string;
  owner_email?: string | null;
  organizations?: { id: string; name: string } | null;
  access_codes?: { code: string; email_lock?: string | null } | null;
}

interface Redemption {
  id: string;
  access_code_id: string;
  user_id: string;
  organization_id: string;
  email: string | null;
  redeemed_at: string;
  organizations?: { id: string; name: string } | null;
}

async function invoke<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("access-codes-admin", {
    body: { action, ...body },
  });
  if (error) throw error;
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as T;
}

export default function AccessCodesAdminPage() {
  const [codes, setCodes] = useState<AccessCode[]>([]);
  const [comps, setComps] = useState<Comp[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [granting, setGranting] = useState(false);

  const [newCode, setNewCode] = useState({ code: "", duration_days: 30, max_uses: "1", reason: "", email_lock: "" });
  const [grant, setGrant] = useState({ organization_id: "", duration_days: 30, reason: "" });

  const [historyCode, setHistoryCode] = useState<AccessCode | null>(null);
  const [historyRows, setHistoryRows] = useState<Redemption[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const [c, g] = await Promise.all([
        invoke<{ codes: AccessCode[] }>("list_codes"),
        invoke<{ comps: Comp[] }>("list_comps"),
      ]);
      setCodes(c.codes ?? []);
      setComps(g.comps ?? []);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function createCode(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      // "" = default (1). "unlimited" sentinel handled via explicit null.
      let max_uses: number | null | undefined = 1;
      if (newCode.max_uses.trim().toLowerCase() === "unlimited") max_uses = null;
      else if (newCode.max_uses.trim() !== "") max_uses = Number(newCode.max_uses);
      await invoke("create_code", {
        code: newCode.code || undefined,
        duration_days: Number(newCode.duration_days),
        max_uses,
        reason: newCode.reason || null,
        email_lock: newCode.email_lock.trim() || null,
      });
      toast.success("Code created");
      setNewCode({ code: "", duration_days: 30, max_uses: "1", reason: "", email_lock: "" });
      await refresh();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed");
    } finally {
      setCreating(false);
    }
  }

  async function openHistory(c: AccessCode) {
    setHistoryCode(c);
    setHistoryLoading(true);
    try {
      const res = await invoke<{ redemptions: Redemption[] }>("list_redemptions", { access_code_id: c.id });
      setHistoryRows(res.redemptions ?? []);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to load history");
    } finally {
      setHistoryLoading(false);
    }
  }

  async function toggleCode(c: AccessCode) {
    try {
      await invoke(c.active ? "deactivate_code" : "activate_code", { id: c.id });
      await refresh();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed");
    }
  }

  async function grantComp(e: React.FormEvent) {
    e.preventDefault();
    if (!grant.organization_id.trim()) return;
    setGranting(true);
    try {
      await invoke("grant_comp", {
        organization_id: grant.organization_id.trim(),
        duration_days: Number(grant.duration_days),
        reason: grant.reason || "Manual grant",
      });
      toast.success("Comp granted");
      setGrant({ organization_id: "", duration_days: 30, reason: "" });
      await refresh();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed");
    } finally {
      setGranting(false);
    }
  }

  async function revokeComp(id: string) {
    if (!(await confirmDialog("Revoke this comped access grant?"))) return;
    try {
      await invoke("revoke_comp", { id });
      toast.success("Revoked");
      await refresh();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed");
    }
  }

  const activeComps = comps.filter((c) => !c.revoked_at && new Date(c.expires_at) > new Date());
  const inactiveComps = comps.filter((c) => c.revoked_at || new Date(c.expires_at) <= new Date());

  return (
    <AdminLayout title="Access Codes" subtitle="Grant time-limited comped access">
      <div className="portal-v2 portal-v2-scroll">
        <SEOHead title="Access Codes | TidyWise" description="Manage comped access" noIndex />

        <div className="mx-auto max-w-5xl space-y-6">
          {/* Create Code */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Plus className="h-4 w-4" /> Create redeemable code
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={createCode} className="grid gap-3 sm:grid-cols-5">
                <div className="sm:col-span-2">
                  <Label className="text-xs">Code (blank = random)</Label>
                  <Input
                    value={newCode.code}
                    onChange={(e) => setNewCode({ ...newCode, code: e.target.value.toUpperCase() })}
                    placeholder="TIDY30DAYS"
                  />
                </div>
                <div>
                  <Label className="text-xs">Days</Label>
                  <Input
                    type="number"
                    min={1}
                    value={newCode.duration_days}
                    onChange={(e) => setNewCode({ ...newCode, duration_days: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <Label className="text-xs">Max uses (default 1, type "unlimited" for ∞)</Label>
                  <Input
                    value={newCode.max_uses}
                    onChange={(e) => setNewCode({ ...newCode, max_uses: e.target.value })}
                    placeholder="1"
                  />
                </div>
                <div className="flex items-end">
                  <Button type="submit" disabled={creating} className="w-full">
                    {creating ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                    Create
                  </Button>
                </div>
                <div className="sm:col-span-3">
                  <Label className="text-xs">Bind to email (optional — only this account can redeem)</Label>
                  <Input
                    type="email"
                    value={newCode.email_lock}
                    onChange={(e) => setNewCode({ ...newCode, email_lock: e.target.value })}
                    placeholder="customer@example.com"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label className="text-xs">Reason / note</Label>
                  <Input
                    value={newCode.reason}
                    onChange={(e) => setNewCode({ ...newCode, reason: e.target.value })}
                    placeholder="Podcast promo, refund, etc."
                  />
                </div>
              </form>
            </CardContent>
          </Card>

          {/* Direct grant */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Gift className="h-4 w-4" /> Grant comp directly to an org
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={grantComp} className="grid gap-3 sm:grid-cols-5">
                <div className="sm:col-span-2">
                  <Label className="text-xs">Organization ID</Label>
                  <Input
                    value={grant.organization_id}
                    onChange={(e) => setGrant({ ...grant, organization_id: e.target.value })}
                    placeholder="uuid"
                  />
                </div>
                <div>
                  <Label className="text-xs">Days</Label>
                  <Input
                    type="number"
                    min={1}
                    value={grant.duration_days}
                    onChange={(e) => setGrant({ ...grant, duration_days: Number(e.target.value) })}
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label className="text-xs">Reason</Label>
                  <Input
                    value={grant.reason}
                    onChange={(e) => setGrant({ ...grant, reason: e.target.value })}
                    placeholder="Manual grant"
                  />
                </div>
                <div className="sm:col-span-5 flex justify-end">
                  <Button type="submit" disabled={granting}>
                    {granting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                    Grant
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {/* Codes table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Codes</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : codes.length === 0 ? (
                <p className="text-sm text-muted-foreground">No codes yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Code</TableHead>
                        <TableHead>Days</TableHead>
                        <TableHead>Uses</TableHead>
                        <TableHead>Bound to</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {codes.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell className="font-mono">
                            <button
                              className="inline-flex items-center gap-1 hover:underline"
                              onClick={() => {
                                navigator.clipboard.writeText(c.code);
                                toast.success("Copied");
                              }}
                            >
                              {c.code} <Copy className="h-3 w-3" />
                            </button>
                          </TableCell>
                          <TableCell>{c.duration_days}</TableCell>
                          <TableCell>
                            {c.uses}
                            {c.max_uses != null ? ` / ${c.max_uses}` : " / ∞"}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {c.email_lock ?? <span className="italic">anyone</span>}
                          </TableCell>
                          <TableCell>
                            {c.active ? (
                              <Badge variant="secondary">Active</Badge>
                            ) : (
                              <Badge variant="outline">Inactive</Badge>
                            )}
                          </TableCell>
                          <TableCell className="max-w-xs truncate text-xs text-muted-foreground">
                            {c.reason ?? "—"}
                          </TableCell>
                          <TableCell className="flex gap-1">
                            <Button size="sm" variant="ghost" onClick={() => openHistory(c)} title="Redemption history">
                              <History className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => toggleCode(c)}>
                              {c.active ? <Ban className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Active comps */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Active comps <span className="text-muted-foreground">({activeComps.length})</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {activeComps.length === 0 ? (
                <p className="text-sm text-muted-foreground">None active.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Organization</TableHead>
                        <TableHead>Owner</TableHead>
                        <TableHead>Expires</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activeComps.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell>
                            <div className="font-medium">{c.organizations?.name ?? "—"}</div>
                            <div className="font-mono text-xs text-muted-foreground">
                              {c.organization_id}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{c.owner_email ?? "—"}</TableCell>
                          <TableCell>{new Date(c.expires_at).toLocaleString()}</TableCell>
                          <TableCell className="text-xs">
                            {c.access_codes?.code ? (
                              <Badge variant="outline" className="font-mono">
                                {c.access_codes.code}
                              </Badge>
                            ) : (
                              "Direct"
                            )}
                          </TableCell>
                          <TableCell className="max-w-xs truncate text-xs text-muted-foreground">
                            {c.reason ?? "—"}
                          </TableCell>
                          <TableCell>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => revokeComp(c.id)}
                              className="text-destructive"
                            >
                              <Ban className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* History */}
          {inactiveComps.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base text-muted-foreground">
                  History <span>({inactiveComps.length})</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Org</TableHead>
                        <TableHead>Expired/Revoked</TableHead>
                        <TableHead>Reason</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {inactiveComps.slice(0, 50).map((c) => (
                        <TableRow key={c.id}>
                          <TableCell className="text-xs">
                            {c.organizations?.name ?? c.organization_id}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {c.revoked_at
                              /* eslint-disable-next-line local/no-device-local-dates -- viewer-local display of a stored instant (billing/subscription/audit date), not a business-day boundary; see src/lib/orgDateRange.ts */
                              ? `Revoked ${new Date(c.revoked_at).toLocaleDateString()}`
                              /* eslint-disable-next-line local/no-device-local-dates -- viewer-local display of a stored instant (billing/subscription/audit date), not a business-day boundary; see src/lib/orgDateRange.ts */
                              : `Expired ${new Date(c.expires_at).toLocaleDateString()}`}
                          </TableCell>
                          <TableCell className="max-w-xs truncate text-xs text-muted-foreground">
                            {c.reason ?? "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <Dialog open={!!historyCode} onOpenChange={(o) => !o && setHistoryCode(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                Redemptions for <span className="font-mono">{historyCode?.code}</span>
              </DialogTitle>
            </DialogHeader>
            {historyLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : historyRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">Not yet redeemed.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Organization</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {historyRows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-xs">{new Date(r.redeemed_at).toLocaleString()}</TableCell>
                        <TableCell className="text-xs">{r.email ?? "—"}</TableCell>
                        <TableCell className="text-xs">{r.organizations?.name ?? r.organization_id}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </AdminLayout>
  );
}
