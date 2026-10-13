import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Html, Link, Preview, Section, Text,
} from 'https://esm.sh/@react-email/components@0.0.22?deps=react@18.3.1'
import { TIDYWISE_SUPPORT_EMAIL } from '../email-footer.ts'
import { styles } from './_brand.ts'
import { Logo } from './_logo.tsx'
import { Footer } from './_footer.tsx'

interface Props { siteName?: string; confirmationUrl?: string; email?: string; newEmail?: string }

export const EmailChangeEmail = ({ confirmationUrl }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Confirm your new email address</Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <Logo />
        <Heading style={styles.h1}>Confirm email change</Heading>
        <Text style={styles.text}>
          Click below to confirm your new email address for your TidyWise account.
        </Text>
        <Section style={styles.buttonWrap}>
          <Button href={confirmationUrl} style={styles.button}>Confirm new email</Button>
        </Section>
        <Text style={styles.hint}>
          If you didn't request this change, contact{' '}
          <Link href={`mailto:${TIDYWISE_SUPPORT_EMAIL}`} style={styles.link}>
            {TIDYWISE_SUPPORT_EMAIL}
          </Link>{' '}
          immediately.
        </Text>
        <Footer />
      </Container>
    </Body>
  </Html>
)

export default EmailChangeEmail
