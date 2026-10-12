import { useRef, useState } from 'react';
import { Camera, X, CheckCircle, Loader2, ImageIcon, AlertTriangle, Package, BarChart2, Plus, Send } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/lib/supabase';
import { uploadBookingMedia } from '@/lib/bookingMediaUpload';
import { toast } from 'sonner';
import { useNativeCamera } from '@/hooks/useNativeCamera';

interface InspectionItem {
  file: File;
  previewUrl: string;
  category: 'broken' | 'missing' | 'low_inventory' | 'general';
  note: string;
  captureExif?: unknown;
  liveCapture?: boolean;
}

interface PropertyInspectionUploadProps {
  bookingId: string;
  staffId: string;
  organizationId: string;
  onSubmitted?: () => void;
}

const CATEGORY_CONFIG = {
  broken: { label: 'Broken', icon: AlertTriangle, color: 'bg-destructive/10 text-destructive border-destructive/20' },
  missing: { label: 'Missing', icon: Package, color: 'bg-warning/10 text-warning border-warning/20' },
  low_inventory: { label: 'Low Inventory', icon: BarChart2, color: 'bg-warning/10 text-warning border-warning/20' },
  general: { label: 'General Note', icon: Camera, color: 'bg-info/10 text-info border-info/20' },
} as const;

const PICKER_CLASS = 'absolute left-0 top-0 h-px w-px opacity-0 pointer-events-none';
const PHOTO_MAX_SIZE = 10 * 1024 * 1024;

