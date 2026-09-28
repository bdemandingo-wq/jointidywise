import { useState, useEffect } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';

import { supabase } from '@/lib/supabase';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useOrgId } from '@/hooks/useOrgId';
import { useAuth } from '@/hooks/useAuth';
import { format } from 'date-fns';
import { 
  CalendarIcon, 
  Plus, 
  Trash2, 
  Circle, 
  StickyNote, 
  CalendarDays, 
  CalendarCheck,
  CalendarRange,
  Loader2,
  Pencil,
  Check,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { SortableTaskList } from '@/components/admin/tasks/SortableTaskList';
import { SEOHead } from '@/components/SEOHead';
import { AttentionStrip } from '@/components/admin/AttentionStrip';
import { orgDateKey } from '@/lib/orgDateRange';
import { useOrgTimezone } from '@/hooks/useOrgTimezone';
import { OrgTimestamp } from '@/components/OrgTimestamp';

type TaskType = 'daily' | 'weekly' | 'monthly' | 'note';

interface Task {
  id: string;
  organization_id: string;
  user_id: string;
  type: TaskType;
  content: string;
  is_completed: boolean;
  due_date: string | null;
  sort_order: number;
  last_reset_at: string | null;
  created_at: string;
  updated_at: string;
}

export default function TasksPage() {
  // Task resets and due dates are the business's calendar days.
  const { timezone: orgTimezone } = useOrgTimezone();
  const { organizationId } = useOrgId();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TaskType>('daily');
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newContent, setNewContent] = useState('');
  const [newDueDate, setNewDueDate] = useState<Date | undefined>();
  const [newType, setNewType] = useState<TaskType>('daily');

  // Fetch tasks
  const { data: tasks = [], isLoading, error: tasksError } = useQuery({
    queryKey: ['tasks-and-notes', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      
      // Written to last_reset_at and compared against it to decide whether
      // today's recurring tasks have been reset yet. The device's day resets
      // them on the wrong day for an admin outside the org's zone.
      const today = orgDateKey(new Date(), orgTimezone);
      await supabase
        .from('tasks_and_notes')
        .update({ is_completed: false, last_reset_at: today, updated_at: new Date().toISOString() })
        .eq('organization_id', organizationId)
        .eq('type', 'daily')
        .eq('is_completed', true)
        .lt('last_reset_at', today);
      
      const { data, error } = await supabase
        .from('tasks_and_notes')
        .select('*')
        .eq('organization_id', organizationId)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as Task[];
    },
    enabled: !!organizationId,
  });

  useEffect(() => {
    if (tasksError) toast.error('Failed to load tasks');
  }, [tasksError]);

  // Create task
  const createMutation = useMutation({
    mutationFn: async (task: { type: TaskType; content: string; due_date?: string }) => {
      if (!organizationId || !user) throw new Error('Missing context');
      const maxOrder = tasks.filter(t => t.type === task.type).reduce((max, t) => Math.max(max, t.sort_order || 0), 0);
      const { error } = await supabase
        .from('tasks_and_notes')
        .insert({
          organization_id: organizationId,
          user_id: user.id,
          type: task.type,
          content: task.content,
          due_date: task.due_date || null,
          sort_order: maxOrder + 1,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks-and-notes'] });
      setAddDialogOpen(false);
      setNewContent('');
      setNewDueDate(undefined);
      toast.success('Task added successfully');
    },
    onError: () => toast.error('Failed to add task'),
  });

  // Toggle complete
  const toggleMutation = useMutation({
    mutationFn: async ({ id, is_completed }: { id: string; is_completed: boolean }) => {
      const { error } = await supabase
        .from('tasks_and_notes')
        .update({ is_completed, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks-and-notes'] }),
  });

  // Delete task
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('tasks_and_notes').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['tasks-and-notes'] }); toast.success('Item deleted'); },
    onError: () => toast.error('Failed to delete item'),
  });

  // Edit task content
  const editMutation = useMutation({
    mutationFn: async ({ id, content }: { id: string; content: string }) => {
      const { error } = await supabase
        .from('tasks_and_notes')
        .update({ content, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['tasks-and-notes'] }); toast.success('Task updated'); },
    onError: () => toast.error('Failed to update task'),
  });

  // Bulk mark all incomplete tasks (any type) as complete
  const markAllCompleteMutation = useMutation({
    mutationFn: async () => {
      if (!organizationId) return 0;
      const ids = tasks.filter(t => !t.is_completed && t.type !== 'note').map(t => t.id);
      if (ids.length === 0) return 0;
      const { error } = await supabase
        .from('tasks_and_notes')
        .update({ is_completed: true, updated_at: new Date().toISOString() })
        .in('id', ids);
      if (error) throw error;
      return ids.length;
    },
    onSuccess: (n) => {
      queryClient.invalidateQueries({ queryKey: ['tasks-and-notes'] });
      queryClient.invalidateQueries({ queryKey: ['sb-tasks'] });
      if (n) toast.success(`Marked ${n} task${n === 1 ? '' : 's'} complete`);
    },
    onError: () => toast.error('Failed to mark tasks complete'),
  });

  // Reorder
  const reorderMutation = useMutation({
    mutationFn: async ({ activeId, overId }: { activeId: string; overId: string }) => {
      const filtered = tasks.filter(t => t.type === activeTab && !t.is_completed);
      const oldIndex = filtered.findIndex(t => t.id === activeId);
      const newIndex = filtered.findIndex(t => t.id === overId);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = [...filtered];
      const [moved] = reordered.splice(oldIndex, 1);
      reordered.splice(newIndex, 0, moved);

      const updates = reordered.map((task, i) => 
        supabase.from('tasks_and_notes').update({ sort_order: i, updated_at: new Date().toISOString() }).eq('id', task.id)
      );
      await Promise.all(updates);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks-and-notes'] }),
  });

  // Edit note content
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteValue, setEditingNoteValue] = useState('');

  const handleAddTask = () => {
    if (!newContent.trim()) { toast.error('Please enter content'); return; }
    createMutation.mutate({
      type: newType,
      content: newContent.trim(),
      /* eslint-disable-next-line local/no-device-local-dates -- newDueDate is a picker token: the calendar day chosen */
      due_date: newDueDate ? format(newDueDate, 'yyyy-MM-dd') : undefined,
    });
  };

  const filteredTasks = tasks.filter(task => task.type === activeTab);
  const incompleteTasks = filteredTasks.filter(t => !t.is_completed);
  const completedTasks = filteredTasks.filter(t => t.is_completed);

  const getTabIcon = (type: TaskType) => {
    switch (type) {
      case 'daily': return <CalendarDays className="w-4 h-4" />;
      case 'weekly': return <CalendarCheck className="w-4 h-4" />;
      case 'monthly': return <CalendarRange className="w-4 h-4" />;
      case 'note': return <StickyNote className="w-4 h-4" />;
    }
  };

  const getTabLabel = (type: TaskType) => {
    switch (type) {
      case 'daily': return 'Daily Tasks';
      case 'weekly': return 'Weekly Reminders';
      case 'monthly': return 'Monthly Tasks';
      case 'note': return 'General Notes';
    }
  };

  return (
    <AdminLayout 
      title="Tasks & Notes" 
      subtitle="Manage your reminders, tasks, and notes"
      actions={
        <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
      <SEOHead title="Tasks | TidyWise" description="Manage and assign tasks" noIndex />
          <DialogTrigger asChild>
            <Button className="gap-2"><Plus className="w-4 h-4" />Add New</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add New Item</DialogTitle></DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Type</Label>
                <div className="flex gap-2 flex-wrap">
                  {(['daily', 'weekly', 'monthly', 'note'] as TaskType[]).map(type => (
                    <Button key={type} variant={newType === type ? 'default' : 'outline'} size="sm" onClick={() => setNewType(type)} className="gap-2">
                      {getTabIcon(type)}
                      {type === 'daily' ? 'Daily' : type === 'weekly' ? 'Weekly' : type === 'monthly' ? 'Monthly' : 'Note'}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Content</Label>
                {newType === 'note' ? (
                  <Textarea placeholder="Write your note..." value={newContent} onChange={(e) => setNewContent(e.target.value)} rows={4} />
                ) : (
                  <Input placeholder={newType === 'daily' ? 'What needs to be done today?' : newType === 'weekly' ? 'Weekly reminder...' : 'Monthly task...'} value={newContent} onChange={(e) => setNewContent(e.target.value)} />
                )}
              </div>
              {newType !== 'note' && (
                <div className="space-y-2">
                  <Label>Due Date (optional)</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !newDueDate && "text-muted-foreground")}>
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {newDueDate ? format(newDueDate, 'PPP') : 'Pick a date'}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={newDueDate} onSelect={setNewDueDate} initialFocus />
                    </PopoverContent>
                  </Popover>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleAddTask} disabled={createMutation.isPending}>
                {createMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Add Item
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      }
    >
<div className="portal-v2 portal-v2-scroll">
      <div className="space-y-6">
        <AttentionStrip
          href="/dashboard/tasks"
          clearAction={{
            label: 'Mark all complete',
            disabled: markAllCompleteMutation.isPending || tasks.filter(t => !t.is_completed && t.type !== 'note').length === 0,
            onClick: () => markAllCompleteMutation.mutate(),
          }}
        />
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TaskType)}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="daily" className="gap-2">
              <CalendarDays className="w-4 h-4" />
              <span className="hidden sm:inline">Daily Tasks</span>
              <span className="sm:hidden">Daily</span>
            </TabsTrigger>
            <TabsTrigger value="weekly" className="gap-2">
              <CalendarCheck className="w-4 h-4" />
              <span className="hidden sm:inline">Weekly Reminders</span>
              <span className="sm:hidden">Weekly</span>
            </TabsTrigger>
            <TabsTrigger value="monthly" className="gap-2">
              <CalendarRange className="w-4 h-4" />
              <span className="hidden sm:inline">Monthly Tasks</span>
              <span className="sm:hidden">Monthly</span>
            </TabsTrigger>
            <TabsTrigger value="note" className="gap-2">
              <StickyNote className="w-4 h-4" />
              <span className="hidden sm:inline">General Notes</span>
              <span className="sm:hidden">Notes</span>
            </TabsTrigger>
          </TabsList>

          {(['daily', 'weekly', 'monthly', 'note'] as TaskType[]).map(type => (
            <TabsContent key={type} value={type} className="mt-6">
              {isLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </div>
              ) : type === 'note' ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {filteredTasks.length === 0 ? (
                    <Card className="col-span-full">
                      <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                        <StickyNote className="w-12 h-12 mb-4 opacity-50" />
                        <p>No notes yet</p>
                        <Button variant="link" onClick={() => { setNewType('note'); setAddDialogOpen(true); }}>Add your first note</Button>
                      </CardContent>
                    </Card>
                  ) : (
                    filteredTasks.map(note => (
                      <Card key={note.id} className="bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800">
                        <CardContent className="p-4">
                          <div className="flex justify-between items-start gap-2">
                            {editingNoteId === note.id ? (
                              <div className="flex-1 space-y-2">
                                <Textarea
                                  value={editingNoteValue}
                                  onChange={(e) => setEditingNoteValue(e.target.value)}
                                  rows={4}
                                  autoFocus
                                />
                                <div className="flex gap-2">
                                  <Button size="sm" variant="ghost" onClick={() => {
                                    if (editingNoteValue.trim() && editingNoteValue.trim() !== note.content) {
                                      editMutation.mutate({ id: note.id, content: editingNoteValue.trim() });
                                    }
                                    setEditingNoteId(null);
                                  }}><Check className="w-4 h-4 mr-1" />Save</Button>
                                  <Button size="sm" variant="ghost" onClick={() => setEditingNoteId(null)}><X className="w-4 h-4 mr-1" />Cancel</Button>
                                </div>
                              </div>
                            ) : (
                              <p className="whitespace-pre-wrap text-sm flex-1 cursor-pointer" onDoubleClick={() => { setEditingNoteId(note.id); setEditingNoteValue(note.content); }}>{note.content}</p>
                            )}
                            {editingNoteId !== note.id && (
                              <div className="flex gap-1 shrink-0">
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => { setEditingNoteId(note.id); setEditingNoteValue(note.content); }}>
                                  <Pencil className="w-4 h-4" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => deleteMutation.mutate(note.id)}>
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-3">
                            <OrgTimestamp value={note.created_at} />
                          </p>
                        </CardContent>
                      </Card>
                    ))
                  )}
                </div>
              ) : (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      {getTabIcon(type)}
                      {getTabLabel(type)}
                      <Badge variant="secondary" className="ml-auto">{incompleteTasks.length} remaining</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="max-h-[calc(100vh-320px)] overflow-y-auto">
                    {filteredTasks.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                        <Circle className="w-12 h-12 mb-4 opacity-50" />
                        <p>No tasks yet</p>
                        <Button variant="link" onClick={() => { setNewType(type); setAddDialogOpen(true); }}>Add your first task</Button>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <SortableTaskList
                          tasks={incompleteTasks}
                          onReorder={(activeId, overId) => reorderMutation.mutate({ activeId, overId })}
                          onToggle={(id, completed) => toggleMutation.mutate({ id, is_completed: completed })}
                          onDelete={(id) => deleteMutation.mutate(id)}
                          onEdit={(id, content) => editMutation.mutate({ id, content })}
                        />
                        {completedTasks.length > 0 && (
                          <div className="mt-6">
                            <p className="text-sm font-medium text-muted-foreground mb-2">Completed ({completedTasks.length})</p>
                            <SortableTaskList
                              tasks={completedTasks}
                              onReorder={(activeId, overId) => reorderMutation.mutate({ activeId, overId })}
                              onToggle={(id, completed) => toggleMutation.mutate({ id, is_completed: completed })}
                              onDelete={(id) => deleteMutation.mutate(id)}
                              onEdit={(id, content) => editMutation.mutate({ id, content })}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          ))}
        </Tabs>
        <p className="text-xs text-muted-foreground text-center">💡 Double-click a task or note to edit it inline. Drag the grip handle to reorder tasks.</p>
      </div>
    </div>
</AdminLayout>
  );
}
