import { useState, useRef, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Upload, ArrowRight, ArrowLeft, CheckCircle2, AlertCircle,
  FileText, Users, Briefcase, Calendar, Wrench, Loader2, X,
  RotateCcw, Download, Repeat, StickyNote,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useOrganization } from '@/contexts/OrganizationContext';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

type DataType = 'customers' | 'staff' | 'bookings' | 'services' | 'recurring_plans' | 'property_notes';
type Source = 'bookingkoala' | 'jobber' | 'other';

interface ParseResult {
  importId: string;
  totalRows: number;
  duplicateRows: number;
  headers: string[];
  fieldMapping: Record<string, string>;
  preview: Record<string, string>[];
}

interface ImportResult {
  imported: number;
  skipped: number;
  errors: number;
  errorLog: { row_number: number; error: string }[];
  /** The real count, which may exceed errorLog.length — the function caps the
   *  list it returns. Optional so an older deployed function still renders. */
  errorLogTotal?: number;
  errorLogTruncated?: boolean;
}

const DATA_TYPE_CONFIG: Record<DataType, { label: string; icon: any; description: string }> = {
  customers: { label: 'Customers', icon: Users, description: 'Clients with contact info, tags, and notes' },
  staff: { label: 'Staff', icon: Briefcase, description: 'Team members, pay rates, contact info' },
  bookings: { label: 'Bookings & History', icon: Calendar, description: 'Past + upcoming jobs with payment, status, extras' },
  recurring_plans: { label: 'Recurring Plans', icon: Repeat, description: 'Weekly / biweekly / monthly schedules' },
  services: { label: 'Services & Pricing', icon: Wrench, description: 'Service types, durations, and base pricing' },
  property_notes: { label: 'Property Notes', icon: StickyNote, description: 'Gate codes, alarm, pets, parking, access' },
};

const TARGET_FIELDS: Record<DataType, { value: string; label: string }[]> = {
  customers: [
    { value: 'first_name', label: 'First Name' },
    { value: 'last_name', label: 'Last Name' },
    { value: 'full_name', label: 'Full Name' },
    { value: 'email', label: 'Email' },
    { value: 'phone', label: 'Phone' },
    { value: 'address', label: 'Address' },
    { value: 'city', label: 'City' },
    { value: 'state', label: 'State' },
    { value: 'zip_code', label: 'Zip Code' },
    { value: 'notes', label: 'Notes' },
    { value: 'tags', label: 'Tags' },
    { value: 'company_name', label: 'Company Name' },
    { value: 'customer_status', label: 'Status (lead/active/inactive)' },
    { value: 'lifetime_value', label: 'Lifetime Value' },
    { value: '', label: '— Skip this column —' },
  ],
  staff: [
    { value: 'first_name', label: 'First Name' },
    { value: 'last_name', label: 'Last Name' },
    { value: 'full_name', label: 'Full Name' },
    { value: 'email', label: 'Email' },
    { value: 'phone', label: 'Phone' },
    { value: 'pay_rate', label: 'Pay Rate' },
    { value: 'role', label: 'Role' },
    { value: 'is_active', label: 'Active' },
    { value: '', label: '— Skip this column —' },
  ],
  bookings: [
    { value: 'customer_name', label: 'Customer Name' },
    { value: 'customer_email', label: 'Customer Email' },
    { value: 'customer_phone', label: 'Customer Phone' },
    { value: 'service_name', label: 'Service Name' },
    { value: 'scheduled_date', label: 'Date' },
    { value: 'scheduled_time', label: 'Time' },
    { value: 'duration', label: 'Duration (min)' },
    { value: 'duration_hours', label: 'Duration (hours)' },
    { value: 'total_amount', label: 'Total Amount' },
    { value: 'subtotal', label: 'Subtotal' },
    { value: 'tax_amount', label: 'Tax' },
    { value: 'tip_amount', label: 'Tip' },
    { value: 'discount_amount', label: 'Discount' },
    { value: 'status', label: 'Status' },
    { value: 'payment_status', label: 'Payment Status' },
    { value: 'address', label: 'Address' },
    { value: 'city', label: 'City' },
    { value: 'state', label: 'State' },
    { value: 'zip_code', label: 'Zip Code' },
    { value: 'staff_name', label: 'Assigned Staff' },
    { value: 'bedrooms', label: 'Bedrooms' },
    { value: 'bathrooms', label: 'Bathrooms' },
    { value: 'square_footage', label: 'Square Footage' },
    { value: 'extras', label: 'Extras / Add-ons' },
    { value: 'frequency', label: 'Frequency' },
    { value: 'notes', label: 'Notes' },
    { value: '', label: '— Skip this column —' },
  ],
  services: [
    { value: 'name', label: 'Service Name' },
    { value: 'description', label: 'Description' },
    { value: 'price', label: 'Price' },
    { value: 'duration', label: 'Duration (min)' },
    { value: 'category', label: 'Category' },
    { value: 'is_active', label: 'Active' },
    { value: '', label: '— Skip this column —' },
  ],
  recurring_plans: [
    { value: 'customer_name', label: 'Customer Name' },
    { value: 'customer_email', label: 'Customer Email' },
    { value: 'customer_phone', label: 'Customer Phone' },
    { value: 'service_name', label: 'Service Name' },
    { value: 'frequency', label: 'Frequency (weekly/biweekly/monthly)' },
    { value: 'preferred_day', label: 'Preferred Day' },
    { value: 'preferred_time', label: 'Preferred Time' },
    { value: 'start_date', label: 'Start / Next Date' },
    { value: 'total_amount', label: 'Total Amount' },
    { value: 'address', label: 'Address' },
    { value: 'city', label: 'City' },
    { value: 'state', label: 'State' },
    { value: 'zip_code', label: 'Zip Code' },
    { value: 'bedrooms', label: 'Bedrooms' },
    { value: 'bathrooms', label: 'Bathrooms' },
    { value: 'square_footage', label: 'Square Footage' },
    { value: 'staff_name', label: 'Assigned Staff' },
    { value: 'notes', label: 'Notes' },
    { value: '', label: '— Skip this column —' },
  ],
  property_notes: [
    { value: 'customer_name', label: 'Customer Name' },
    { value: 'customer_email', label: 'Customer Email' },
    { value: 'customer_phone', label: 'Customer Phone' },
    { value: 'notes', label: 'General Notes' },
    { value: 'access_instructions', label: 'Access Instructions' },
    { value: 'gate_code', label: 'Gate Code' },
    { value: 'alarm_code', label: 'Alarm Code' },
    { value: 'has_pets', label: 'Has Pets (yes/no)' },
    { value: 'pet_notes', label: 'Pet Notes' },
    { value: 'parking_notes', label: 'Parking Notes' },
    { value: '', label: '— Skip this column —' },
  ],
};

