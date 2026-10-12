import { useState, useEffect } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { PlanFeatureGate } from '@/components/admin/PlanFeatureGate';
import { matrixToCsv } from '@/lib/orgDataExport';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { supabase } from '@/lib/supabase';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { calendarDayFromKey, calendarDayKey } from '@/lib/orgDateRange';
import { 
  Plus, 
  CalendarIcon, 
  Download, 
  Trash2, 
  Edit,
  Package,
  Car,
  Wrench,
  Building,
  Receipt,
  DollarSign
} from 'lucide-react';

import { toast } from 'sonner';
import { useOrganization } from '@/contexts/OrganizationContext';
import { SEOHead } from '@/components/SEOHead';
import { fmt } from '@/lib/activeCurrency';
import { mustAffectRows } from '@/lib/mustAffectRows';

interface Expense {
  id: string;
  category: string;
  description: string;
  amount: number;
  vendor: string | null;
  receipt_url: string | null;
  expense_date: string;
  created_at: string;
}

const EXPENSE_CATEGORIES = [
  { value: 'supplies', label: 'Cleaning Supplies', icon: Package },
  { value: 'mileage', label: 'Mileage/Travel', icon: Car },
  { value: 'equipment', label: 'Equipment', icon: Wrench },
  { value: 'office', label: 'Office/Admin', icon: Building },
  { value: 'marketing', label: 'Marketing', icon: Receipt },
  { value: 'insurance', label: 'Insurance', icon: Receipt },
  { value: 'domain', label: 'Domain/Website', icon: Receipt },
  { value: 'dialers', label: 'Dialers/Phone', icon: Receipt },
  { value: 'misc', label: 'Misc', icon: Receipt },
  { value: 'other', label: 'Other', icon: Receipt },
];

