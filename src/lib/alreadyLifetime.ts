import { readEdgeFunctionErrorBody } from './edgeFunctionError';

/**
 * `create-subscription` and `buy-lifetime` answer a customer who already owns
 * lifetime access with a 409 and `{ alreadyLifetime: true }`. That is a correct,
 * expected refusal — not a failure to report as one.
 *
 * Callers used to let it fall through to the generic "checkout failed" path,
 * which read as if something had broken and left the page mid-redirect. Use
 * this to recognise it and say the reassuring thing instead.
 */
export async function isAlreadyLifetimeError(error: unknown): Promise<boolean> {
  const body = await readEdgeFunctionErrorBody(error);
  return (body as { alreadyLifetime?: boolean } | null)?.alreadyLifetime === true;
}

export const ALREADY_LIFETIME_MESSAGE =
  'You already have lifetime access — there is nothing to pay for.';
