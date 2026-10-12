import { useCallback, useRef, useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * In-app replacements for window.confirm / alert / prompt.
 *
 * Those native dialogs do nothing useful in the iOS webview: confirm()
 * returns false without a sheet, so a delete click looks like it was
 * ignored. Call confirmDialog() from any event handler; the provider
 * below has to be mounted (it is, in App).
 */

type Kind = "confirm" | "alert" | "prompt";

interface Pending {
  kind: Kind;
  title: string;
  description?: string;
  confirmLabel: string;
  destructive: boolean;
  defaultValue?: string;
  resolve: (value: boolean | string | null | undefined) => void;
}

let opener: ((pending: Pending) => void) | null = null;

function enqueue(pending: Pending): void {
  if (opener) {
    opener(pending);
    return;
  }
  // Provider not mounted (tests, a crash before App). Fail closed on
  // destructive confirms so a missing dialog cannot delete a row.
  if (pending.kind === "confirm") pending.resolve(false);
  else if (pending.kind === "prompt") pending.resolve(null);
  else pending.resolve(undefined);
}

export function confirmDialog(message: string, title = "Are you sure?"): Promise<boolean> {
  return new Promise((resolve) => {
    enqueue({
      kind: "confirm",
      title,
      description: message,
      confirmLabel: "Confirm",
      destructive: true,
      resolve: (value) => resolve(value === true),
    });
  });
}

export function alertDialog(message: string, title = "Notice"): Promise<void> {
  return new Promise((resolve) => {
    enqueue({
      kind: "alert",
      title,
      description: message,
      confirmLabel: "OK",
      destructive: false,
      resolve: () => resolve(),
    });
  });
}

export function promptDialog(message: string, defaultValue = ""): Promise<string | null> {
  return new Promise((resolve) => {
    enqueue({
      kind: "prompt",
      title: message,
      confirmLabel: "OK",
      destructive: false,
      defaultValue,
      resolve: (value) => resolve(typeof value === "string" ? value : null),
    });
  });
}

export function AppDialogsProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [promptValue, setPromptValue] = useState("");
  const queue = useRef<Pending[]>([]);
  const settled = useRef(false);

  const show = useCallback((next: Pending) => {
    setPending((current) => {
      if (current) {
        queue.current.push(next);
        return current;
      }
      settled.current = false;
      setPromptValue(next.defaultValue ?? "");
      return next;
    });
  }, []);

  opener = show;

  const settle = (value: boolean | string | null | undefined) => {
    if (settled.current) return;
    settled.current = true;
    setPending((current) => {
      current?.resolve(value);
      const queued = queue.current.shift() ?? null;
      if (queued) {
        settled.current = false;
        setPromptValue(queued.defaultValue ?? "");
      }
      return queued;
    });
  };

  return (
    <>
      {children}
      <AlertDialog
        open={!!pending}
        onOpenChange={(open) => {
          if (!open) {
            if (pending?.kind === "confirm") settle(false);
            else if (pending?.kind === "prompt") settle(null);
            else settle(undefined);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pending?.title}</AlertDialogTitle>
            {pending?.description ? (
              <AlertDialogDescription>{pending.description}</AlertDialogDescription>
            ) : null}
          </AlertDialogHeader>
          {pending?.kind === "prompt" ? (
            <Input
              autoFocus
              value={promptValue}
              onChange={(e) => setPromptValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  settle(promptValue);
                }
              }}
            />
          ) : null}
          <AlertDialogFooter>
            {pending?.kind !== "alert" ? (
              <AlertDialogCancel>Cancel</AlertDialogCancel>
            ) : null}
            <Button
              variant={pending?.destructive ? "destructive" : "default"}
              onClick={() => settle(pending?.kind === "prompt" ? promptValue : pending?.kind === "confirm" ? true : undefined)}
            >
              {pending?.confirmLabel ?? "OK"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
