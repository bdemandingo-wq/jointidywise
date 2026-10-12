/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body, Button, Container, Head, Heading, Html, Preview, Section, Text,
} from 'https://esm.sh/@react-email/components@0.0.22?deps=react@18.3.1'
import { styles } from './_brand.ts'
import { Logo } from './_logo.tsx'
import { Footer } from './_footer.tsx'

interface Props { siteName?: string; confirmationUrl?: string }

export const InviteEmail = ({ confirmationUrl }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>You've been invited to TidyWise</Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <Logo />
        <Heading style={styles.h1}>Join your team on TidyWise</Heading>
        <Text style={styles.text}>
          You've been invited to join an organization on TidyWise. Click below to accept and set up your account.
        </Text>
        <Section style={styles.buttonWrap}>
          <Button href={confirmationUrl} style={styles.button}>Accept invitation</Button>
        </Section>
        <Text style={styles.hint}>
          If you weren't expecting this invitation, you can safely ignore this email.
        </Text>
        <Footer />
      </Container>
    </Body>
  </Html>
)

export default InviteEmail
