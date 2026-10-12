/** Turn a raw mail-provider error into a sentence an owner can act on. */
export function plainInviteEmailError(raw: string | null | undefined): string {
  const text = (raw || '').toLowerCase();
  if (text.includes('not verified') || text.includes('domain is not') || text.includes("isn't verified") || text.includes('isn\'t verified')) {
    return "The invite was created, but the email couldn't be sent because the sending domain isn't verified yet. Copy the link and send it yourself, or verify the domain in Settings.";
  }
  if (text.includes('api key') || (text.includes('email') && text.includes("isn't set up"))) {
    return "The invite was created, but email isn't set up for this business yet. Copy the link and send it yourself.";
  }
  if (text.startsWith('the invite was created')) return raw || '';
  return "The invite was created, but the email didn't send. Copy the link and send it yourself.";
}
