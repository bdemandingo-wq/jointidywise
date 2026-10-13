import { useState, useEffect } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Loader2, Video, Plus, Trash2, GripVertical, Play } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import { useOrgId } from '@/hooks/useOrgId';
import { useAuth } from '@/hooks/useAuth';
import { SEOHead } from '@/components/SEOHead';
import { SUPPORT_EMAIL } from '@/lib/supportEmail';

// Login identity for the "manage videos" controls. Not the public support
// inbox — see platformOwner.ts. Swapping this for SUPPORT_EMAIL would hide
// those controls from the account that actually signs in.
const PLATFORM_ADMIN_EMAIL = 'support@tidywisecleaning.com';

/** Extract a thumbnail URL from a Loom/YouTube/Vimeo embed URL. */
function getThumbnailUrl(embedUrl: string): string | null {
  // YouTube: https://www.youtube.com/embed/VIDEO_ID
  const ytMatch = embedUrl.match(/youtube\.com\/embed\/([^?&/]+)/);
  if (ytMatch) return `https://img.youtube.com/vi/${ytMatch[1]}/hqdefault.jpg`;

  // Loom: cdn.loom.com/sessions/thumbnails/ returns 403 (hotlink-blocked).
  // Loom's oEmbed API could provide thumbnails but requires a server-side
  // call. Fall through to the plain card with play icon instead.

  // Vimeo: thumbnails require an API call, so no static URL available.
  return null;
}

/** Same Loom URL stored twice (global row plus an org copy) was listing the
 * payroll video two or three times. Compare the URL without its query string. */
function dedupeHelpVideos(rows: HelpVideo[]): HelpVideo[] {
  const seen = new Set<string>();
  const unique: HelpVideo[] = [];
  for (const row of rows) {
    const key = (row.loom_url || '').split('?')[0].trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }
  return unique;
}

interface HelpVideo {
  id: string;
  title: string;
  description: string | null;
  loom_url: string;
  sort_order: number | null;
  created_at: string;
  organization_id: string | null;
}

