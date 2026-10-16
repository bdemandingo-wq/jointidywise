// The fullscreen booking-photo viewer is z-[10000]. Delete used to call
// confirmDialog(), which mounts a second Radix alert at z-50. That alert
// paints behind the viewer, Radix sets pointer-events: none on the lower
// layer, and the X button stops receiving taps. iOS TestFlight then sits
// frozen until the app is force-quit.
//
// node --experimental-strip-types --test src/pages/admin/bookingPhotoViewerDelete.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const src = readFileSync(new URL('./BookingPhotosPage.tsx', import.meta.url), 'utf8');

function functionBody(name: string): string {
  const start = src.indexOf(`const ${name} = `);
  assert.notEqual(start, -1, `could not find const ${name}`);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

test('delete confirm is inside the viewer, not a second modal', () => {
  assert.equal(src.includes('confirmDialog'), true); // named in the comment that explains why it is not called
  assert.equal(/import\s[^;]*confirmDialog/.test(src), false);
  assert.equal(src.includes('window.confirm'), false);

  const handleDelete = functionBody('handleDelete');
  assert.equal(handleDelete.includes('confirmDialog'), false);
  assert.equal(handleDelete.includes('window.confirm'), false);
  assert.match(src, /onClick=\{\(\) => setPendingDelete\(selectedPhoto\)\}/);
  assert.match(src, /role="alertdialog"/);
  assert.match(src, /Delete this \{isVideoMedia\(pendingDelete\) \? 'video' : 'photo'\}\?/);
  assert.match(src, /This cannot be undone\./);
  assert.match(src, /void handleDelete\(photo\)/);

  const cancelAt = handleDelete.indexOf('await queryClient.cancelQueries');
  const optimisticAt = handleDelete.indexOf('withoutMediaId(current');
  assert.ok(cancelAt !== -1 && optimisticAt !== -1 && cancelAt < optimisticAt);
  assert.match(handleDelete, /setViewerId\(neighbor\?\.id \?\? null\)/);
});

test('closing the viewer wins over an in-flight delete, including a failed one', () => {
  const closeViewer = functionBody('closeViewer');
  assert.match(closeViewer, /viewerCloseToken\.current \+= 1/);
  assert.match(closeViewer, /setPendingDelete\(null\)/);
  assert.match(closeViewer, /setViewerId\(null\)/);

  const handleDelete = functionBody('handleDelete');
  assert.match(handleDelete, /viewerCloseToken\.current === tokenAtStart/);
  assert.match(handleDelete, /if \(stillOpen\(\)\) setViewerId\(previousViewerId\)/);
  assert.match(src, /onOpenChange=\{\(open\) => \{ if \(!open\) closeViewer\(\); \}\}/);

  const requestClose = functionBody('requestClose');
  assert.match(requestClose, /if \(pendingDelete\)/);
  assert.match(requestClose, /closeViewer\(\)/);
});

test('viewer header clears the status bar, and the X stays above the confirm', () => {
  const marker = 'className="portal-v2 !pointer-events-auto';
  const openQuote = src.indexOf(marker) + 'className="'.length;
  assert.ok(openQuote > 'className="'.length);
  const contentClass = src.slice(openQuote, src.indexOf('"', openQuote));
  // !p-0 is padding: 0 !important, so a non-important padding-top on this
  // same element never applies. The title and the counter live in the header.
  // The close button's top offset is a separate property and does apply.
  assert.match(contentClass, /!p-0/);
  assert.equal(/pt-\[env\(safe-area-inset-top/.test(contentClass), false);
  assert.match(contentClass, /\[&>button\]:!top-\[max\(4px,env\(safe-area-inset-top\)\)\]/);
  assert.match(src, /pt-\[calc\(env\(safe-area-inset-top,0px\)\+1rem\)\]/);
  assert.match(src, /pb-\[max\(0\.75rem,env\(safe-area-inset-bottom,0px\)\)\]/);

  assert.match(contentClass, /!pointer-events-auto/);
  assert.match(contentClass, /\[&>button\]:!pointer-events-auto/);
  assert.match(contentClass, /\[&>button\]:!z-\[60\]/);
  assert.match(src, /absolute inset-0 z-40/);
});
