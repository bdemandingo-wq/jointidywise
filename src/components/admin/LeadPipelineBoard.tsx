import { useOrganization } from '@/contexts/OrganizationContext';
import { useOrgMemberNames, initialsOf } from '@/hooks/useOrgMemberNames';
import { useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Mail, Phone, MoreHorizontal, UserPlus, Edit, Trash2, GripVertical, Clock, Plus } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useIsMobile } from '@/hooks/use-mobile';
import { LeadTagChip, normalizeTags } from '@/components/admin/LeadTagsEditor';
import { useLeadPipelineStages, type LeadPipelineStage } from '@/hooks/useLeadPipelineStages';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { confirmDialog } from "@/components/AppDialogs";

interface Lead {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  service_interest: string | null;
  message: string | null;
  notes: string | null;
  estimated_value: number | null;
  source: string;
  status: string;
  created_at: string;
  /**
   * Who last updated this row, set by a database trigger from auth.uid() —
   * not by the call sites, of which there are four and counting.
   *
   * Null on any write with no authenticated user behind it (service-role
   * inserts, backfills, anything pre-trigger). Null renders as no initials
   * rather than as a guess.
   *
   * Last toucher only. This is not history: an update overwrites it, and
   * nothing records what changed or what it was before.
   */
  updated_by?: string | null;
  tags?: unknown;
}

const PIPELINE_COLUMNS = [
  { id: 'new', label: 'New', color: 'bg-info', borderColor: 'border-t-info' },
  { id: 'follow_up', label: 'Follow Up', color: 'bg-warning', borderColor: 'border-t-warning' },
  { id: 'quoted', label: 'Quoted', color: 'bg-purple-500', borderColor: 'border-t-purple-500' },
  { id: 'converted', label: 'Converted', color: 'bg-success', borderColor: 'border-t-success' },
  { id: 'lost', label: 'Lost', color: 'bg-destructive', borderColor: 'border-t-destructive' },
];

interface LeadPipelineBoardProps {
  leads: Lead[];
  onStatusChange: (leadId: string, newStatus: string) => void;
  onEdit: (lead: Lead) => void;
  onDelete: (leadId: string) => void;
  onConvert: (lead: Lead) => void;
  maskName: (name: string) => string;
  maskEmail: (email: string) => string;
  maskPhone: (phone: string) => string;
}