export function MigrationWizard() {
  const { organization } = useOrganization();
  const [step, setStep] = useState(1);
  const [source, setSource] = useState<Source | null>(null);
  const [dataType, setDataType] = useState<DataType | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [fieldMapping, setFieldMapping] = useState<Record<string, string>>({});
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setStep(1);
    setSource(null);
    setDataType(null);
    setParsing(false);
    setImporting(false);
    setParseResult(null);
    setFieldMapping({});
    setImportResult(null);
  };

  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !source || !dataType || !organization?.id) return;

    if (!file.name.toLowerCase().endsWith('.csv')) {
      toast.error('Please upload a CSV file');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error('File must be under 10MB');
      return;
    }

    setParsing(true);
    try {
      const text = await file.text();
      const { data, error } = await supabase.functions.invoke('parse-migration-csv', {
        body: {
          csvContent: text,
          dataType,
          source,
          organizationId: organization.id,
          filename: file.name,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setParseResult(data);
      setFieldMapping(data.fieldMapping || {});
      setStep(3);
      if (data.warning) {
        // Some rows failed to save server-side — don't report a clean
        // success when part of the file didn't actually make it in.
        toast.warning(data.warning, { duration: 10000 });
      } else {
        toast.success(`Parsed ${data.totalRows} rows successfully`);
      }
    } catch (err: any) {
      console.error('Parse error:', err);
      toast.error(err.message || 'Failed to parse CSV');
    } finally {
      setParsing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [source, dataType, organization?.id]);

  const updateMapping = (csvHeader: string, targetField: string) => {
    setFieldMapping(prev => ({ ...prev, [csvHeader]: targetField }));
  };

  const handleImport = async () => {
    if (!parseResult || !organization?.id) return;

    setImporting(true);
    try {
      // First update the field mapping on the server
      await supabase
        .from('migration_imports')
        .update({ field_mapping: fieldMapping, status: 'preview' })
        .eq('id', parseResult.importId);

      const { data, error } = await supabase.functions.invoke('process-migration-import', {
        body: {
          importId: parseResult.importId,
          organizationId: organization.id,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setImportResult(data);
      setStep(4);
      toast.success(`Successfully imported ${data.imported} records!`);
    } catch (err: any) {
      console.error('Import error:', err);
      toast.error(err.message || 'Failed to import data');
    } finally {
      setImporting(false);
    }
  };

  const mappedFieldCount = Object.values(fieldMapping).filter(v => v).length;

  return (
    <div className="space-y-6">
      {/* Progress Bar */}
      <div className="flex items-center gap-2">
        {[1, 2, 3, 4].map((s) => (
          <div key={s} className="flex items-center gap-2 flex-1">
            <div className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-all",
              s < step ? "bg-primary text-primary-foreground" :
              s === step ? "bg-primary text-primary-foreground ring-2 ring-primary/30" :
              "bg-muted text-muted-foreground"
            )}>
              {s < step ? <CheckCircle2 className="w-4 h-4" /> : s}
            </div>
            {s < 4 && <div className={cn("h-0.5 flex-1", s < step ? "bg-primary" : "bg-muted")} />}
          </div>
        ))}
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Select Source</span>
        <span>Upload CSV</span>
        <span>Map & Preview</span>
        <span>Complete</span>
      </div>

      {/* Step 1: Select Source & Data Type */}
      {step === 1 && (
        <div className="space-y-6">
          <div>
            <Label className="text-base font-semibold mb-3 block">Where are you migrating from?</Label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {(['bookingkoala', 'jobber', 'other'] as Source[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setSource(s)}
                  className={cn(
                    "p-6 rounded-xl border-2 transition-all text-left",
                    source === s
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50"
                  )}
                >
                  <p className="font-bold text-lg">{s === 'bookingkoala' ? 'BookingKoala' : s === 'jobber' ? 'Jobber' : 'Other CSV'}</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {s === 'bookingkoala' ? 'Import from BookingKoala CRM' : s === 'jobber' ? 'Import from Jobber platform' : 'Any spreadsheet exported as CSV'}
                  </p>
                </button>
              ))}
            </div>
          </div>

          <Separator />

          <div>
            <Label className="text-base font-semibold mb-3 block">What data are you importing?</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(Object.entries(DATA_TYPE_CONFIG) as [DataType, typeof DATA_TYPE_CONFIG['customers']][]).map(([key, config]) => {
                const Icon = config.icon;
                return (
                  <button
                    key={key}
                    onClick={() => setDataType(key)}
                    className={cn(
                      "p-4 rounded-lg border-2 transition-all text-left flex items-start gap-3",
                      dataType === key
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50"
                    )}
                  >
                    <Icon className={cn("w-5 h-5 mt-0.5", dataType === key ? "text-primary" : "text-muted-foreground")} />
                    <div>
                      <p className="font-medium">{config.label}</p>
                      <p className="text-xs text-muted-foreground">{config.description}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <Button
            className="w-full"
            size="lg"
            disabled={!source || !dataType}
            onClick={() => setStep(2)}
          >
            Continue <ArrowRight className="ml-2 w-4 h-4" />
          </Button>
        </div>
      )}

      {/* Step 2: Upload CSV */}
      {step === 2 && (
        <div className="space-y-6">
          <Card className="border-dashed border-2">
            <CardContent className="flex flex-col items-center justify-center py-12">
              {parsing ? (
                <div className="text-center space-y-3">
                  <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto" />
                  <p className="font-medium">Parsing your CSV...</p>
                  <p className="text-sm text-muted-foreground">Auto-detecting columns and mapping fields</p>
                </div>
              ) : (
                <>
                  <Upload className="w-12 h-12 text-muted-foreground mb-4" />
                  <p className="font-medium text-lg mb-1">Upload your CSV export</p>
                  <p className="text-sm text-muted-foreground mb-4">
                    Export your {dataType} from {source === 'bookingkoala' ? 'BookingKoala' : 'Jobber'} as CSV
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <Button onClick={() => fileInputRef.current?.click()} size="lg">
                    <FileText className="w-4 h-4 mr-2" />
                    Select CSV File
                  </Button>
                  <p className="text-xs text-muted-foreground mt-3">Max 10MB • CSV format only</p>
                </>
              )}
            </CardContent>
          </Card>

          <div className="bg-muted/50 rounded-lg p-4">
            <p className="font-medium text-sm mb-2">💡 How to export from {source === 'bookingkoala' ? 'BookingKoala' : 'Jobber'}:</p>
            {source === 'bookingkoala' ? (
              <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                <li>Log into your BookingKoala admin panel</li>
                <li>Go to the {dataType} section</li>
                <li>Click "Export" or "Download CSV"</li>
                <li>Upload the downloaded file here</li>
              </ol>
            ) : (
              <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                <li>Log into your Jobber account</li>
                <li>Navigate to {dataType} in Reports or the main section</li>
                <li>Use the "Export" option to download as CSV</li>
                <li>Upload the downloaded file here</li>
              </ol>
            )}
          </div>

          <Button variant="outline" onClick={() => setStep(1)}>
            <ArrowLeft className="w-4 h-4 mr-2" /> Back
          </Button>
        </div>
      )}

      {/* Step 3: Map & Preview */}
      {step === 3 && parseResult && dataType && (
        <div className="space-y-6">
          {/* Summary */}
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardContent className="pt-4 text-center">
                <p className="text-2xl font-bold">{parseResult.totalRows}</p>
                <p className="text-xs text-muted-foreground">Total Rows</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 text-center">
                <p className="text-2xl font-bold text-primary">{mappedFieldCount}</p>
                <p className="text-xs text-muted-foreground">Mapped Fields</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 text-center">
                <p className="text-2xl font-bold text-warning">{parseResult.duplicateRows}</p>
                <p className="text-xs text-muted-foreground">Duplicates</p>
              </CardContent>
            </Card>
          </div>

          {/* Field Mapping */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Field Mapping</CardTitle>
              <CardDescription>Review and adjust how CSV columns map to your fields</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {parseResult.headers.map((header) => (
                <div key={header} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <Badge variant="outline" className="font-mono text-xs truncate max-w-full">
                      {header}
                    </Badge>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
                  <Select
                    value={fieldMapping[header] || ''}
                    onValueChange={(val) => updateMapping(header, val)}
                  >
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="Map to..." />
                    </SelectTrigger>
                    <SelectContent>
                      {TARGET_FIELDS[dataType].map((field) => (
                        <SelectItem key={field.value} value={field.value || '__skip__'}>
                          {field.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Preview */}
          {parseResult.preview.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Data Preview</CardTitle>
                <CardDescription>First {parseResult.preview.length} rows</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        {parseResult.headers.slice(0, 5).map(h => (
                          <th key={h} className="text-left p-2 font-medium text-muted-foreground">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {parseResult.preview.map((row, i) => (
                        <tr key={i} className="border-b last:border-0">
                          {parseResult.headers.slice(0, 5).map(h => (
                            <td key={h} className="p-2 truncate max-w-[150px]">{row[h] || '—'}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setStep(2)}>
              <ArrowLeft className="w-4 h-4 mr-2" /> Back
            </Button>
            <Button
              className="flex-1"
              size="lg"
              onClick={handleImport}
              disabled={importing || mappedFieldCount === 0}
            >
              {importing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Importing {parseResult.totalRows - parseResult.duplicateRows} records...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4 mr-2" />
                  Import {parseResult.totalRows - parseResult.duplicateRows} Records
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Step 4: Complete */}
      {step === 4 && importResult && (
        <div className="space-y-6">
          <div className="text-center py-8">
            <CheckCircle2 className="w-16 h-16 text-success mx-auto mb-4" />
            <h2 className="text-2xl font-bold mb-2">Migration Complete!</h2>
            <p className="text-muted-foreground">Your data has been successfully imported</p>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <Card className="border-success/20 bg-success/10">
              <CardContent className="pt-4 text-center">
                <CheckCircle2 className="w-5 h-5 text-success mx-auto mb-1" />
                <p className="text-2xl font-bold text-success">{importResult.imported}</p>
                <p className="text-xs text-success">Imported</p>
              </CardContent>
            </Card>
            <Card className="border-warning/20 bg-warning/10">
              <CardContent className="pt-4 text-center">
                <AlertCircle className="w-5 h-5 text-warning mx-auto mb-1" />
                <p className="text-2xl font-bold text-warning">{importResult.skipped}</p>
                <p className="text-xs text-warning">Skipped (Duplicates)</p>
              </CardContent>
            </Card>
            <Card className={cn(
              importResult.errors > 0 ? "border-destructive/20 bg-destructive/10" : "border-success/20 bg-success/10"
            )}>
              <CardContent className="pt-4 text-center">
                {importResult.errors > 0 ? (
                  <X className="w-5 h-5 text-destructive mx-auto mb-1" />
                ) : (
                  <CheckCircle2 className="w-5 h-5 text-success mx-auto mb-1" />
                )}
                <p className={cn("text-2xl font-bold", importResult.errors > 0 ? "text-destructive" : "text-success")}>
                  {importResult.errors}
                </p>
                <p className={cn("text-xs", importResult.errors > 0 ? "text-destructive" : "text-success")}>Errors</p>
              </CardContent>
            </Card>
          </div>

          {importResult.errorLog.length > 0 && (
            <Card className="border-destructive/20">
              <CardHeader>
                <CardTitle className="text-base text-destructive">Error Details</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  {importResult.errorLog.map((err, i) => (
                    <div key={i} className="flex gap-2 text-sm">
                      <Badge variant="destructive" className="shrink-0">Row {err.row_number}</Badge>
                      <span className="text-muted-foreground">{err.error}</span>
                    </div>
                  ))}
                {importResult.errorLogTruncated && (
                  <p className="text-xs text-muted-foreground pt-1">
                    Showing {importResult.errorLog.length} of {importResult.errorLogTotal}.
                    Fix these, re-import, and the rest will be listed.
                  </p>
                )}
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex gap-3">
            <Button variant="outline" onClick={reset} className="flex-1">
              <RotateCcw className="w-4 h-4 mr-2" /> Import More Data
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
