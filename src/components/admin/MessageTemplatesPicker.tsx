import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { FileText, Plus, Pencil, Trash2, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { confirmDialog } from "@/components/AppDialogs";

interface SmsTemplate {
  id: string;
  name: string;
  content: string;
  subject?: string | null;
}

interface MessageTemplatesPickerProps {
  organizationId: string;
  onSelect: (content: string, subject?: string | null) => void;
  showSubject?: boolean;
}

export function MessageTemplatesPicker({ organizationId, onSelect, showSubject = false }: MessageTemplatesPickerProps) {
  const [templates, setTemplates] = useState<SmsTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<SmsTemplate | null>(null);
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [subject, setSubject] = useState('');
  const [saving, setSaving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (organizationId) fetchTemplates();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchTemplates is recreated each render; runs once per org
  }, [organizationId]);

  const fetchTemplates = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('sms_templates')
      .select('id, name, content, subject')
      .eq('organization_id', organizationId)
      .order('name');
    setTemplates(data || []);
    setLoading(false);
  };

  const openCreate = () => {
    setEditingTemplate(null);
    setName('');
    setContent('');
    setSubject('');
    setDialogOpen(true);
    setMenuOpen(false);
  };

  const openEdit = (t: SmsTemplate, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingTemplate(t);
    setName(t.name);
    setContent(t.content);
    setSubject(t.subject || '');
    setDialogOpen(true);
    setMenuOpen(false);
  };

  const handleSave = async () => {
    if (!name.trim() || !content.trim()) return;
    setSaving(true);
    try {
      if (editingTemplate) {
        const { error } = await supabase
          .from('sms_templates')
          .update({ name: name.trim(), content: content.trim(), subject: subject.trim() || null })
          .eq('id', editingTemplate.id);
        if (error) throw error;
        toast.success('Template updated');
      } else {
        const { error } = await supabase
          .from('sms_templates')
          .insert({ organization_id: organizationId, name: name.trim(), content: content.trim(), subject: subject.trim() || null });
        if (error) throw error;
        toast.success('Template created');
      }
      setDialogOpen(false);
      fetchTemplates();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!(await confirmDialog('Delete this template?'))) return;
    const { error } = await supabase.from('sms_templates').delete().eq('id', id);
    if (error) {
      toast.error('Failed to delete');
    } else {
      toast.success('Template deleted');
      fetchTemplates();
    }
    setMenuOpen(false);
  };

  const handleSelect = (t: SmsTemplate) => {
    onSelect(t.content, t.subject);
    setMenuOpen(false);
  };

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" title="Message Templates">
            <FileText className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          {loading ? (
            <div className="flex items-center justify-center p-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : templates.length === 0 ? (
            <div className="p-3 text-center">
              <p className="text-sm text-muted-foreground mb-2">No templates yet</p>
              <Button size="sm" variant="outline" onClick={openCreate} className="gap-1">
                <Plus className="h-3 w-3" /> Create Template
              </Button>
            </div>
          ) : (
            <>
              {templates.map((t) => (
                <DropdownMenuItem
                  key={t.id}
                  className="flex items-start gap-2 cursor-pointer py-2"
                  onSelect={(e) => e.preventDefault()}
                  onClick={() => handleSelect(t)}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{t.name}</p>
                    <p className="text-xs text-muted-foreground line-clamp-2">{t.content}</p>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={(e) => openEdit(t, e)}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-destructive hover:text-destructive"
                      onClick={(e) => handleDelete(t.id, e)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={openCreate} className="gap-2 cursor-pointer">
                <Plus className="h-4 w-4" />
                New Template
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingTemplate ? 'Edit Template' : 'New Template'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Template Name</Label>
              <Input
                placeholder="e.g. Appointment Confirmation"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            {showSubject && (
              <div>
                <Label>Subject (for emails)</Label>
                <Input
                  placeholder="e.g. Welcome to our service!"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </div>
            )}
            <div>
              <Label>Message Content</Label>
              <Textarea
                placeholder="Type your template message..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={5}
                className="resize-none"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !name.trim() || !content.trim()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {editingTemplate ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
