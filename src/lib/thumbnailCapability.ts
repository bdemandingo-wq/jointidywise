export function isUnsupportedImageTransformation(status: number, message: string): boolean {
  // Match plan/feature refusals only. A bare "transform" also matches a single
  // bad file, and marking that as a bucket-wide miss turns every later photo
  // into a full-size original.
  return [400, 403, 404, 501].includes(status)
    && /image resizing|not supported|not enabled|feature.*not|render.*not/i.test(message);
}