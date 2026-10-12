import { useEffect, useMemo, useState } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { promptDialog } from '@/components/AppDialogs';
import { Separator } from '@/components/ui/separator';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Mail, Save, Loader2, Info, Eye, Send, AlertCircle,
  Bold, Italic, Heading2, Heading3, List, ListOrdered,
  Link as LinkIcon, Undo, Redo, Plus, Trash2, ChevronUp, ChevronDown, RotateCcw,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import {
  type EmailSection, type EmailSectionKey,
  SECTION_META, TEMPLATE_VARIABLES,
  defaultConfirmationSections, defaultReminderSections,
  migratePlainTextToSections, normalizeSections,
  sanitizeSectionHtml, sanitizeSections, newSection,
} from '@/lib/emailTemplates';

interface EmailTemplatesSettingsProps {
  organizationId?: string;
  confirmationEmailSubject: string;
  confirmationEmailBody: string;
  reminderEmailSubject: string;
  reminderEmailBody: string;
  confirmationEmailSections?: EmailSection[] | null;
  reminderEmailSections?: EmailSection[] | null;
  onUpdate: (field: string, value: unknown) => void;
  onSave: () => void;
  saving: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────

function RichEditor({ value, onChange }: { value: string; onChange: (html: string) => void }) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      Link.configure({ openOnClick: false, HTMLAttributes: { rel: 'noopener noreferrer' } }),
    ],
    content: value || '<p></p>',
    editorProps: {
      attributes: {
        class:
          'prose prose-sm max-w-none focus:outline-none min-h-[140px] p-3 email-editor-content',
      },
    },
    onUpdate: ({ editor }) => onChange(sanitizeSectionHtml(editor.getHTML())),
  });

  // Keep external value in sync when reset-to-default overwrites it.
  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    if (value && value !== current) editor.commands.setContent(value, { emitUpdate: false });
  }, [value, editor]);

  if (!editor) return null;

  const addLink = () => {
    const previous = editor.getAttributes('link').href as string | undefined;
    void promptDialog('Enter URL (https://…)', previous || 'https://').then((url) => {
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    if (!/^(https?:|mailto:|tel:)/i.test(url)) {
      toast.error('Links must start with https://, mailto:, or tel:');
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    });
  };

  return (
    <div className="border border-input rounded-md bg-background">
      <ToolbarRow editor={editor} onAddLink={addLink} />
      <EditorContent editor={editor} />
    </div>
  );
}

