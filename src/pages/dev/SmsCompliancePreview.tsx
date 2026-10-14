import { Button } from "@/components/ui/button";

/**
 * Local-only mock of the inbox thread. Not linked from navigation.
 * Used to screenshot the CANCEL tag, the resubscribe line, and a START
 * that stays opted out, with no live data.
 */
export default function SmsCompliancePreview() {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col bg-background text-foreground">
      <div className="border-b px-3 py-2.5">
        <p className="text-sm font-medium">Jane Customer</p>
        <p className="text-xs text-muted-foreground">Client</p>
      </div>
      <div className="flex-1 space-y-4 px-3 py-4">
        <section id="cancel-thread" className="space-y-2">
          <p className="text-center text-[11px] font-medium text-muted-foreground">One-word CANCEL</p>
          <div className="flex flex-col items-start">
            <div className="mb-1 flex max-w-[75%] flex-wrap items-center gap-2">
              <p className="rounded-md bg-amber-500/15 px-2 py-1 text-[11px] font-medium leading-snug text-amber-800 dark:text-amber-300">
                Opted out of texts. They may want to cancel an appointment.
              </p>
              <Button variant="secondary" size="sm" asChild>
                <a href="tel:+18135550100">Call customer</a>
              </Button>
            </div>
            <div className="flex w-full justify-start">
              <div className="max-w-[75%] rounded-2xl bg-muted px-3.5 py-2 text-foreground">
                <p className="text-[15px] leading-snug whitespace-pre-wrap break-words">CANCEL</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">2:14 PM</p>
              </div>
            </div>
          </div>
        </section>
        <section id="resubscribed-thread" className="space-y-2">
          <p className="text-center text-[11px] font-medium text-muted-foreground">After START</p>
          <div className="flex flex-col items-start">
            <p className="w-full py-1 text-center text-[11px] text-muted-foreground">Resubscribed by text.</p>
            <div className="flex w-full justify-start">
              <div className="max-w-[75%] rounded-2xl bg-muted px-3.5 py-2 text-foreground">
                <p className="text-[15px] leading-snug whitespace-pre-wrap break-words">START</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">2:20 PM</p>
              </div>
            </div>
          </div>
        </section>
        <section id="manual-start-thread" className="space-y-2">
          <p className="text-center text-[11px] font-medium text-muted-foreground">START while opted out manually</p>
          <div className="flex flex-col items-start">
            <p className="mb-1 max-w-[75%] rounded-md bg-amber-500/15 px-2 py-1 text-[11px] font-medium leading-snug text-amber-800 dark:text-amber-300">
              Asked to resubscribe. Review before texting
            </p>
            <div className="flex w-full justify-start">
              <div className="max-w-[75%] rounded-2xl bg-muted px-3.5 py-2 text-foreground">
                <p className="text-[15px] leading-snug whitespace-pre-wrap break-words">START</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">2:22 PM</p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
