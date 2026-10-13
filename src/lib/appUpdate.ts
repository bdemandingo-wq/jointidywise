/** Remember a dismissed remote build so the same deploy does not nag again. */
export const DISMISSED_BUILD_KEY = "tw-dismissed-build-id";

/**
 * Offer a reload only when the deployed build id differs from the id baked
 * into this page. Comparison is string equality: "010" and "10" are different
 * builds. A missing id, a failed fetch, or a dismissal of this exact remote
 * id stays quiet.
 */
export function shouldOfferAppUpdate(input: {
  localBuildId: string | null | undefined;
  remoteBuildId: string | null | undefined;
  dismissedBuildId: string | null | undefined;
}): boolean {
  const local = (input.localBuildId ?? "").trim();
  const remote = (input.remoteBuildId ?? "").trim();
  if (!local || !remote) return false;
  if (local === remote) return false;
  if ((input.dismissedBuildId ?? "").trim() === remote) return false;
  return true;
}
