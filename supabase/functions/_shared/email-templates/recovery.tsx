import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Html, Preview, Section, Text,
} from 'https://esm.sh/@react-email/components@0.0.22?deps=react@18.3.1'
import { styles } from './_brand.ts'
import { Logo } from './_logo.tsx'
import { Footer } from './_footer.tsx'

interface Props { siteName?: string; confirmationUrl?: string }

export const RecoveryEmail = ({ confirmationUrl }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Reset your TidyWise password</Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <Logo />
        <Heading style={styles.h1}>Reset your password</Heading>
        <Text style={styles.text}>Click below to reset your password.</Text>
        <Section style={styles.buttonWrap}>
          <Button href={confirmationUrl} style={styles.button}>Reset password</Button>
        </Section>
        <Text style={styles.hint}>
          If you didn't request a password reset, you can safely ignore this email.
        </Text>
        <Footer />
      </Container>
    </Body>
  </Html>
)

export default RecoveryEmail