export function LeadPipelineBoard({
  leads,
  onStatusChange,
  onEdit,
  onDelete,
  onConvert,
  maskName,
  maskEmail,
  maskPhone,
}: LeadPipelineBoardProps) {
  const isMobile = useIsMobile();
  // Resolved once for the whole board. Calling this inside LeadCard would fire
  // one RPC per card, and a busy pipeline renders dozens.
  const { organization } = useOrganization();
  const memberNames = useOrgMemberNames(organization?.id);
  const [draggedLeadId, setDraggedLeadId] = useState<string | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);

  // Custom, org-scoped sections the user creates ("+ Add section"). They sit
  // after the five built-in stages and store their key in leads.status.
  const { stages, addStage, renameStage, deleteStage } = useLeadPipelineStages();
  const [sectionDialog, setSectionDialog] = useState<
    { mode: 'create' } | { mode: 'rename'; id: string; label: string } | null
  >(null);
  const [sectionName, setSectionName] = useState('');

  type BoardColumn = {
    id: string;
    label: string;
    color: string;
    borderColor: string;
    custom?: LeadPipelineStage;
  };

  const columns: BoardColumn[] = [
    ...PIPELINE_COLUMNS,
    ...stages.map((s) => ({
      id: s.key,
      label: s.label,
      color: 'bg-primary',
      borderColor: 'border-t-primary',
      custom: s,
    })),
  ];

  const submitSection = async () => {
    const label = sectionName.trim();
    if (!label) return;
    try {
      if (sectionDialog?.mode === 'rename') {
        await renameStage.mutateAsync({ id: sectionDialog.id, label });
        toast.success('Section renamed');
      } else {
        await addStage.mutateAsync(label);
        toast.success('Section added');
      }
      setSectionDialog(null);
      setSectionName('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save section');
    }
  };

  const getColumnLeads = useCallback(
    (status: string) => {
      return leads.filter((l) => l.status === status);
    },
    [leads]
  );

  const handleDragStart = (e: React.DragEvent, leadId: string) => {
    setDraggedLeadId(leadId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', leadId);
  };

  const handleDragOver = (e: React.DragEvent, columnId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColumn(columnId);
  };

  // Only clear the highlight when the pointer actually leaves the column.
  // Without the containment check, moving across a child card fires dragleave
  // and the drop zone flickers off mid-drag.
  const handleDragLeave = (e: React.DragEvent) => {
    const next = e.relatedTarget as Node | null;
    if (next && e.currentTarget.contains(next)) return;
    setDragOverColumn(null);
  };


  const handleDrop = (e: React.DragEvent, columnId: string) => {
    e.preventDefault();
    const leadId = e.dataTransfer.getData('text/plain');
    if (leadId && columnId) {
      const lead = leads.find(l => l.id === leadId);
      if (lead && lead.status !== columnId) {
        onStatusChange(leadId, columnId);
      }
    }
    setDraggedLeadId(null);
    setDragOverColumn(null);
  };

  const handleDragEnd = () => {
    setDraggedLeadId(null);
    setDragOverColumn(null);
  };

  const totalValue = leads.length;

  return (
    <div className="flex items-start gap-3 overflow-x-auto pb-4 snap-x snap-mandatory md:snap-none" data-no-swipe>
      {columns.map((column) => {
        const columnLeads = getColumnLeads(column.id);
        const isDragOver = dragOverColumn === column.id;

        return (
          <div
            key={column.id}
            className="flex-shrink-0 w-[250px] snap-start"
            onDragOver={(e) => handleDragOver(e, column.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, column.id)}
          >
            {/* Column header card. Fixed height so every column — built-in or
                custom (which carries an extra options button) — matches. */}
            <div className={`rounded-[14px] border border-t-[3px] ${column.borderColor} bg-card px-[14px] h-[46px] flex items-center`}>
              <div className="flex items-center justify-between w-full min-w-0">

                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-extrabold truncate">{column.label}</span>
                  <Badge variant="secondary" className="text-xs h-5 px-1.5">
                    {columnLeads.length}
                  </Badge>
                </div>
                <div className="flex items-center gap-1">
                  {(() => {
                    const total = columnLeads.reduce((sum, l) => sum + (l.estimated_value || 0), 0);
                    return total > 0 ? (
                      <span className="text-[12px] font-extrabold text-success">
                        ${total.toLocaleString()}
                      </span>
                    ) : null;
                  })()}
                  {column.custom && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-5 w-5 -mr-1.5" aria-label={`${column.label} section options`}>
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => {
                            setSectionName(column.label);
                            setSectionDialog({ mode: 'rename', id: column.custom!.id, label: column.label });
                          }}
                        >
                          <Edit className="h-4 w-4 mr-2" /> Rename section
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={async () => {
                            try {
                              await deleteStage.mutateAsync(column.custom!);
                              toast.success('Section removed. Its leads moved back to New.');
                            } catch (e) {
                              toast.error(e instanceof Error ? e.message : 'Could not remove section');
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4 mr-2" /> Delete section
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </div>
            </div>

            {/* Column Body */}
            <div 
              className={`mt-2.5 space-y-2.5 min-h-[160px] rounded-[14px] transition-colors ${
                isDragOver ? 'bg-primary/5 ring-1 ring-primary/30' : ''
              }`}
            >
              {columnLeads.length === 0 && (
                <div className="flex items-center justify-center h-[88px] text-sm text-muted-foreground/70 italic">
                  {isDragOver ? 'Drop here' : 'No leads'}
                </div>
              )}

              {columnLeads.map((lead) => (
                <LeadCard
                  key={lead.id}
                  lead={lead}
                  isDragging={draggedLeadId === lead.id}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onConvert={onConvert}
                  memberNames={memberNames}
                  maskName={maskName}
                  maskEmail={maskEmail}
                  maskPhone={maskPhone}
                  showDelete={true}
                />
              ))}
            </div>
          </div>
        );
      })}

      {/* Add a custom section */}
      <div className="flex-shrink-0 w-[250px] snap-start">
        <Button
          variant="outline"
          className="w-full justify-center rounded-[14px] border-dashed h-[46px] text-[13px] font-semibold"
          onClick={() => {
            setSectionName('');
            setSectionDialog({ mode: 'create' });
          }}
        >
          <Plus className="h-4 w-4 mr-2" /> Add section
        </Button>
      </div>

      <Dialog
        open={!!sectionDialog}
        onOpenChange={(open) => {
          if (!open) {
            setSectionDialog(null);
            setSectionName('');
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {sectionDialog?.mode === 'rename' ? 'Rename section' : 'New pipeline section'}
            </DialogTitle>
            <DialogDescription>
              Name it whatever you like — you can drag leads straight into it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="pipeline-section-name">Section name</Label>
            <Input
              id="pipeline-section-name"
              value={sectionName}
              onChange={(e) => setSectionName(e.target.value)}
              placeholder="e.g. Commercial, Waiting on Quote, VIP"
              maxLength={40}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  submitSection();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSectionDialog(null)}>
              Cancel
            </Button>
            <Button
              onClick={submitSection}
              disabled={!sectionName.trim() || addStage.isPending || renameStage.isPending}
            >
              {sectionDialog?.mode === 'rename' ? 'Save' : 'Add section'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LeadCard({
  lead,
  memberNames,
  isDragging,
  onDragStart,
  onDragEnd,
  onEdit,
  onDelete,
  onConvert,
  maskName,
  maskEmail,
  maskPhone,
  showDelete,
}: {
  lead: Lead;
  memberNames: Record<string, string>;
  isDragging: boolean;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onDragEnd: () => void;
  onEdit: (lead: Lead) => void;
  onDelete: (id: string) => void;
  onConvert: (lead: Lead) => void;
  maskName: (name: string) => string;
  maskEmail: (email: string) => string;
  maskPhone: (phone: string) => string;
  showDelete: boolean;
}) {
  return (
    <Card
      draggable
      onDragStart={(e) => onDragStart(e, lead.id)}
      onDragEnd={onDragEnd}
      /* Mockup 8h: radius 14px, padding 13/15. */
      className={`rounded-[14px] cursor-grab active:cursor-grabbing transition-all ${
        isDragging ? 'opacity-40 scale-95' : 'hover:shadow-md'
      }`}
    >
      <CardContent className="px-[15px] py-[13px] space-y-2">
        {/* Header: Name + Actions */}
        <div className="flex items-start justify-between gap-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <GripVertical className="w-3.5 h-3.5 text-muted-foreground/50 flex-shrink-0" />
            <span className="text-[13px] font-extrabold truncate">{maskName(lead.name)}</span>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6 flex-shrink-0">
                <MoreHorizontal className="w-3.5 h-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem className="gap-2" onClick={() => onEdit(lead)}>
                <Edit className="w-3.5 h-3.5" /> Edit
              </DropdownMenuItem>
              {lead.status !== 'converted' && (
                <DropdownMenuItem className="gap-2" onClick={() => onConvert(lead)}>
                  <UserPlus className="w-3.5 h-3.5" /> Convert to Customer
                </DropdownMenuItem>
              )}
              {showDelete && (
                <DropdownMenuItem
                  className="gap-2 text-destructive"
                  onClick={() => {
                    void confirmDialog('Delete this lead?').then((ok) => { if (ok) onDelete(lead.id); });
                  }}
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Contact Info */}
        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Mail className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">{lead.email ? maskEmail(lead.email) : 'No email'}</span>
          </div>
          {lead.phone && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Phone className="w-3 h-3 flex-shrink-0" />
              <span>{maskPhone(lead.phone)}</span>
            </div>
          )}
        </div>

        {/* Service Interest */}
        {lead.service_interest && (
          <Badge variant="outline" className="text-xs h-5 font-normal">
            {lead.service_interest}
          </Badge>
        )}

        {/* Tags */}
        {(() => {
          const tags = normalizeTags(lead.tags);
          if (tags.length === 0) return null;
          return (
            <div className="flex flex-wrap gap-1">
              {tags.map((t, i) => (
                <LeadTagChip key={`${t.name}-${i}`} tag={t} />
              ))}
            </div>
          );
        })()}

        {/* Estimated Value */}
        {lead.estimated_value != null && lead.estimated_value > 0 && (
          <p className="text-xs font-semibold text-success">
            ${lead.estimated_value.toLocaleString()}
          </p>
        )}

        {/* Notes preview */}
        {lead.notes && (
          <p className="text-xs text-muted-foreground line-clamp-2 italic">
            {lead.notes}
          </p>
        )}

        {/* Footer: Source + last toucher + Time */}
        <div className="flex items-center justify-between pt-1 border-t">
          <Badge variant="secondary" className="text-[10px] h-4 px-1 capitalize">
            {lead.source}
          </Badge>
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            {/* Initials, no colour: the column headers already carry stage
                through colour and a second colour axis would compete with it.
                Rendered only when the name resolves — a lead last touched by an
                automated write has no human actor, and a placeholder would read
                as one. */}
            {initialsOf(memberNames[lead.updated_by ?? '']) && (
              <span
                className="font-medium tracking-wide"
                title={`Last updated by ${memberNames[lead.updated_by ?? '']}`}
              >
                {initialsOf(memberNames[lead.updated_by ?? ''])}
              </span>
            )}
            <Clock className="w-2.5 h-2.5" />
            {formatDistanceToNow(new Date(lead.created_at), { addSuffix: true })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