export function PropertyInspectionUpload({ bookingId, staffId, organizationId, onSubmitted }: PropertyInspectionUploadProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [items, setItems] = useState<InspectionItem[]>([]);
  const [activeCategory, setActiveCategory] = useState<InspectionItem['category']>('broken');
  const [pendingFile, setPendingFile] = useState<{ file: File; previewUrl: string; captureExif?: unknown; liveCapture?: boolean } | null>(null);
  const [pendingNote, setPendingNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const { isNative, takePicture, pickFromGallery } = useNativeCamera();

  const clearPending = () => {
    if (pendingFile?.previewUrl.startsWith('blob:')) URL.revokeObjectURL(pendingFile.previewUrl);
    setPendingFile(null);
    setPendingNote('');
    if (cameraRef.current) cameraRef.current.value = '';
    if (galleryRef.current) galleryRef.current.value = '';
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>, fromCamera: boolean) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > PHOTO_MAX_SIZE) { toast.error('Photo must be under 10MB'); return; }
    setPendingFile({ file, previewUrl: URL.createObjectURL(file), liveCapture: fromCamera });
  };

  const handleNativeCamera = async () => {
    const result = await takePicture('camera');
    if (result?.file && result.dataUrl) {
      setPendingFile({ file: result.file, previewUrl: result.dataUrl, captureExif: result.exif, liveCapture: true });
    }
  };

  const handleNativeGallery = async () => {
    const result = await pickFromGallery();
    if (result?.file && result.dataUrl) {
      setPendingFile({ file: result.file, previewUrl: result.dataUrl, captureExif: result.exif, liveCapture: false });
    }
  };

  const addItem = () => {
    if (!pendingFile) return;
    setItems(prev => [...prev, {
      file: pendingFile.file,
      previewUrl: pendingFile.previewUrl,
      category: activeCategory,
      note: pendingNote.trim(),
      captureExif: pendingFile.captureExif,
      liveCapture: pendingFile.liveCapture,
    }]);
    setPendingFile(null);
    setPendingNote('');
  };

  const removeItem = (index: number) => {
    setItems(prev => {
      const item = prev[index];
      if (item.previewUrl.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleSubmit = async () => {
    if (items.length === 0) { toast.error('Add at least one photo to submit the report'); return; }
    setSubmitting(true);
    setUploadProgress(0);

    try {
      const { data: bookingData } = await supabase
        .from('bookings')
        .select('id, organization_id')
        .eq('id', bookingId)
        .maybeSingle();

      if (!bookingData) throw new Error('Booking not found');
      const resolvedOrgId = bookingData.organization_id || organizationId;

      const step = 100 / items.length;

      // Per-item, not all-or-nothing. A cleaner standing in a property who
      // loses four good photos because the third insert timed out has to
      // re-shoot the lot; keeping what succeeded and naming what didn't is the
      // kinder failure. uploadBookingMedia still rolls back the storage object
      // for whichever item failed, so nothing is orphaned either way.
      const failed: number[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        try {
          await uploadBookingMedia({
            file: item.file,
            bookingId,
            staffId,
            photoType: 'inspection',
            organizationIdFallback: organizationId,
            index: i,
            captureExif: item.captureExif,
            liveCapture: item.liveCapture,
            extra: {
              inspection_note: item.note || null,
              issue_category: item.category,
            },
          });
        } catch (err) {
          console.error(`Inspection photo ${i + 1} failed:`, err);
          failed.push(i + 1);
        }
        setUploadProgress(Math.round((i + 1) * step));
      }

      const uploadedCount = items.length - failed.length;
      if (uploadedCount === 0) {
        throw new Error(
          items.length === 1
            ? 'The photo could not be uploaded. Please try again.'
            : 'None of the photos could be uploaded. Please try again.',
        );
      }
      if (failed.length > 0) {
        toast.warning(
          `${uploadedCount} of ${items.length} photos uploaded. Photo${failed.length > 1 ? 's' : ''} ${failed.join(', ')} failed. You can add ${failed.length > 1 ? 'those' : 'that one'} again.`,
          { duration: 8000 },
        );
      }

      // Notify admin that an inspection report was submitted
      try {
        await supabase.from('admin_system_notifications').insert({
          organization_id: resolvedOrgId,
          type: 'staff_activity',
          title: '🔍 Inspection report submitted',
          message: `Staff submitted ${uploadedCount} inspection photo${uploadedCount === 1 ? '' : 's'} for booking #${bookingId.slice(0, 8)}`,
          link: `/admin/bookings/${bookingId}/photos`,
          metadata: { booking_id: bookingId, staff_id: staffId, count: uploadedCount },
        });
      } catch (notifyErr) {
        console.warn('Admin notification insert failed:', notifyErr);
      }

      // Report what actually landed, not what was attempted. This said
      // items.length, so after a warning naming which photos failed it claimed
      // all of them were submitted — the two toasts contradicted each other.
      //
      // And when some failed, KEEP them. The warning tells the cleaner they can
      // add those again; clearing the list and closing the dialog destroyed the
      // photo, the note and the category, so the thing it promised was
      // impossible. Only the ones that succeeded are removed.
      if (failed.length > 0) {
        const failedIdx = new Set(failed.map((n) => n - 1));
        setItems((prev) => prev.filter((_, i) => failedIdx.has(i)));
        onSubmitted?.();
        return; // dialog stays open, holding exactly what still needs sending
      }

      toast.success(`Inspection report submitted (${uploadedCount} photo${uploadedCount === 1 ? '' : 's'})`);
      setItems([]);
      setIsOpen(false);
      onSubmitted?.();
    } catch (err: any) {
      console.error('Inspection submit error:', err);
      const reason = err?.message || err?.error_description || err?.error || 'Unknown error';
      toast.error(`Couldn't submit report: ${reason}`);
    } finally {
      setSubmitting(false);
      setUploadProgress(0);
    }
  };

  const close = () => {
    clearPending();
    setIsOpen(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) close(); setIsOpen(open); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <AlertTriangle className="w-4 h-4" />
          Inspection Report
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Property Inspection Report</DialogTitle>
          <p className="text-sm text-muted-foreground">Document anything broken, missing, or low on inventory. Photos go to the client and admin.</p>
        </DialogHeader>

        <div className="space-y-4">
          {/* Category selector */}
          <div>
            <p className="text-sm font-medium mb-2">Issue type</p>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(CATEGORY_CONFIG) as InspectionItem['category'][]).map((cat) => {
                const { label, icon: Icon, color } = CATEGORY_CONFIG[cat];
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setActiveCategory(cat)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-all ${
                      activeCategory === cat ? color + ' ring-2 ring-offset-1 ring-current' : 'border-border bg-background hover:bg-muted'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Photo capture */}
          {!pendingFile ? (
            <div>
              <p className="text-sm font-medium mb-2">Take a photo</p>
              <input ref={cameraRef} type="file" accept="image/*" capture="environment" tabIndex={-1} className={PICKER_CLASS} onChange={(event) => handleFileSelect(event, true)} />
              <input ref={galleryRef} type="file" accept="image/*" tabIndex={-1} className={PICKER_CLASS} onChange={(event) => handleFileSelect(event, false)} />
              <div className="flex gap-2">
                {isNative && Capacitor.isNativePlatform() ? (
                  <>
                    <Button type="button" variant="outline" className="flex-1 h-20 flex flex-col gap-1" onClick={handleNativeCamera}>
                      <Camera className="w-6 h-6" />
                      <span className="text-xs">Camera</span>
                    </Button>
                    <Button type="button" variant="outline" className="flex-1 h-20 flex flex-col gap-1" onClick={handleNativeGallery}>
                      <ImageIcon className="w-6 h-6" />
                      <span className="text-xs">Gallery</span>
                    </Button>
                  </>
                ) : (
                  <>
                    <Button type="button" variant="outline" className="flex-1 h-20 flex flex-col gap-1" onClick={() => cameraRef.current?.click()}>
                      <Camera className="w-6 h-6" />
                      <span className="text-xs">Camera</span>
                    </Button>
                    <Button type="button" variant="outline" className="flex-1 h-20 flex flex-col gap-1" onClick={() => galleryRef.current?.click()}>
                      <ImageIcon className="w-6 h-6" />
                      <span className="text-xs">Gallery</span>
                    </Button>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="relative">
                <img src={pendingFile.previewUrl} alt="Preview" className="w-full h-40 object-cover rounded-lg" height={160} />
                <Button type="button" variant="destructive" size="icon" className="absolute top-2 right-2 w-7 h-7" onClick={clearPending}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <Textarea
                placeholder={`Describe what's ${CATEGORY_CONFIG[activeCategory].label.toLowerCase()}... (optional)`}
                value={pendingNote}
                onChange={(e) => setPendingNote(e.target.value)}
                className="resize-none min-h-[80px]"
              />
              <Button type="button" className="w-full gap-2" onClick={addItem}>
                <Plus className="w-4 h-4" />
                Add to Report
              </Button>
            </div>
          )}

          {/* Items queued */}
          {items.length > 0 && (
            <div>
              <p className="text-sm font-medium mb-2">Report items ({items.length})</p>
              <div className="space-y-2">
                {items.map((item, i) => {
                  const { label, color } = CATEGORY_CONFIG[item.category];
                  return (
                    <div key={i} className="flex items-start gap-3 p-3 border rounded-lg bg-muted/30">
                      <img src={item.previewUrl} alt="" className="w-14 h-14 object-cover rounded-md shrink-0" width={56} height={56} loading="lazy" />
                      <div className="flex-1 min-w-0">
                        <Badge variant="outline" className={`text-xs mb-1 ${color}`}>{label}</Badge>
                        {item.note && <p className="text-xs text-muted-foreground line-clamp-2">{item.note}</p>}
                      </div>
                      <Button type="button" variant="ghost" size="icon" className="w-7 h-7 shrink-0" onClick={() => removeItem(i)}>
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {submitting && (
            <div className="space-y-1">
              <Progress value={uploadProgress} className="h-2" />
              <p className="text-xs text-muted-foreground text-center">Uploading... {uploadProgress}%</p>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={close} disabled={submitting}>Cancel</Button>
            <Button className="flex-1 gap-2" onClick={handleSubmit} disabled={submitting || items.length === 0}>
              {submitting ? <><Loader2 className="w-4 h-4 animate-spin" />Sending...</> : <><Send className="w-4 h-4" />Send Report ({items.length})</>}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
