/// <reference types="npm:@types/react@18.3.1" />
import * as React from 'npm:react@18.3.1'
import {
  Body, Container, Head, Heading, Html, Preview, Section, Text,
} from 'https://esm.sh/@react-email/components@0.0.22?deps=react@18.3.1'
import { styles } from './_brand.ts'
import { Logo } from './_logo.tsx'
import { Footer } from './_footer.tsx'

interface Props { siteName?: string; token?: string }

export const ReauthenticationEmail = ({ token }: Props) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Verify it's you — TidyWise</Preview>
    <Body style={styles.main}>
      <Container style={styles.container}>
        <Logo />
        <Heading style={styles.h1}>Verify your identity</Heading>
        <Text style={styles.text}>
          Enter this code to confirm your identity for the action you requested.
        </Text>
        <Section style={styles.codeBox}>
          <Text style={styles.code}>{token}</Text>
        </Section>
        <Text style={styles.hint}>This code expires in 10 minutes.</Text>
        <Footer />
      </Container>
    </Body>
  </Html>
)

export default ReauthenticationEmail
