import * as React from 'npm:react@18.3.1'
import { Hr, Link, Section, Text } from 'https://esm.sh/@react-email/components@0.0.22?deps=react@18.3.1'
import { TIDYWISE_SUPPORT_EMAIL } from '../email-footer.ts'
import { BRAND, styles } from './_brand.ts'

export const Footer = () => (
  <>
    <Hr style={styles.divider} />
    <Section style={styles.footer}>
      <Text style={styles.footerText}>
        TidyWise CRM — Cleaning business software
      </Text>
      <Text style={styles.footerText}>
        <Link href={BRAND.helpUrl} style={styles.footerLink}>Help Center</Link>
        ·
        <Link href={BRAND.privacyUrl} style={styles.footerLink}>Privacy</Link>
        ·
        <Link href={BRAND.termsUrl} style={styles.footerLink}>Terms</Link>
      </Text>
      <Text style={styles.footerText}>
        <Link href={`mailto:${TIDYWISE_SUPPORT_EMAIL}`} style={styles.footerLink}>
          {TIDYWISE_SUPPORT_EMAIL}
        </Link>
      </Text>
      <Text style={styles.footerText}>© 2026 TidyWise. All rights reserved.</Text>
    </Section>
  </>
)
