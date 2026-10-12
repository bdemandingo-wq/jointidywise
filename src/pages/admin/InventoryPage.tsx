import { useState, useEffect, useMemo } from 'react';
import { QueryError } from '@/components/QueryError';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { PlanFeatureGate } from '@/components/admin/PlanFeatureGate';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
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
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Plus, Package, Trash2, Edit, Settings, MoreHorizontal, Download, Upload, Search, ArrowUpDown, ArrowUp, ArrowDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { saveBlob } from '@/lib/fileActions';
import { matrixToCsv } from '@/lib/orgDataExport';
import { toast } from 'sonner';
import { useOrganization } from '@/contexts/OrganizationContext';
import { SEOHead } from '@/components/SEOHead';
import { cn } from '@/lib/utils';
import { fmt } from '@/lib/activeCurrency';

interface InventoryItem {
  id: string;
  name: string;
  description: string | null;
  category: string;
  quantity: number;
  min_quantity: number;
  unit: string;
  cost_per_unit: number;
  supplier: string | null;
  last_restocked_at: string | null;
  custom_fields: Record<string, any>;
}

interface InventoryCategory {
  id: string;
  name: string;
  organization_id: string;
}

const DEFAULT_CATEGORIES = ['supplies', 'equipment', 'chemicals', 'uniforms', 'other'];

type SortField = 'name' | 'category' | 'quantity' | 'min_quantity' | 'cost_per_unit' | 'supplier';
type SortDir = 'asc' | 'desc';