export default function HelpPage() {
  const { organizationId } = useOrgId();
  const { user } = useAuth();
  const [videos, setVideos] = useState<HelpVideo[]>([]);
  
  const isPlatformAdmin = user?.email === PLATFORM_ADMIN_EMAIL;
  const [loading, setLoading] = useState(true);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [videoToDelete, setVideoToDelete] = useState<HelpVideo | null>(null);
  const [saving, setSaving] = useState(false);
  
  // New video form state
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newUrl, setNewUrl] = useState('');
  // Click-to-play: only the tapped video loads its iframe
  const [playingVideoId, setPlayingVideoId] = useState<string | null>(null);

  useEffect(() => {
    if (organizationId) {
      fetchVideos();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchVideos is recreated each render; runs once per org
  }, [organizationId]);

  const fetchVideos = async () => {
    if (!organizationId) return;
    try {
      // Fetch global videos (organization_id is null) and org-specific videos
      const { data, error } = await supabase
        .from('help_videos')
        .select('*')
        .or(`organization_id.is.null,organization_id.eq.${organizationId}`)
        .order('sort_order', { ascending: true });

      if (error) throw error;
      setVideos(dedupeHelpVideos(data || []));
    } catch (error) {
      console.error('Error fetching videos:', error);
      toast.error('Failed to load help videos');
    } finally {
      setLoading(false);
    }
  };

  const convertToEmbedUrl = (url: string): string => {
    // Convert Loom share URLs to embed URLs
    if (url.includes('loom.com/share/')) {
      return url.replace('loom.com/share/', 'loom.com/embed/');
    }
    // Convert YouTube URLs to embed URLs. Fall through to the original URL if
    // the id can't be parsed — otherwise we'd render <iframe src=".../embed/undefined">,
    // which is a silent white frame with no clue what went wrong.
    if (url.includes('youtube.com/watch?v=')) {
      const videoId = url.split('v=')[1]?.split('&')[0];
      if (!videoId) return url;
      return `https://www.youtube.com/embed/${videoId}`;
    }
    if (url.includes('youtu.be/')) {
      const videoId = url.split('youtu.be/')[1]?.split('?')[0];
      if (!videoId) return url;
      return `https://www.youtube.com/embed/${videoId}`;
    }
    // Convert Vimeo URLs to embed URLs
    if (url.includes('vimeo.com/') && !url.includes('player.vimeo.com')) {
      const videoId = url.split('vimeo.com/')[1]?.split('?')[0];
      if (!videoId) return url;
      return `https://player.vimeo.com/video/${videoId}`;
    }
    return url;
  };

  const handleAddVideo = async () => {
    if (!newTitle.trim() || !newUrl.trim()) {
      toast.error('Please fill in the title and video URL');
      return;
    }

    setSaving(true);
    try {
      const embedUrl = convertToEmbedUrl(newUrl.trim());
      const maxSortOrder = videos.length > 0 
        ? Math.max(...videos.map(v => v.sort_order || 0)) 
        : 0;

      const { error } = await supabase
        .from('help_videos')
        .insert([{
          title: newTitle.trim(),
          description: newDescription.trim() || null,
          loom_url: embedUrl,
          sort_order: maxSortOrder + 1,
          organization_id: isPlatformAdmin ? null : organizationId,
        }]);

      if (error) throw error;

      toast.success('Video added successfully');
      setAddDialogOpen(false);
      setNewTitle('');
      setNewDescription('');
      setNewUrl('');
      fetchVideos();
    } catch (error) {
      console.error('Error adding video:', error);
      toast.error('Failed to add video');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteVideo = async () => {
    if (!videoToDelete) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('help_videos')
        .delete()
        .eq('id', videoToDelete.id);

      if (error) throw error;

      toast.success('Video removed successfully');
      setDeleteDialogOpen(false);
      setVideoToDelete(null);
      fetchVideos();
    } catch (error) {
      console.error('Error deleting video:', error);
      toast.error('Failed to remove video');
    } finally {
      setSaving(false);
    }
  };

  const openDeleteDialog = (video: HelpVideo) => {
    setVideoToDelete(video);
    setDeleteDialogOpen(true);
  };

  if (loading) {
    return (
      <AdminLayout title="Help Center" subtitle="Tutorial videos and support">
<div className="portal-v2 portal-v2-scroll">
      <SEOHead title="Help Center | TidyWise" description="Get help and support for your account" noIndex />
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </div>
</AdminLayout>
    );
  }

  return (
    <AdminLayout
      title="Help Center"
      subtitle="Tutorial videos and support"
      actions={
        isPlatformAdmin ? (
          <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="btn-hover whitespace-nowrap">
                <Plus className="w-4 h-4 mr-1" />
                Add Video
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Tutorial Video</DialogTitle>
                <DialogDescription>
                  Add a video from Loom, YouTube, or Vimeo. The URL will be automatically converted for embedding.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="title">Title *</Label>
                  <Input
                    id="title"
                    placeholder="e.g., How to create a booking"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="url">Video URL *</Label>
                  <Input
                    id="url"
                    placeholder="https://www.loom.com/share/..."
                    value={newUrl}
                    onChange={(e) => setNewUrl(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Supports Loom, YouTube, and Vimeo links
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description (optional)</Label>
                  <Textarea
                    id="description"
                    placeholder="Brief description of what this video covers..."
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    rows={3}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleAddVideo} disabled={saving}>
                  {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Add Video
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : undefined
      }
    >
<div className="portal-v2 portal-v2-scroll">
      <div className="space-y-8">
        {/* Videos Section */}
        <div data-tour-id="help-videos">
          <h2 className="text-lg font-semibold mb-4">Tutorial Videos</h2>
          
          {videos.length === 0 ? (
            <Card className="py-16">
              <CardContent className="flex flex-col items-center justify-center text-center">
                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                  <Video className="w-8 h-8 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-semibold mb-2">No Help Videos Yet</h3>
                <p className="text-muted-foreground max-w-md mb-4">
                  {isPlatformAdmin 
                    ? 'Add tutorial videos to help your team learn how to use the system.'
                    : 'Tutorial videos will appear here once they are added.'}
                </p>
                {isPlatformAdmin && (
                  <Button onClick={() => setAddDialogOpen(true)}>
                    <Plus className="w-4 h-4 mr-2" />
                    Add Your First Video
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {videos.map((video, index) => (
                <Card 
                  key={video.id} 
                  className="overflow-hidden group animate-stagger-in"
                  style={{ animationDelay: `${index * 0.05}s` }}
                >
                  <div className="aspect-video bg-muted relative">
                    {playingVideoId === video.id ? (
                      <iframe
                        src={video.loom_url + (video.loom_url.includes('?') ? '&' : '?') + 'autoplay=1'}
                        title={video.title || 'Help video'}
                        frameBorder="0"
                        allowFullScreen
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        className="absolute inset-0 w-full h-full"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setPlayingVideoId(video.id)}
                        className="absolute inset-0 w-full h-full flex items-center justify-center group/play cursor-pointer"
                      >
                        {(() => {
                          const thumb = getThumbnailUrl(video.loom_url);
                          return thumb ? (
                            <img
                              src={thumb}
                              alt={video.title}
                              className="absolute inset-0 w-full h-full object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="absolute inset-0 w-full h-full flex flex-col items-center justify-center gap-2 bg-muted">
                              <Video className="w-8 h-8 text-muted-foreground" />
                              <span className="text-xs text-muted-foreground font-medium">{video.title}</span>
                            </div>
                          );
                        })()}
                        <div className="relative z-10 w-14 h-14 rounded-full bg-black/60 flex items-center justify-center group-hover/play:bg-black/80 transition-colors">
                          <Play className="w-6 h-6 text-white fill-white ml-0.5" />
                        </div>
                      </button>
                    )}
                  </div>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold truncate">{video.title}</h3>
                        {video.description && (
                          <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                            {video.description}
                          </p>
                        )}
                      </div>
                      {isPlatformAdmin && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => openDeleteDialog(video)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Contact Section */}
        <Card>
          <CardHeader>
            <CardTitle>Contact Us</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">
              Have a question or idea? Email us at{' '}
              <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary underline">
                {SUPPORT_EMAIL}
              </a>
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Video</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove "{videoToDelete?.title}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteVideo}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={saving}
            >
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
</AdminLayout>
  );
}
