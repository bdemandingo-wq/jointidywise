import * as React from 'npm:react@18.3.1'
import { Section, Text } from 'https://esm.sh/@react-email/components@0.0.22?deps=react@18.3.1'
import { styles } from './_brand.ts'

export const Logo = () => (
  <Section style={styles.logoWrap}>
    <Text style={styles.logoText}>TidyWise</Text>
  </Section>
)
