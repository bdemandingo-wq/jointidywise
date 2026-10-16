import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { PRIVACY_POLICY_EFFECTIVE_DATE, PrivacyPolicyBody } from "@/components/legal/privacyContent";

interface PrivacyPolicyDialogProps {
  children: React.ReactNode;
}

/**
 * Signup copy of the privacy policy. Same wording as /privacy-policy
 * (privacyContent.tsx). Do not inline a second version here.
 */
export function PrivacyPolicyDialog({ children }: PrivacyPolicyDialogProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">Privacy Policy</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Effective date: {PRIVACY_POLICY_EFFECTIVE_DATE}</p>
        <PrivacyPolicyBody openLinksInNewTab />
      </DialogContent>
    </Dialog>
  );
}
