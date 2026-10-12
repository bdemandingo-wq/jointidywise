import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UserX, Send } from "lucide-react";
import { format } from "date-fns";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  useOptOutCustomerSearch,
  useOptedOutList,
  useSetOptOutStatus,
} from "@/hooks/useOptOuts";

/**
 * The "Opted Out" tab of the Campaigns page: the opted-out contact list
 * (mobile cards / desktop table) plus the manual opt-out search form.
 *
 * Extracted verbatim from CampaignsPage.tsx — markup, classes, copy, date
 * formats and the mobile/desktop split are unchanged.
 */

function ManualOptOutForm({
  orgId,
  isPending,
  onSubmit,
}: {
  orgId: string | null;
  isPending: boolean;
  onSubmit: (customerId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const { data: results = [], isError } = useOptOutCustomerSearch(orgId, search);

  return (
    <Card className="mt-4">
      <CardContent className="p-4 space-y-3">
        <div>
          <Label className="text-sm font-medium">Manually mark a contact as opted out</Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Search by name, phone, or email. They will be excluded from all future campaign sends.
          </p>
        </div>
        <Input
          placeholder="Search active contacts…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {results.length > 0 && (
          <div className="border rounded-lg divide-y">
            {results.map((c) => {
              const name = `${c.first_name || ''} ${c.last_name || ''}`.trim() || 'Unknown';
              return (
                <div key={c.id} className="flex items-center justify-between p-2.5 gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{name}</p>
                    <p className="text-xs text-muted-foreground truncate">{c.phone || c.email || '—'}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive border-destructive/30 hover:bg-destructive/10"
                    disabled={isPending}
                    onClick={() => { onSubmit(c.id); setSearch(""); }}
                  >
                    <UserX className="w-3.5 h-3.5 mr-1" /> Opt out
                  </Button>
                </div>
              );
            })}
          </div>
        )}
        {isError && (
          <p className="text-xs text-destructive">Could not search contacts. Try again.</p>
        )}
        {search.trim().length >= 2 && !isError && results.length === 0 && (
          <p className="text-xs text-muted-foreground">No active contacts match.</p>
        )}
      </CardContent>
    </Card>
  );
}

const optOutMethodLabel = (method: string | null) =>
  method === 'sms_stop' ? 'Replied STOP' : method === 'manual' ? 'Manual' : (method || 'Manual');

export function OptedOutPanel({
  orgId,
  campaignNameMap,
}: {
  orgId: string | null;
  campaignNameMap: Record<string, string>;
}) {
  const isMobile = useIsMobile();
  const { data: optedOutList = [] } = useOptedOutList(orgId);
  const setOptOutStatus = useSetOptOutStatus();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Opted-Out Contacts</h2>
          <p className="text-xs text-muted-foreground">
            These contacts replied STOP or were manually excluded — they will not receive any future campaign sends.
          </p>
        </div>
      </div>

      {optedOutList.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
              <UserX className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="font-semibold mb-1">No opted-out contacts</h3>
            <p className="text-sm text-muted-foreground">When customers reply STOP or are marked as opted out, they will appear here.</p>
          </CardContent>
        </Card>
      ) : isMobile ? (
        <div className="space-y-3">
          {optedOutList.map((c) => {
            const name = `${c.first_name || ''} ${c.last_name || ''}`.trim() || 'Unknown';
            const campaignName = c.opted_out_campaign_id ? campaignNameMap[c.opted_out_campaign_id] : null;
            return (
              <Card key={c.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm truncate">{name}</p>
                    <p className="text-xs text-muted-foreground">{c.phone || c.email || '—'}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <Badge variant="outline" className="text-[10px]">
                        {optOutMethodLabel(c.opted_out_method)}
                      </Badge>
                      {c.opted_out_at && (
                        <Badge variant="secondary" className="text-[10px]">
                          {format(new Date(c.opted_out_at), 'MMM d, yyyy')}
                        </Badge>
                      )}
                      {campaignName && (
                        <Badge variant="outline" className="text-[10px] gap-1">
                          <Send className="w-2.5 h-2.5" />{campaignName}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setOptOutStatus.mutate({ customerId: c.id, optedOut: false })}
                    disabled={setOptOutStatus.isPending}
                  >
                    Opt back in
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="bg-card rounded-xl border border-border shadow-sm overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contact</TableHead>
                <TableHead className="w-[180px]">Phone</TableHead>
                <TableHead className="w-[140px]">Date Opted Out</TableHead>
                <TableHead className="w-[140px]">Method</TableHead>
                <TableHead>Triggering Campaign</TableHead>
                <TableHead className="w-[140px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {optedOutList.map((c) => {
                const name = `${c.first_name || ''} ${c.last_name || ''}`.trim() || 'Unknown';
                const campaignName = c.opted_out_campaign_id ? campaignNameMap[c.opted_out_campaign_id] : null;
                return (
                  <TableRow key={c.id} className="hover:bg-muted/30">
                    <TableCell>
                      <p className="font-medium text-sm">{name}</p>
                      {c.email && <p className="text-xs text-muted-foreground">{c.email}</p>}
                    </TableCell>
                    <TableCell><span className="text-sm">{c.phone || '—'}</span></TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {c.opted_out_at ? format(new Date(c.opted_out_at), 'MMM d, yyyy') : '—'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {optOutMethodLabel(c.opted_out_method)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {campaignName ? (
                        <span className="text-sm">{campaignName}</span>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setOptOutStatus.mutate({ customerId: c.id, optedOut: false })}
                        disabled={setOptOutStatus.isPending}
                      >
                        Opt back in
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <ManualOptOutForm
        onSubmit={(customerId) => setOptOutStatus.mutate({ customerId, optedOut: true })}
        orgId={orgId}
        isPending={setOptOutStatus.isPending}
      />
    </div>
  );
}
