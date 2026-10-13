import { formatDuration } from '@/lib/formatDuration';
import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import { useOrganization } from '@/contexts/OrganizationContext';
import { Plus, Pencil, Trash2, Loader2, Sparkles, GripVertical } from 'lucide-react';
import { toast } from 'sonner';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fmt } from '@/lib/activeCurrency';
import { QueryError } from '@/components/QueryError';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers';

interface Service {
  id: string;
  name: string;
  description: string | null;
  duration: number;
  price: number;
  is_active: boolean;
  organization_id: string;
  created_at: string;
  display_order?: number;
}

function SortableServiceRow({
  service,
  onEdit,
  onDelete,
}: {
  service: Service;
  onEdit: (s: Service) => void;
  onDelete: (s: Service) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: service.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    background: isDragging ? 'hsl(var(--muted))' : undefined,
  };
  return (
    <TableRow ref={setNodeRef} style={style}>
      <TableCell>
        <div className="flex items-start gap-2">
          <button
            type="button"
            aria-label={`Reorder ${service.name}`}
            className="mt-1 flex h-6 w-5 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing touch-none"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="w-4 h-4" />
          </button>
          <div>
            <p className="font-medium">{service.name}</p>
            {service.description && (
              <p className="text-sm text-muted-foreground truncate max-w-xs">
                {service.description}
              </p>
            )}
          </div>
        </div>
      </TableCell>
      <TableCell className="whitespace-nowrap">{formatDuration(service.duration)}</TableCell>
      <TableCell>{fmt(service.price)}</TableCell>
      <TableCell>
        <Badge variant={service.is_active ? 'default' : 'secondary'}>
          {service.is_active ? 'Active' : 'Inactive'}
        </Badge>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="icon" onClick={() => onEdit(service)}>
            <Pencil className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onDelete(service)}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

export function CustomServicesManager() {
  const { organization } = useOrganization();
  const queryClient = useQueryClient();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [deleteConfirmService, setDeleteConfirmService] = useState<Service | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    duration: '60',
    price: '0',
    is_active: true,
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Fetch services
  const { data: services = [], isLoading, error: servicesError } = useQuery({
    queryKey: ['services', organization?.id],
    queryFn: async () => {
      if (!organization?.id) return [];
      const { data, error } = await supabase
        .from('services')
        .select('*')
        .eq('organization_id', organization.id)
        .order('display_order', { ascending: true })
        .order('name');
      if (error) throw error;
      return data as Service[];
    },
    enabled: !!organization?.id,
  });

  // Reorder mutation: persist new order to display_order column.
  const reorderMutation = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      // Optimistic update handled below; persist one UPDATE per row.
      await Promise.all(
        orderedIds.map((id, idx) =>
          supabase.from('services').update({ display_order: idx + 1 }).eq('id', id),
        ),
      );
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to save new order');
      queryClient.invalidateQueries({ queryKey: ['services'] });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['services'] });
    },
  });

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = services.findIndex((s) => s.id === active.id);
    const newIndex = services.findIndex((s) => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(services, oldIndex, newIndex);
    // Optimistic cache update so the UI reflects the drop immediately.
    queryClient.setQueryData(
      ['services', organization?.id],
      reordered.map((s, i) => ({ ...s, display_order: i + 1 })),
    );
    reorderMutation.mutate(reordered.map((s) => s.id));
  };


  // Create service mutation
  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      if (!organization?.id) throw new Error('No organization');
      const { error } = await supabase.from('services').insert({
        name: data.name,
        description: data.description || null,
        duration: parseInt(data.duration) || 60,
        price: parseFloat(data.price) || 0,
        is_active: data.is_active,
        organization_id: organization.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['services'] });
      toast.success('Service created! It will now appear in your booking form.');
      setIsAddOpen(false);
      resetForm();
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to create service');
    },
  });

  // Update service mutation
  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof formData }) => {
      const { error } = await supabase
        .from('services')
        .update({
          name: data.name,
          description: data.description || null,
          duration: parseInt(data.duration) || 60,
          price: parseFloat(data.price) || 0,
          is_active: data.is_active,
        })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['services'] });
      toast.success('Service updated!');
      setEditingService(null);
      resetForm();
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to update service');
    },
  });

  // Delete service mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('services').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['services'] });
      toast.success('Service deleted');
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to delete service');
    },
  });

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      duration: '60',
      price: '0',
      is_active: true,
    });
  };

  const handleEdit = (service: Service) => {
    setEditingService(service);
    setFormData({
      name: service.name,
      description: service.description || '',
      duration: service.duration.toString(),
      price: service.price.toString(),
      is_active: service.is_active,
    });
  };

  const handleSubmit = () => {
    if (!formData.name.trim()) {
      toast.error('Service name is required');
      return;
    }

    if (editingService) {
      updateMutation.mutate({ id: editingService.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleDelete = (service: Service) => {
    setDeleteConfirmService(service);
  };

  const handleCloseDialog = () => {
    if (editingService) {
      setEditingService(null);
    } else {
      setIsAddOpen(false);
    }
    resetForm();
  };

  if (servicesError) return <QueryError subject="services" onRetry={() => queryClient.invalidateQueries({ queryKey: ['services', organization?.id] })} />;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5" />
              Custom Services
            </CardTitle>
            <CardDescription>
              Create and manage your cleaning service types. These will appear in your booking form.
            </CardDescription>
          </div>
          <Dialog open={isAddOpen || !!editingService} onOpenChange={(open) => {
            if (!open) handleCloseDialog();
            else setIsAddOpen(true);
          }}>
            <DialogTrigger asChild>
              <Button className="w-full sm:w-auto shrink-0">
                <Plus className="w-4 h-4 mr-2" />
                Add Service
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto max-w-lg">
              <DialogHeader>
                <DialogTitle>
                  {editingService ? 'Edit Service' : 'Create New Service'}
                </DialogTitle>
                <DialogDescription>
                  {editingService 
                    ? 'Update this service details. Changes will reflect in the booking form.'
                    : 'Add a new service type that customers can book.'}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div>
                  <Label>Service Name *</Label>
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g., Deep Clean, Move-Out Clean"
                  />
                </div>
                <div>
                  <Label>Description</Label>
                  <Textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="What's included in this service..."
                    rows={3}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Duration (minutes)</Label>
                    <Input
                      type="number"
                      value={formData.duration}
                      onChange={(e) => setFormData({ ...formData, duration: e.target.value })}
                      placeholder="60"
                      aria-label="Duration (minutes)"
                      aria-describedby="service-duration-preview"
                    />
                    <p id="service-duration-preview" aria-live="polite" className="mt-2 text-sm text-muted-foreground break-words">
                      {formData.duration.trim() !== '' && Number.isFinite(Number(formData.duration)) && Number(formData.duration) >= 0
                        ? `${formData.duration} min → ${formatDuration(Number(formData.duration))}`
                        : null}
                    </p>
                  </div>
                  <div>
                    <Label>Base Price ($)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={formData.price}
                      onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                      placeholder="0"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={formData.is_active}
                    onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                  />
                  <Label>Active (visible in booking form)</Label>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={handleCloseDialog}>
                  Cancel
                </Button>
                <Button 
                  onClick={handleSubmit}
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  {(createMutation.isPending || updateMutation.isPending) && (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  )}
                  {editingService ? 'Update Service' : 'Create Service'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {services.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Sparkles className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>No services yet. Create your first service to get started!</p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
            onDragEnd={handleDragEnd}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Service Name</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Base Price</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <SortableContext
                  items={services.map((s) => s.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {services.map((service) => (
                    <SortableServiceRow
                      key={service.id}
                      service={service}
                      onEdit={handleEdit}
                      onDelete={handleDelete}
                    />
                  ))}
                </SortableContext>
              </TableBody>
            </Table>
          </DndContext>
        )}

        <div className="mt-4 p-4 bg-secondary/50 rounded-lg">
          <p className="text-sm text-muted-foreground">
            <strong>Tip:</strong> After creating a service, go to the "Service Pricing" tab to set up detailed pricing
            including square footage rates, bedroom/bathroom combinations, extras, and more.
          </p>
        </div>
      </CardContent>

      <AlertDialog open={!!deleteConfirmService} onOpenChange={(o) => { if (!o) setDeleteConfirmService(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete service?</AlertDialogTitle>
            <AlertDialogDescription>
              Delete &ldquo;{deleteConfirmService?.name}&rdquo;? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (deleteConfirmService) { deleteMutation.mutate(deleteConfirmService.id); setDeleteConfirmService(null); } }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
