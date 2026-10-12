import type { CSSProperties } from 'react';
import { fmt } from '@/lib/activeCurrency';
import { formatInvoiceDateLabel } from '@/lib/invoiceUtils';

interface InvoiceDocumentItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

interface InvoiceDocumentProps {
  businessName: string;
  businessEmail?: string | null;
  businessPhone?: string | null;
  businessAddressLines?: string[];
  /** business_settings.logo_url, already resolved to a fetchable URL. */
  logoUrl?: string | null;
  /** business_settings.primary_color — drives the Pay button. */
  primaryColor?: string | null;
  headerLayout?: 'left' | 'center' | 'right';
  footerMessage?: string | null;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  customerName: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  customerAddressLines?: string[];
  lineItems: InvoiceDocumentItem[];
  subtotal: number;
  total: number;
  notes?: string | null;
  isPaid: boolean;
  paidAt?: string | null;
  paymentMethodLabel?: string;
  amountPaid?: number;
  remainingBalance?: number;
  paymentUrl?: string | null;
}

const COLORS = {
  text: '#111827',
  muted: '#6b7280',
  border: '#e2e8f0',
  paidBg: '#ecfdf5',
  paidText: '#10b981',
  dueBg: '#fffbeb',
  dueText: '#f59e0b',
};

const tableCell: CSSProperties = {
  padding: '20px 12px',
  borderBottom: `1px solid ${COLORS.border}`,
  fontSize: '14px',
  color: COLORS.text,
  verticalAlign: 'top',
};

const formatMoney = (value: number) => `${fmt(Number(value || 0))}`;
const formatDateLabel = (value: string) => formatInvoiceDateLabel(value);

