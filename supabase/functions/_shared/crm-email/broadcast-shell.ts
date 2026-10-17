/**
 * Visual shell around the existing broadcast renderer.
 *
 * renderBroadcastHtml stays the source of the body, signature and the
 * marketing-only unsubscribe footer. Those rules are locked by
 * broadcast-render.test.ts. This shell is the branded wrapper: logo,
 * headline (the admin's subject) and the CAN-SPAM address. The shell's
 * own unsubscribe line is removed so a transactional broadcast does not
 * gain one, and so marketing does not show the link twice.
 */
import { PLATFORM_BROADCAST_HTML } from "./platform-broadcast-html.ts";
import { TIDYWISE_LOGO_URL, fillTemplate } from "./fill.ts";

const SLOT = /<!-- CONTENT SLOT START:[^>]*-->([\s\S]*?)<!-- CONTENT SLOT END -->/g;

export function wrapBroadcastDocument(args: {
  subject: string;
  innerHtml: string;
  logoUrl?: string;
}): string {
  let shell = PLATFORM_BROADCAST_HTML;
  shell = shell.replace(
    /<p style="margin:0;padding:8px 0 6px 0;[^"]*"[^>]*>[\s\S]*?\{\{UNSUBSCRIBE_URL\}\}[\s\S]*?<\/p>/,
    "",
  );
  let n = 0;
  shell = shell.replace(SLOT, () => {
    n += 1;
    return n === 1 ? "___BROADCAST_INNER___" : "";
  });
  const filled = fillTemplate(shell, {
    vars: {
      "b.subject": args.subject,
      LOGO_URL: args.logoUrl || TIDYWISE_LOGO_URL,
    },
  });
  // A function replacer leaves `$`, `$$`, and `$&` in the body alone.
  return filled.replace("___BROADCAST_INNER___", () => args.innerHtml);
}