export default function InventoryPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [editingCell, setEditingCell] = useState<{ id: string; field: 'quantity' | 'min_quantity' } | null>(null);
  const [editingCellValue, setEditingCellValue] = useState('');
  const queryClient = useQueryClient();
  const { organization } = useOrganization();

  const { data: items = [], isLoading, error: itemsError } = useQuery({
    queryKey: ['inventory', organization?.id],
    queryFn: async () => {
      if (!organization?.id) return [];
      const { data, error } = await supabase
        .from('inventory_items')
        .select('*')
        .eq('organization_id', organization.id)
        .order('name');
      if (error) throw error;
      return data as InventoryItem[];
    },
    enabled: !!organization?.id,
  });

  const { data: customCategories = [], error: categoriesError } = useQuery({
    queryKey: ['inventory-categories', organization?.id],
    queryFn: async () => {
      if (!organization?.id) return [];
      const { data, error } = await supabase
        .from('inventory_categories')
        .select('*')
        .eq('organization_id', organization.id)
        .order('name');
      if (error) throw error;
      return data as InventoryCategory[];
    },
    enabled: !!organization?.id,
  });

  useEffect(() => {
    if (categoriesError) toast.error('Failed to load inventory categories');
  }, [categoriesError]);

  const allCategories = [
    ...DEFAULT_CATEGORIES,
    ...customCategories.map(c => c.name).filter(n => !DEFAULT_CATEGORIES.includes(n.toLowerCase()))
  ];

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      if (!organization?.id) throw new Error('No organization found');
      const { error } = await supabase.from('inventory_items').insert([{ ...data, organization_id: organization.id }]);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      toast.success('Item added');
      setDialogOpen(false);
    },
    onError: (error: any) => toast.error(error.message),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...data }: Partial<InventoryItem> & { id: string }) => {
      if (!organization?.id) throw new Error('No organization found');
      const { error } = await supabase.from('inventory_items').update(data).eq('id', id).eq('organization_id', organization.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      setEditingItem(null);
      setDialogOpen(false);
    },
    onError: (error: any) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!organization?.id) throw new Error('No organization found');
      const { error } = await supabase.from('inventory_items').delete().eq('id', id).eq('organization_id', organization.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      toast.success('Item deleted');
    },
    onError: (error: any) => toast.error(error.message),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      if (!organization?.id) throw new Error('No organization found');
      const { error } = await supabase.from('inventory_items').delete().in('id', ids).eq('organization_id', organization.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      setSelectedIds(new Set());
      toast.success('Items deleted');
    },
    onError: (error: any) => toast.error(error.message),
  });

  // Filter, sort, paginate
  const filteredItems = useMemo(() => {
    let result = [...items];

    // Category filter
    if (activeTab === 'low_stock') {
      result = result.filter(i => i.quantity <= i.min_quantity);
    } else if (activeTab !== 'all') {
      result = result.filter(i => i.category.toLowerCase() === activeTab.toLowerCase());
    }

    // Search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(i =>
        i.name.toLowerCase().includes(q) ||
        (i.supplier?.toLowerCase().includes(q)) ||
        i.category.toLowerCase().includes(q)
      );
    }

    // Sort
    result.sort((a, b) => {
      let av: any = a[sortField];
      let bv: any = b[sortField];
      if (typeof av === 'string') av = av.toLowerCase();
      if (typeof bv === 'string') bv = bv.toLowerCase();
      if (av == null) av = '';
      if (bv == null) bv = '';
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [items, activeTab, searchQuery, sortField, sortDir]);

  const totalPages = Math.ceil(filteredItems.length / perPage);
  const paginatedItems = filteredItems.slice((page - 1) * perPage, page * perPage);

  useEffect(() => { setPage(1); }, [activeTab, searchQuery, perPage]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-40" />;
    return sortDir === 'asc' ? <ArrowUp className="w-3 h-3 ml-1" /> : <ArrowDown className="w-3 h-3 ml-1" />;
  };

  const allSelected = paginatedItems.length > 0 && paginatedItems.every(i => selectedIds.has(i.id));
  const someSelected = paginatedItems.some(i => selectedIds.has(i.id));

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(paginatedItems.map(i => i.id)));
    }
  };

  const toggleOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  };

  const handleInlineEdit = (item: InventoryItem, field: 'quantity' | 'min_quantity') => {
    setEditingCell({ id: item.id, field });
    setEditingCellValue(item[field].toString());
  };

  const commitInlineEdit = () => {
    if (!editingCell) return;
    const val = parseInt(editingCellValue);
    if (isNaN(val) || val < 0) {
      setEditingCell(null);
      return;
    }
    updateMutation.mutate({ id: editingCell.id, [editingCell.field]: val });
    setEditingCell(null);
  };

  const handleExport = async () => {
    // Supplier names are the usual offender — "Acme Janitorial, Inc." split the
    // row and pushed every later column one field left.
    const csv = matrixToCsv([
      ['Name', 'Category', 'Available', 'Low Stock Min', 'Cost/Unit', 'Supplier'],
      ...filteredItems.map(i => [i.name, i.category, i.quantity, i.min_quantity, i.cost_per_unit, i.supplier || '']),
    ]);
    const blob = new Blob([csv], { type: 'text/csv' });
    await saveBlob(blob, 'inventory.csv');
    toast.success('Inventory exported');
  };

  const lowStockItems = items.filter(i => i.quantity <= i.min_quantity);

  const tabs = [
    { key: 'all', label: 'All', count: items.length },
    { key: 'low_stock', label: 'Low Stock', count: lowStockItems.length },
    ...DEFAULT_CATEGORIES.map(c => ({ key: c, label: c.charAt(0).toUpperCase() + c.slice(1), count: items.filter(i => i.category.toLowerCase() === c).length })),
    ...customCategories.filter(c => !DEFAULT_CATEGORIES.includes(c.name.toLowerCase())).map(c => ({ key: c.name, label: c.name, count: items.filter(i => i.category.toLowerCase() === c.name.toLowerCase()).length })),
  ];

  return (
    <AdminLayout
      title="Inventory"
      subtitle={`${items.length} items tracked`}
      actions={
        <div className="flex gap-2">
          <SEOHead title="Inventory | TidyWise" description="Track cleaning supplies and inventory" noIndex />
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleExport}>
            <Download className="w-4 h-4" />
            Export
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setSettingsDialogOpen(true)}>
            <Settings className="w-4 h-4" />
            Settings
          </Button>
          <Button size="sm" className="gap-1.5" onClick={() => { setEditingItem(null); setDialogOpen(true); }}>
            <Plus className="w-4 h-4" />
            Add Item
          </Button>
        </div>
      }
    >
