export function isUnsupportedImageTransformation(status: number, message: string): boolean {
  return [400, 403, 404, 501].includes(status) && /transform|image resizing|not supported|not enabled|feature.*not|plan|render.*not/i.test(message);
}