export default function ExpensesPage() {
  const queryClient = useQueryClient();
  const { organization } = useOrganization();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editExpense, setEditExpense] = useState<Expense | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    category: 'supplies',
    description: '',
    amount: '',
    vendor: '',
    expense_date: new Date(),
  });

  // Fetch expenses
  const { data: expenses = [], isLoading, error: expensesError } = useQuery({
    queryKey: ['expenses', organization?.id],
    queryFn: async () => {
      if (!organization?.id) return [];
      const { data, error } = await supabase
        .from('expenses')
        .select('*')
        .eq('organization_id', organization.id)
        .order('expense_date', { ascending: false });
      if (error) throw error;
      return data as Expense[];
    },
    enabled: !!organization?.id,
  });

  useEffect(() => {
    if (expensesError) toast.error('Failed to load expenses');
  }, [expensesError]);

  // Create expense
  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      if (!organization?.id) {
        throw new Error('No organization found');
      }
      const { error } = await supabase.from('expenses').insert({
        category: data.category,
        description: data.description,
        amount: parseFloat(data.amount),
        vendor: data.vendor || null,
        // data.expense_date is a picker token; expense_date is a DATE column.
        expense_date: calendarDayKey(data.expense_date),
        organization_id: organization.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      toast.success('Expense added');
      setAddDialogOpen(false);
      resetForm();
    },
    onError: (error) => {
      console.error('Error adding expense:', error);
      toast.error('Failed to add expense');
    },
  });

  // Update expense
  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: typeof formData }) => {
      if (!organization?.id) throw new Error('No organization found');
      await mustAffectRows(
        supabase
          .from('expenses')
          .update({
            category: data.category,
            description: data.description,
            amount: parseFloat(data.amount),
            vendor: data.vendor || null,
            expense_date: calendarDayKey(data.expense_date),
          })
          .eq('id', id)
          .eq('organization_id', organization.id),
        'Expense not saved. It may belong to a different business.',
        { table: 'expenses' },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      toast.success('Expense updated');
      setEditExpense(null);
      resetForm();
    },
    onError: (error: Error) => {
      console.error('Error updating expense:', error);
      toast.error(error.message || 'Failed to update expense');
    },
  });

  // Delete expense
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!organization?.id) throw new Error('No organization found');
      await mustAffectRows(
        supabase.from('expenses').delete().eq('id', id).eq('organization_id', organization.id),
        'Expense not deleted. It may belong to a different business.',
        { table: 'expenses' },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      toast.success('Expense deleted');
      setDeleteConfirm(null);
    },
    onError: (error: Error) => {
      console.error('Error deleting expense:', error);
      toast.error(error.message || 'Failed to delete expense');
    },
  });

  const resetForm = () => {
    setFormData({
      category: 'supplies',
      description: '',
      amount: '',
      vendor: '',
      expense_date: new Date(),
    });
  };

  const handleEdit = (expense: Expense) => {
    setFormData({
      category: expense.category,
      description: expense.description,
      amount: expense.amount.toString(),
      vendor: expense.vendor || '',
      expense_date: calendarDayFromKey(expense.expense_date),
    });
    setEditExpense(expense);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editExpense) {
      updateMutation.mutate({ id: editExpense.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  // Calculate totals by category
  const categoryTotals = expenses.reduce((acc, exp) => {
    acc[exp.category] = (acc[exp.category] || 0) + exp.amount;
    return acc;
  }, {} as Record<string, number>);

  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);

  // Export CSV
  const exportCSV = async () => {
    const headers = ['Date', 'Category', 'Description', 'Vendor', 'Amount'];
    const rows = expenses.map(e => [
      e.expense_date,
      e.category,
      e.description,
      e.vendor || '',
      e.amount.toFixed(2),
    ]);
    // Expense vendor and description are free text — commas and line breaks
    // both appear, and both silently reshaped the file.
    const csv = matrixToCsv([headers, ...rows]);
    const { exportFile } = await import('@/lib/exportFile');
    /* eslint-disable-next-line local/no-device-local-dates -- names an export file with the downloader's own day; no org context here and nothing downstream reads it */
    await exportFile(`expenses-${format(new Date(), 'yyyy-MM-dd')}.csv`, csv, 'text/csv');
  };

  const getCategoryIcon = (category: string) => {
    const cat = EXPENSE_CATEGORIES.find(c => c.value === category);
    return cat?.icon || Receipt;
  };

  return (
    <AdminLayout
      title="Expenses & Supplies"
      subtitle="Track business expenses for tax deductions"
      actions={
        <div className="flex gap-2">
      <SEOHead title="Expenses | TidyWise" description="Track business expenses and supplies" noIndex />
          <Button variant="outline" className="gap-2" onClick={exportCSV}>
            <Download className="w-4 h-4" />
            Export CSV
          </Button>
          <Button className="gap-2" onClick={() => setAddDialogOpen(true)}>
            <Plus className="w-4 h-4" />
            Add Expense
          </Button>
        </div>
      }
    >
<div className="portal-v2 portal-v2-scroll">
      <PlanFeatureGate feature="expenses">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        <Card className="bg-gradient-to-br from-primary/10 to-primary/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="w-4 h-4 text-primary" />
              <span className="text-xs text-muted-foreground">Total Expenses</span>
            </div>
            <p className="text-xl font-bold text-primary">{fmt(totalExpenses)}</p>
          </CardContent>
        </Card>
        {EXPENSE_CATEGORIES.map(cat => {
          const Icon = cat.icon;
          const total = categoryTotals[cat.value] || 0;
          return (
            <Card key={cat.value}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Icon className="w-4 h-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">{cat.label}</span>
                </div>
                <p className="text-lg font-semibold">{fmt(total)}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Expenses Table */}
      <Card>
        <CardHeader>
          <CardTitle>All Expenses</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading expenses...</div>
          ) : expenses.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No expenses yet. Add your first expense to track business costs.
            </div>
          ) : (
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenses.map((expense) => {
                  const Icon = getCategoryIcon(expense.category);
                  return (
                    <TableRow key={expense.id}>
                      <TableCell className="whitespace-nowrap">
                        {format(calendarDayFromKey(expense.expense_date), 'MMM d, yyyy')}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="gap-1">
                          <Icon className="w-3 h-3" />
                          {EXPENSE_CATEGORIES.find(c => c.value === expense.category)?.label || expense.category}
                        </Badge>
                      </TableCell>
                      <TableCell>{expense.description}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {expense.vendor || '-'}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        ${expense.amount.toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleEdit(expense)}
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            onClick={() => setDeleteConfirm(expense.id)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Dialog */}
      <Dialog open={addDialogOpen || !!editExpense} onOpenChange={(open) => {
        if (!open) {
          setAddDialogOpen(false);
          setEditExpense(null);
          resetForm();
        }
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editExpense ? 'Edit Expense' : 'Add Expense'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="category">Category *</Label>
              <Select
                value={formData.category}
                onValueChange={(value) => setFormData({ ...formData, category: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPENSE_CATEGORIES.map(cat => (
                    <SelectItem key={cat.value} value={cat.value}>
                      <div className="flex items-center gap-2">
                        <cat.icon className="w-4 h-4" />
                        {cat.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description *</Label>
              <Input
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="What was this expense for?"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="amount">Amount ($) *</Label>
                <Input
                  id="amount"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.amount}
                  onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                  placeholder="0.00"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Date *</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start gap-2">
                      <CalendarIcon className="w-4 h-4" />
                      {format(formData.expense_date, 'MMM d, yyyy')}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={formData.expense_date}
                      onSelect={(date) => date && setFormData({ ...formData, expense_date: date })}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="vendor">Vendor</Label>
              <Input
                id="vendor"
                value={formData.vendor}
                onChange={(e) => setFormData({ ...formData, vendor: e.target.value })}
                placeholder="e.g., Amazon, Costco, Home Depot"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => {
                setAddDialogOpen(false);
                setEditExpense(null);
                resetForm();
              }}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                {editExpense ? 'Update' : 'Add'} Expense
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteConfirm} onOpenChange={(open) => !open && setDeleteConfirm(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Expense</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to delete this expense? This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirm && deleteMutation.mutate(deleteConfirm)}
              disabled={deleteMutation.isPending}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </PlanFeatureGate>
    </div>
</AdminLayout>
  );
}