<div className="portal-v2 portal-v2-scroll">
      <PlanFeatureGate feature="inventory">
        {/* Filter Tabs + Search */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
          <div className="flex flex-wrap gap-1.5">
            {tabs.map(t => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={cn(
                  "px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                  activeTab === t.key
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                {t.label}
                {t.count > 0 && <span className="ml-1 opacity-70">({t.count})</span>}
              </button>
            ))}
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search items..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-8"
            />
          </div>
        </div>

        {/* Bulk Actions Bar */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 mb-3 p-2.5 rounded-lg bg-muted border">
            <span className="text-sm font-medium">{selectedIds.size} selected</span>
            <Button
              size="sm"
              variant="destructive"
              className="h-7 text-xs"
              onClick={() => {
                if (confirm(`Delete ${selectedIds.size} items?`)) {
                  bulkDeleteMutation.mutate(Array.from(selectedIds));
                }
              }}
            >
              Delete selected
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={async () => {
                const selected = items.filter(i => selectedIds.has(i.id));
                const csv = matrixToCsv([
                  ['Name', 'Category', 'Available', 'Low Stock Min', 'Cost/Unit', 'Supplier'],
                  ...selected.map(i => [i.name, i.category, i.quantity, i.min_quantity, i.cost_per_unit, i.supplier || '']),
                ]);
                const blob = new Blob([csv], { type: 'text/csv' });
                await saveBlob(blob, 'inventory-selected.csv');
              }}
            >
              Export selected
            </Button>
          </div>
        )}

        {/* Table */}
        <Card className="shadow-sm">
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30">
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allSelected}
                        // @ts-ignore
                        indeterminate={someSelected && !allSelected}
                        onCheckedChange={toggleAll}
                      />
                    </TableHead>
                    <TableHead className="w-12"></TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => handleSort('name')}>
                      <span className="inline-flex items-center">Item <SortIcon field="name" /></span>
                    </TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => handleSort('category')}>
                      <span className="inline-flex items-center">Category <SortIcon field="category" /></span>
                    </TableHead>
                    <TableHead className="text-right cursor-pointer select-none" onClick={() => handleSort('quantity')}>
                      <span className="inline-flex items-center justify-end w-full">Available <SortIcon field="quantity" /></span>
                    </TableHead>
                    <TableHead className="text-right cursor-pointer select-none" onClick={() => handleSort('min_quantity')}>
                      <span className="inline-flex items-center justify-end w-full">Low Stock Min <SortIcon field="min_quantity" /></span>
                    </TableHead>
                    <TableHead className="text-right cursor-pointer select-none" onClick={() => handleSort('cost_per_unit')}>
                      <span className="inline-flex items-center justify-end w-full">Cost/Unit <SortIcon field="cost_per_unit" /></span>
                    </TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => handleSort('supplier')}>
                      <span className="inline-flex items-center">Supplier <SortIcon field="supplier" /></span>
                    </TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">Loading...</TableCell>
                    </TableRow>
                  ) : itemsError ? (
                    <TableRow>
                      <TableCell colSpan={9}>
                        <QueryError subject="inventory" onRetry={() => window.location.reload()} />
                      </TableCell>
                    </TableRow>
                  ) : paginatedItems.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">
                        <Package className="w-8 h-8 mx-auto mb-2 opacity-40" />
                        No inventory items found
                      </TableCell>
                    </TableRow>
                  ) : paginatedItems.map((item) => {
                    const isLow = item.quantity <= item.min_quantity;
                    return (
                      <TableRow key={item.id} className={cn(isLow && "border-l-2 border-l-amber-400")}>
                        <TableCell>
                          <Checkbox
                            checked={selectedIds.has(item.id)}
                            onCheckedChange={() => toggleOne(item.id)}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="w-9 h-9 rounded-md bg-muted flex items-center justify-center">
                            <Package className="w-4 h-4 text-muted-foreground" />
                          </div>
                        </TableCell>
                        <TableCell>
                          <p className="font-medium text-sm">{item.name}</p>
                          {item.description && <p className="text-xs text-muted-foreground truncate max-w-[200px]">{item.description}</p>}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="capitalize text-xs font-normal">{item.category}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {editingCell?.id === item.id && editingCell.field === 'quantity' ? (
                            <Input
                              type="number"
                              value={editingCellValue}
                              onChange={e => setEditingCellValue(e.target.value)}
                              onBlur={commitInlineEdit}
                              onKeyDown={e => { if (e.key === 'Enter') commitInlineEdit(); if (e.key === 'Escape') setEditingCell(null); }}
                              className="w-20 h-7 text-right text-xs ml-auto rounded-md border-primary/30"
                              autoFocus
                            />
                          ) : (
                            <button
                              onClick={() => handleInlineEdit(item, 'quantity')}
                              className={cn(
                                "inline-flex items-center justify-end px-2 py-0.5 rounded-md border border-transparent hover:border-border text-sm tabular-nums cursor-text",
                                isLow && "text-amber-600 font-medium"
                              )}
                            >
                              {item.quantity}
                            </button>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {editingCell?.id === item.id && editingCell.field === 'min_quantity' ? (
                            <Input
                              type="number"
                              value={editingCellValue}
                              onChange={e => setEditingCellValue(e.target.value)}
                              onBlur={commitInlineEdit}
                              onKeyDown={e => { if (e.key === 'Enter') commitInlineEdit(); if (e.key === 'Escape') setEditingCell(null); }}
                              className="w-20 h-7 text-right text-xs ml-auto rounded-md border-primary/30"
                              autoFocus
                            />
                          ) : (
                            <button
                              onClick={() => handleInlineEdit(item, 'min_quantity')}
                              className="inline-flex items-center justify-end px-2 py-0.5 rounded-md border border-transparent hover:border-border text-sm tabular-nums text-muted-foreground cursor-text"
                            >
                              {item.min_quantity}
                            </button>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-sm">{fmt(item.cost_per_unit)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{item.supplier || '—'}</TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7">
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => { setEditingItem(item); setDialogOpen(true); }}>
                                <Edit className="w-4 h-4 mr-2" /> Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => { if (confirm('Delete this item?')) deleteMutation.mutate(item.id); }}
                              >
                                <Trash2 className="w-4 h-4 mr-2" /> Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            {filteredItems.length > 0 && (
              <div className="flex items-center justify-between px-4 py-3 border-t">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>Showing {((page - 1) * perPage) + 1}–{Math.min(page * perPage, filteredItems.length)} of {filteredItems.length}</span>
                  <Select value={perPage.toString()} onValueChange={v => setPerPage(Number(v))}>
                    <SelectTrigger className="h-7 w-[70px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="25">25</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                    </SelectContent>
                  </Select>
                  <span>per page</span>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="icon" className="h-7 w-7" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <span className="text-xs px-2">{page} / {totalPages || 1}</span>
                  <Button variant="outline" size="icon" className="h-7 w-7" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Add/Edit Dialog */}
        <InventoryDialog
          open={dialogOpen}
          onOpenChange={(open) => { setDialogOpen(open); if (!open) setEditingItem(null); }}
          item={editingItem}
          categories={allCategories}
          onSave={(data) => {
            if (editingItem) {
              updateMutation.mutate({ id: editingItem.id, ...data });
            } else {
              createMutation.mutate(data);
            }
          }}
        />

        {/* Settings Dialog */}
        <InventorySettingsDialog
          open={settingsDialogOpen}
          onOpenChange={setSettingsDialogOpen}
          categories={customCategories}
          organizationId={organization?.id || ''}
        />
      </PlanFeatureGate>
    </div>
</AdminLayout>
  );
}

function InventoryDialog({
  open, onOpenChange, item, categories, onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: InventoryItem | null;
  categories: string[];
  onSave: (data: any) => void;
}) {
  const [formData, setFormData] = useState({
    name: '', description: '', category: 'supplies', quantity: '0', min_quantity: '5', cost_per_unit: '0', supplier: '',
  });

  useEffect(() => {
    if (item) {
      setFormData({
        name: item.name || '', description: item.description || '', category: item.category || 'supplies',
        quantity: item.quantity?.toString() || '0', min_quantity: item.min_quantity?.toString() || '5',
        cost_per_unit: item.cost_per_unit?.toString() || '0', supplier: item.supplier || '',
      });
    } else {
      setFormData({ name: '', description: '', category: 'supplies', quantity: '0', min_quantity: '5', cost_per_unit: '0', supplier: '' });
    }
  }, [item, open]);

  const handleSubmit = () => {
    if (!formData.name) return;
    onSave({
      ...formData, quantity: parseInt(formData.quantity), min_quantity: parseInt(formData.min_quantity), cost_per_unit: parseFloat(formData.cost_per_unit),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{item ? 'Edit' : 'Add'} Item</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div><Label>Name *</Label><Input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} /></div>
          <div><Label>Description</Label><Input value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Category</Label>
              <Select value={formData.category} onValueChange={(v) => setFormData({ ...formData, category: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{categories.map(cat => <SelectItem key={cat} value={cat} className="capitalize">{cat}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Supplier</Label><Input value={formData.supplier} onChange={(e) => setFormData({ ...formData, supplier: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div><Label>Quantity</Label><Input type="number" value={formData.quantity} onChange={(e) => setFormData({ ...formData, quantity: e.target.value })} /></div>
            <div><Label>Low Stock Min</Label><Input type="number" value={formData.min_quantity} onChange={(e) => setFormData({ ...formData, min_quantity: e.target.value })} /></div>
            <div><Label>Cost/Unit</Label><Input type="number" step="0.01" value={formData.cost_per_unit} onChange={(e) => setFormData({ ...formData, cost_per_unit: e.target.value })} /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit}>{item ? 'Update' : 'Create'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InventorySettingsDialog({
  open, onOpenChange, categories, organizationId,
}: {
  open: boolean; onOpenChange: (open: boolean) => void; categories: InventoryCategory[]; organizationId: string;
}) {
  const queryClient = useQueryClient();
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingCategory, setEditingCategory] = useState<InventoryCategory | null>(null);
  // The list is a prop from the page query. Invalidating that query does not
  // repaint this open dialog until the refetch lands, so keep a local copy of
  // adds, renames, and deletes in the meantime.
  const [optimistic, setOptimistic] = useState<InventoryCategory[]>([]);
  const [removedIds, setRemovedIds] = useState<string[]>([]);

  useEffect(() => {
    setOptimistic((prev) => {
      const next = prev.filter(
        (row) => !categories.some((c) => c.id === row.id || c.name.toLowerCase() === row.name.toLowerCase()),
      );
      return next.length === prev.length ? prev : next;
    });
    setRemovedIds((prev) => {
      const next = prev.filter((id) => categories.some((c) => c.id === id));
      return next.length === prev.length ? prev : next;
    });
  }, [categories]);

  const visibleCategories = (() => {
    const rows = new Map<string, InventoryCategory>();
    const serverNames = new Set(categories.map((c) => c.name.toLowerCase()));
    for (const category of categories) {
      if (!removedIds.includes(category.id)) rows.set(category.id, category);
    }
    for (const row of optimistic) {
      if (removedIds.includes(row.id)) continue;
      if (row.id.startsWith('pending-') && serverNames.has(row.name.toLowerCase())) continue;
      rows.set(row.id, row);
    }
    return [...rows.values()];
  })();

  const createCategoryMutation = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase.from('inventory_categories').insert([{ name, organization_id: organizationId }]);
      if (error) throw error;
    },
    onSuccess: (_data, name) => {
      const trimmed = name.trim();
      setOptimistic((prev) => [
        ...prev.filter((row) => row.name.toLowerCase() !== trimmed.toLowerCase()),
        { id: `pending-${trimmed.toLowerCase()}`, name: trimmed, organization_id: organizationId },
      ]);
      setNewCategoryName('');
      toast.success('Category added');
      void queryClient.refetchQueries({ queryKey: ['inventory-categories', organizationId] });
    },
    onError: (error: any) => toast.error(error.message),
  });

  const updateCategoryMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase.from('inventory_categories').update({ name }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_data, { id, name }) => {
      setOptimistic((prev) => [
        ...prev.filter((row) => row.id !== id),
        { id, name, organization_id: organizationId },
      ]);
      setEditingCategory(null);
      toast.success('Category updated');
      void queryClient.refetchQueries({ queryKey: ['inventory-categories', organizationId] });
    },
    onError: (error: any) => toast.error(error.message),
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('inventory_categories').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_data, id) => {
      setRemovedIds((prev) => [...prev, id]);
      setOptimistic((prev) => prev.filter((row) => row.id !== id));
      toast.success('Category deleted');
      void queryClient.refetchQueries({ queryKey: ['inventory-categories', organizationId] });
    },
    onError: (error: any) => toast.error(error.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Inventory Categories</DialogTitle>
          <DialogDescription>Manage categories for your inventory items.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Default Categories</CardTitle></CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {DEFAULT_CATEGORIES.map(cat => <Badge key={cat} variant="secondary" className="capitalize">{cat}</Badge>)}
              </div>
              <p className="text-xs text-muted-foreground mt-2">These categories are built-in and cannot be removed.</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Custom Categories</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {visibleCategories.length === 0 ? (
                <p className="text-sm text-muted-foreground">No custom categories yet.</p>
              ) : visibleCategories.map(cat => (
                <div key={cat.id} className="flex items-center justify-between p-2 border rounded-md">
                  {editingCategory?.id === cat.id ? (
                    <Input value={editingCategory.name} onChange={(e) => setEditingCategory({ ...editingCategory, name: e.target.value })} className="flex-1 mr-2" autoFocus />
                  ) : (
                    <span className="capitalize">{cat.name}</span>
                  )}
                  <div className="flex gap-1">
                    {editingCategory?.id === cat.id ? (
                      <>
                        <Button size="sm" onClick={() => updateCategoryMutation.mutate({ id: cat.id, name: editingCategory.name })}>Save</Button>
                        <Button size="sm" variant="outline" onClick={() => setEditingCategory(null)}>Cancel</Button>
                      </>
                    ) : (
                      <>
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditingCategory(cat)}><Edit className="w-4 h-4" /></Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => { if (confirm('Delete this category?')) deleteCategoryMutation.mutate(cat.id); }}><Trash2 className="w-4 h-4" /></Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
              <div className="flex gap-2 pt-2 border-t">
                <Input placeholder="New category name" value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && createCategoryMutation.mutate(newCategoryName.trim())} />
                <Button onClick={() => createCategoryMutation.mutate(newCategoryName.trim())} disabled={!newCategoryName.trim()}>
                  <Plus className="w-4 h-4 mr-1" /> Add
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