export function InvoiceDocument({
  businessName,
  businessEmail,
  businessPhone,
  businessAddressLines = [],
  logoUrl,
  primaryColor,
  headerLayout = 'left',
  footerMessage,
  invoiceNumber,
  invoiceDate,
  dueDate,
  customerName,
  customerEmail,
  customerPhone,
  customerAddressLines = [],
  lineItems,
  subtotal,
  total,
  notes,
  isPaid,
  paidAt,
  paymentMethodLabel = 'Credit / Debit Card',
  amountPaid,
  remainingBalance,
  paymentUrl,
}: InvoiceDocumentProps) {
  const amountDue = isPaid ? Number(remainingBalance ?? 0) : total;

  return (
    <div
      style={{
        backgroundColor: '#ffffff',
        border: `1px solid ${COLORS.border}`,
        borderRadius: 24,
        padding: 32,
        color: COLORS.text,
        fontFamily: 'IBM Plex Sans, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 24,
        }}
      >
        <div
          style={{
            flex: '1 1 240px',
            minWidth: 220,
            textAlign: headerLayout === 'left' ? 'left' : headerLayout,
          }}
        >
          {logoUrl && (
            <img
              src={logoUrl}
              // Company name, not "Logo" — email clients block remote images
              // by default, so this alt text is what many recipients read.
              alt={businessName}
              style={{
                maxHeight: 48,
                maxWidth: 180,
                objectFit: 'contain',
                marginBottom: 12,
                display: 'block',
                marginLeft: headerLayout === 'center' ? 'auto' : headerLayout === 'right' ? 'auto' : undefined,
                marginRight: headerLayout === 'center' ? 'auto' : undefined,
              }}
            />
          )}
          <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.03em' }}>{businessName}</div>
          <div style={{ marginTop: 12, color: COLORS.muted, fontSize: 14, lineHeight: 1.7 }}>
            {businessEmail && <div>{businessEmail}</div>}
            {businessPhone && <div>{businessPhone}</div>}
            {businessAddressLines.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        </div>

        <div style={{ flex: '0 0 auto', alignSelf: 'center' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 999,
              padding: '8px 18px',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '0.12em',
              color: isPaid ? COLORS.paidText : COLORS.dueText,
              backgroundColor: isPaid ? COLORS.paidBg : COLORS.dueBg,
            }}
          >
            {isPaid ? 'PAID' : 'DUE'}
          </div>
        </div>

        <div style={{ flex: '1 1 220px', minWidth: 220, marginLeft: 'auto' }}>
          <div style={{ display: 'grid', gap: 10 }}>
            {[
              ['Invoice Number', invoiceNumber],
              ['Invoice Date', formatDateLabel(invoiceDate)],
              ['Due Date', formatDateLabel(dueDate)],
              ['Amount Due', formatMoney(amountDue)],
            ].map(([label, value]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                <span style={{ color: COLORS.muted, fontSize: 13 }}>{label}</span>
                <span style={{ fontSize: 14, fontWeight: 600, textAlign: 'right' }}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ height: 1, backgroundColor: COLORS.border, margin: '28px 0' }} />

      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Bill to:</div>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{customerName}</div>
        <div style={{ marginTop: 8, color: COLORS.muted, fontSize: 14, lineHeight: 1.7 }}>
          {customerEmail && <div>{customerEmail}</div>}
          {customerAddressLines.map((line) => (
            <div key={line}>{line}</div>
          ))}
          {customerPhone && <div>{customerPhone}</div>}
        </div>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <thead>
          <tr>
            <th style={{ ...tableCell, paddingTop: 0, textAlign: 'left', color: COLORS.muted, fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', width: '47%' }}>Item</th>
            <th style={{ ...tableCell, paddingTop: 0, textAlign: 'right', color: COLORS.muted, fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', width: '13%' }}>Qty</th>
            <th style={{ ...tableCell, paddingTop: 0, textAlign: 'right', color: COLORS.muted, fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', width: '20%' }}>Price</th>
            <th style={{ ...tableCell, paddingTop: 0, textAlign: 'right', color: COLORS.muted, fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', width: '20%' }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {lineItems.map((item, index) => (
            <tr key={`${item.description}-${index}`}>
              <td style={{ ...tableCell, textAlign: 'left', fontWeight: 500 }}>{item.description}</td>
              <td style={{ ...tableCell, textAlign: 'right' }}>{item.quantity}</td>
              <td style={{ ...tableCell, textAlign: 'right' }}>{formatMoney(item.unitPrice)}</td>
              <td style={{ ...tableCell, textAlign: 'right', fontWeight: 600 }}>{formatMoney(item.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 28 }}>
        <div style={{ width: '100%', maxWidth: 340 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 14, marginBottom: 14 }}>
            <span style={{ color: COLORS.muted }}>Subtotal</span>
            <span>{formatMoney(subtotal)}</span>
          </div>
          <div style={{ height: 1, backgroundColor: COLORS.border, margin: '14px 0' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 18, fontWeight: 700 }}>
            <span>Total</span>
            <span>{formatMoney(total)}</span>
          </div>

          {isPaid && (
            <>
              <div style={{ height: 1, backgroundColor: COLORS.border, margin: '14px 0' }} />
              <div style={{ display: 'grid', gap: 10, fontSize: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                  <span style={{ color: COLORS.muted }}>Payment on {paidAt ? formatDateLabel(paidAt) : formatDateLabel(invoiceDate)}</span>
                  <span>{formatMoney(amountPaid ?? total)}</span>
                </div>
                <div style={{ color: COLORS.muted }}>{paymentMethodLabel}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontWeight: 600 }}>
                  <span style={{ color: COLORS.muted }}>Remaining Balance</span>
                  <span>{formatMoney(remainingBalance ?? 0)}</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {!isPaid && paymentUrl && (
        <div style={{ marginTop: 28 }}>
          <a
            href={paymentUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'block',
              textAlign: 'center',
              textDecoration: 'none',
              backgroundColor: primaryColor || COLORS.text,
              color: '#ffffff',
              borderRadius: 14,
              padding: '16px 20px',
              fontSize: 16,
              fontWeight: 700,
            }}
          >
            Pay {formatMoney(amountDue)}
          </a>
          <div style={{ color: COLORS.muted, fontSize: 13, textAlign: 'center', marginTop: 10 }}>Secure payment powered by Stripe</div>
        </div>
      )}

      {notes && (
        <div style={{ marginTop: 28 }}>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>Notes</div>
          <div style={{ color: COLORS.muted, fontSize: 14, lineHeight: 1.7, whiteSpace: 'pre-line' }}>{notes}</div>
        </div>
      )}

      {footerMessage && (
        <div
          style={{
            marginTop: 28,
            paddingTop: 20,
            borderTop: `1px solid ${COLORS.border}`,
            color: COLORS.muted,
            fontSize: 13,
            textAlign: 'center',
            whiteSpace: 'pre-line',
          }}
        >
          {footerMessage}
        </div>
      )}
    </div>
  );
}