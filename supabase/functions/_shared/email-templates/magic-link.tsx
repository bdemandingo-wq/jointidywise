import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Section, Text,
} from 'https://esm.sh/@react-email/components@0.0.22?deps=react@18.3.1'
import { styles } from './_brand.ts'
import { Logo } from './_logo.tsx'
import { Footer } from './_footer.tsx'

interface Props { siteName?: string; token?: string }

export const MagicLinkEmail = ({ token }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your TidyWise password reset code: {token ?? ''}</Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <Logo />
        <Heading style={styles.h1}>Reset your password</Heading>
        <Text style={styles.text}>
          Enter this reset code on the password reset page to set a new password.
        </Text>
        <Section style={styles.codeBox}>
          <Text style={styles.code}>{token}</Text>
        </Section>
        <Text style={styles.hint}>
          This code expires in 1 hour. If you didn't request this, ignore this email.
        </Text>
        <Footer />
      </Container>
    </Body>
  </Html>
)

export default MagicLinkEmail