function ToolbarRow({ editor, onAddLink }: { editor: Editor; onAddLink: () => void }) {
  const Btn = ({
    active, onClick, title, children,
  }: { active?: boolean; onClick: () => void; title: string; children: React.ReactNode }) => (
    <Button
      type="button"
      size="sm"
      variant={active ? 'secondary' : 'ghost'}
      className="h-8 w-8 p-0"
      onClick={onClick}
      title={title}
    >{children}</Button>
  );
  return (
    <div className="flex flex-wrap items-center gap-0.5 p-1.5 border-b bg-muted/40">
      <Btn active={editor.isActive('paragraph')} onClick={() => editor.chain().focus().setParagraph().run()} title="Paragraph">
        <span className="text-xs font-semibold">P</span>
      </Btn>
      <Btn active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Heading 2">
        <Heading2 className="h-4 w-4" />
      </Btn>
      <Btn active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="Heading 3">
        <Heading3 className="h-4 w-4" />
      </Btn>
      <Separator orientation="vertical" className="mx-1 h-5" />
      <Btn active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold"><Bold className="h-4 w-4" /></Btn>
      <Btn active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic"><Italic className="h-4 w-4" /></Btn>
      <Separator orientation="vertical" className="mx-1 h-5" />
      <Btn active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bulleted list"><List className="h-4 w-4" /></Btn>
      <Btn active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered list"><ListOrdered className="h-4 w-4" /></Btn>
      <Separator orientation="vertical" className="mx-1 h-5" />
      <Btn active={editor.isActive('link')} onClick={onAddLink} title="Link"><LinkIcon className="h-4 w-4" /></Btn>
      <div className="ml-auto flex gap-0.5">
        <Btn onClick={() => editor.chain().focus().undo().run()} title="Undo"><Undo className="h-4 w-4" /></Btn>
        <Btn onClick={() => editor.chain().focus().redo().run()} title="Redo"><Redo className="h-4 w-4" /></Btn>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function SectionCard({
  section, index, total, onUpdate, onRemove, onMove,
}: {
  section: EmailSection;
  index: number;
  total: number;
  onUpdate: (patch: Partial<EmailSection>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const meta = SECTION_META.find((m) => m.key === section.key);
  return (
    <div className={`rounded-lg border ${section.enabled ? 'bg-card' : 'bg-muted/30 opacity-70'}`}>
      <div className="flex items-center gap-2 p-3 border-b">
        <div className="flex flex-col">
          <Button type="button" variant="ghost" size="sm" className="h-5 w-5 p-0" disabled={index === 0} onClick={() => onMove(-1)} title="Move up">
            <ChevronUp className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" variant="ghost" size="sm" className="h-5 w-5 p-0" disabled={index === total - 1} onClick={() => onMove(1)} title="Move down">
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] uppercase tracking-wide">{meta?.label ?? section.key}</Badge>
            <span className="text-xs text-muted-foreground truncate">{meta?.description}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Label htmlFor={`enabled-${section.id}`} className="text-xs text-muted-foreground">Show</Label>
          <Switch
            id={`enabled-${section.id}`}
            checked={section.enabled}
            onCheckedChange={(v) => onUpdate({ enabled: v })}
          />
          <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive" onClick={onRemove} title="Remove section">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="p-3 space-y-3">
        <div className="space-y-1">
          <Label className="text-xs">Heading (optional)</Label>
          <Input
            value={section.title}
            onChange={(e) => onUpdate({ title: e.target.value })}
            placeholder="e.g. Before we arrive"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Content</Label>
          <RichEditor value={section.html} onChange={(html) => onUpdate({ html })} />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface PreviewResult { subject: string; html: string; from: string; replyTo: string }

function EmailPreviewDialog({
  organizationId, templateType, subject, sections,
}: {
  organizationId?: string;
  templateType: 'confirmation' | 'reminder';
  subject: string;
  sections: EmailSection[];
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PreviewResult | null>(null);

  const load = async () => {
    if (!organizationId) { setError('Organization not loaded yet.'); return; }
    setLoading(true); setError(null); setResult(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('preview-org-email', {
        body: { organizationId, templateType, subject, sections: sanitizeSections(sections) },
      });
      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);
      setResult(data as PreviewResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to render preview');
    } finally { setLoading(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) load(); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2"><Eye className="w-4 h-4" />Preview Email</Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl h-[85vh] flex flex-col">
        <DialogHeader><DialogTitle>Email Preview</DialogTitle></DialogHeader>
        {loading && (
          <div className="flex-1 flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />Rendering with your branding…
          </div>
        )}
        {error && (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
            <AlertCircle className="w-8 h-8 text-destructive" />
            <p className="text-sm text-destructive font-medium">{error}</p>
            <Button size="sm" variant="outline" onClick={load}>Retry</Button>
          </div>
        )}
        {result && !loading && !error && (
          <div className="flex-1 flex flex-col min-h-0 gap-2">
            <div className="border rounded-md px-3 py-2 bg-muted/40 text-xs space-y-0.5 shrink-0">
              <div><span className="text-muted-foreground">From:</span> <span className="font-medium">{result.from}</span></div>
              <div><span className="text-muted-foreground">Reply-To:</span> <span className="font-medium">{result.replyTo}</span></div>
              <div><span className="text-muted-foreground">Subject:</span> <span className="font-semibold">{result.subject}</span></div>
            </div>
            <iframe title="Email preview" srcDoc={result.html} className="flex-1 w-full rounded-md border bg-white" sandbox="" />
            <p className="text-xs text-muted-foreground text-center shrink-0">
              This is the exact HTML your customers will receive.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SendTestButton({
  organizationId, templateType, subject, sections,
}: {
  organizationId?: string;
  templateType: 'confirmation' | 'reminder';
  subject: string;
  sections: EmailSection[];
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!organizationId) { toast.error('Organization not loaded yet.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast.error('Enter a valid email address'); return; }
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-test-org-email', {
        body: { organizationId, templateType, toEmail: email, subject, sections: sanitizeSections(sections) },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`Test sent via ${data.method}. Check ${email}.`);
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to send test');
    } finally { setSending(false); }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2"><Send className="w-4 h-4" />Send Test</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Send Test Email</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Sent using your organization's From address so you can verify the real experience.</p>
          <div className="space-y-1">
            <Label htmlFor="test-email">Send to</Label>
            <Input id="test-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" disabled={sending} />
          </div>
          <Button onClick={send} disabled={sending} className="w-full gap-2">
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {sending ? 'Sending…' : 'Send Test'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function TemplateEditor({
  organizationId, templateType, subject, sections, plainBody,
  onSubjectChange, onSectionsChange,
}: {
  organizationId?: string;
  templateType: 'confirmation' | 'reminder';
  subject: string;
  sections: EmailSection[];
  plainBody: string;
  onSubjectChange: (s: string) => void;
  onSectionsChange: (s: EmailSection[]) => void;
}) {
  const resetDefaults = () => {
    const fresh = templateType === 'confirmation' ? defaultConfirmationSections() : defaultReminderSections();
    onSectionsChange(fresh);
    toast.success('Restored the branded default template');
  };

  const addSection = (key: EmailSectionKey) => {
    const next = [...sections, { ...newSection(key), order: sections.length }];
    onSectionsChange(next);
  };

  const updateSection = (id: string, patch: Partial<EmailSection>) => {
    onSectionsChange(sections.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const removeSection = (id: string) => {
    onSectionsChange(sections.filter((s) => s.id !== id).map((s, i) => ({ ...s, order: i })));
  };

  const moveSection = (id: string, dir: -1 | 1) => {
    const idx = sections.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const next = [...sections];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    onSectionsChange(next.map((s, i) => ({ ...s, order: i })));
  };

  // Sections already-used keys (to hint the "Add section" menu)
  const usedKeys = useMemo(() => new Set(sections.map((s) => s.key)), [sections]);
  const missing = SECTION_META.filter((m) => m.key !== 'custom' && !usedKeys.has(m.key));

  return (
    <div className="space-y-4 mt-4">
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" size="sm" className="gap-2" onClick={resetDefaults} title="Restore branded default template">
          <RotateCcw className="w-4 h-4" />Reset to Branded Default
        </Button>
        <SendTestButton organizationId={organizationId} templateType={templateType} subject={subject} sections={sections} />
        <EmailPreviewDialog organizationId={organizationId} templateType={templateType} subject={subject} sections={sections} />
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${templateType}-subject`}>Subject line</Label>
        <Input
          id={`${templateType}-subject`}
          value={subject}
          onChange={(e) => onSubjectChange(e.target.value)}
          placeholder={templateType === 'confirmation'
            ? 'Your Booking Confirmation - {{booking_number}}'
            : 'Reminder: {{service_name}} on {{scheduled_date}}'}
        />
      </div>

      <div className="space-y-3">
        {sections.map((s, i) => (
          <SectionCard
            key={s.id}
            section={s}
            index={i}
            total={sections.length}
            onUpdate={(patch) => updateSection(s.id, patch)}
            onRemove={() => removeSection(s.id)}
            onMove={(dir) => moveSection(s.id, dir)}
          />
        ))}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2"><Plus className="w-4 h-4" />Add section</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          {missing.map((m) => (
            <DropdownMenuItem key={m.key} onClick={() => addSection(m.key)}>
              <div className="flex flex-col">
                <span className="font-medium">{m.label}</span>
                <span className="text-xs text-muted-foreground">{m.description}</span>
              </div>
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem onClick={() => addSection('custom')}>
            <div className="flex flex-col">
              <span className="font-medium">Custom section</span>
              <span className="text-xs text-muted-foreground">Anything you want to add</span>
            </div>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {plainBody && !sections.some((s) => s.key === 'intro' && s.enabled) && (
        <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
          Your previous plain-text template is preserved and won't be sent until you re-enable an intro section or reset to branded default.
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function EmailTemplatesSettings({
  organizationId,
  confirmationEmailSubject,
  confirmationEmailBody,
  reminderEmailSubject,
  reminderEmailBody,
  confirmationEmailSections,
  reminderEmailSections,
  onUpdate,
  onSave,
  saving,
}: EmailTemplatesSettingsProps) {
  const [activeTemplate, setActiveTemplate] = useState<'confirmation' | 'reminder'>('confirmation');

  // Seed sections from server value, or migrate from legacy plain text on first render.
  const confSections = useMemo<EmailSection[]>(() => {
    const norm = normalizeSections(confirmationEmailSections);
    if (norm && norm.length > 0) return norm;
    return migratePlainTextToSections(confirmationEmailBody, 'confirmation');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmationEmailSections]);

  const remSections = useMemo<EmailSection[]>(() => {
    const norm = normalizeSections(reminderEmailSections);
    if (norm && norm.length > 0) return norm;
    return migratePlainTextToSections(reminderEmailBody, 'reminder');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reminderEmailSections]);

  // Push the migrated sections up on mount if the server didn't have any yet — this
  // makes the first save persist them and future loads skip the migration step.
  useEffect(() => {
    if (!confirmationEmailSections || (Array.isArray(confirmationEmailSections) && confirmationEmailSections.length === 0)) {
      onUpdate('confirmation_email_sections', confSections);
    }
    if (!reminderEmailSections || (Array.isArray(reminderEmailSections) && reminderEmailSections.length === 0)) {
      onUpdate('reminder_email_sections', remSections);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Mail className="w-5 h-5" />Email Templates</CardTitle>
        <CardDescription>
          Rich-text editor with the same branded design used in real customer emails. Show, hide, reorder, and edit each section.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="p-4 rounded-lg bg-muted/40 border">
          <div className="flex items-center gap-2 mb-2">
            <Info className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium">Available variables</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {TEMPLATE_VARIABLES.map((v) => (
              <Badge key={v.key} variant="secondary" title={v.desc} className="font-mono text-[11px]">{v.key}</Badge>
            ))}
          </div>
        </div>

        <Tabs value={activeTemplate} onValueChange={(v) => setActiveTemplate(v as any)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="confirmation" className="gap-2"><Mail className="w-4 h-4" />Confirmation</TabsTrigger>
            <TabsTrigger value="reminder" className="gap-2"><Mail className="w-4 h-4" />Reminder</TabsTrigger>
          </TabsList>

          <TabsContent value="confirmation">
            <TemplateEditor
              organizationId={organizationId}
              templateType="confirmation"
              subject={confirmationEmailSubject}
              sections={confSections}
              plainBody={confirmationEmailBody}
              onSubjectChange={(s) => onUpdate('confirmation_email_subject', s)}
              onSectionsChange={(s) => onUpdate('confirmation_email_sections', s)}
            />
          </TabsContent>

          <TabsContent value="reminder">
            <TemplateEditor
              organizationId={organizationId}
              templateType="reminder"
              subject={reminderEmailSubject}
              sections={remSections}
              plainBody={reminderEmailBody}
              onSubjectChange={(s) => onUpdate('reminder_email_subject', s)}
              onSectionsChange={(s) => onUpdate('reminder_email_sections', s)}
            />
          </TabsContent>
        </Tabs>

        <Button className="gap-2" onClick={onSave} disabled={saving}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Templates
        </Button>
      </CardContent>
    </Card>
  );
}
