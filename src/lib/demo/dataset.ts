/**
 * In-memory Harbor & Pine Cleaning. Dates are relative to "now" so the
 * dashboard week stays current. Nothing here is written to the database.
 */

import { DEMO_ORG_ID } from './session.ts';

export type DemoRow = Record<string, unknown>;

const HOUR_UTC = 16;

function atDay(now: number, dayOffset: number, hourUtc = HOUR_UTC): string {
  const date = new Date(now);
  date.setUTCDate(date.getUTCDate() + dayOffset);
  date.setUTCHours(hourUtc, 0, 0, 0);
  return date.toISOString();
}

function demoId(kind: number, n: number): string {
  return `d000000${kind}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

const FIRST = [
  'Elena', 'Marcus', 'Priya', 'Jonah', 'Alicia', 'Devon', 'Naomi', 'Chris',
  'Helena', 'Omar', 'Grace', 'Felix', 'Ruth', 'Andre', 'Lila', 'Seth',
  'Carmen', 'Noah', 'Ivy', 'Patrick', 'June', 'Malik', 'Rosa', 'Evan', 'Tessa',
];
const LAST = [
  'Vargas', 'Nguyen', 'Patel', 'Brooks', 'Okoye', 'Keller', 'Shah', 'Almeida',
  'Berg', 'Diallo', 'Morales', 'Cho', 'Andersen', 'Wright', 'Santos', 'Walsh',
  'Ibarra', 'Bennett', 'Larson', 'Hughes', 'Park', 'Coleman', 'Reyes', 'Foster', 'Klein',
];
const STREETS = [
  'Maple', 'Cedar', 'Pine', 'Oak', 'Willow', 'Birch', 'Harbor', 'Lantern', 'Ridge', 'Elm',
];
const SERVICES = [
  { name: 'Standard Clean', price: 165, duration: 120 },
  { name: 'Deep Clean', price: 285, duration: 180 },
  { name: 'Move-out Clean', price: 420, duration: 240 },
  { name: 'Recurring Weekly', price: 145, duration: 120 },
];
const STAFF = [
  { name: 'Maya Chen', color: '#0f766e' },
  { name: 'Andre Brooks', color: '#1d4ed8' },
  { name: 'Priya Shah', color: '#b45309' },
  { name: 'Luis Ortega', color: '#7c3aed' },
  { name: 'Hannah Cole', color: '#be123c' },
];

export interface DemoTables {
  customers: DemoRow[];
  staff: DemoRow[];
  services: DemoRow[];
  bookings: DemoRow[];
  booking_team_assignments: DemoRow[];
  invoices: DemoRow[];
  invoice_items: DemoRow[];
  leads: DemoRow[];
  estimates: DemoRow[];
}

export function buildDemoTables(now = Date.now()): DemoTables {
  const services = SERVICES.map((service, index) => ({
    id: demoId(7, index + 1),
    organization_id: DEMO_ORG_ID,
    name: service.name,
    description: `${service.name} for a typical home`,
    price: service.price,
    duration: service.duration,
    is_active: true,
    created_at: atDay(now, -120),
    updated_at: atDay(now, -2),
  }));

  const staff = STAFF.map((member, index) => ({
    id: demoId(2, index + 1),
    organization_id: DEMO_ORG_ID,
    name: member.name,
    email: `${member.name.toLowerCase().replace(' ', '.')}@harborpine.example`,
    phone: `(512) 555-01${index + 1}0`,
    is_active: true,
    hourly_rate: 22 + index,
    calendar_color: member.color,
    created_at: atDay(now, -200),
    updated_at: atDay(now, -3),
  }));

  const customers = FIRST.map((first, index) => {
    const last = LAST[index];
    const street = STREETS[index % STREETS.length];
    return {
      id: demoId(1, index + 1),
      organization_id: DEMO_ORG_ID,
      first_name: first,
      last_name: last,
      email: `${first}.${last}@example.com`.toLowerCase(),
      phone: `(512) 555-${String(2000 + index).slice(1)}`,
      address: `${120 + index * 8} ${street} St`,
      city: 'Austin',
      state: 'TX',
      zip_code: '78704',
      customer_status: 'active',
      notes: index % 5 === 0 ? 'Gate code is on the demo card.' : null,
      is_recurring: index % 4 === 0,
      marketing_status: 'subscribed',
      credits: 0,
      merged_into: null,
      created_at: atDay(now, index === 0 ? 0 : -(index * 6)),
      updated_at: atDay(now, -1),
    };
  });

  const bookings: DemoRow[] = [];
  const assignments: DemoRow[] = [];
  let bookingNumber = 1800;

  const pushBooking = (
    dayOffset: number,
    status: string,
    payment: string,
    customerIndex: number,
  ) => {
    const n = bookings.length + 1;
    const service = services[n % services.length];
    const cleaner = staff[n % staff.length];
    const customer = customers[customerIndex % customers.length];
    const id = demoId(3, n);
    bookings.push({
      id,
      organization_id: DEMO_ORG_ID,
      booking_number: bookingNumber++,
      customer_id: customer.id,
      service_id: service.id,
      staff_id: cleaner.id,
      scheduled_at: atDay(now, dayOffset, 15 + (n % 4)),
      duration: service.duration,
      total_amount: service.price + (n % 3) * 15,
      deposit_paid: payment === 'paid' ? service.price : 0,
      status,
      payment_status: payment,
      payment_intent_id: null,
      notes: null,
      address: customer.address,
      city: customer.city,
      state: customer.state,
      zip_code: customer.zip_code,
      frequency: customer.is_recurring ? 'weekly' : 'one_time',
      bedrooms: '3',
      bathrooms: '2',
      is_draft: false,
      created_at: atDay(now, dayOffset - 3),
      updated_at: atDay(now, dayOffset),
    });
    assignments.push({
      id: demoId(9, n),
      booking_id: id,
      staff_id: cleaner.id,
      pay_share: 100,
      is_primary: true,
      organization_id: DEMO_ORG_ID,
    });
  };

  for (let day = -7; day <= -1; day++) {
    pushBooking(day, 'completed', 'paid', Math.abs(day));
    pushBooking(day, 'completed', day === -2 ? 'partial' : 'paid', Math.abs(day) + 3);
  }
  pushBooking(0, 'completed', 'paid', 0);
  pushBooking(0, 'confirmed', 'pending', 4);
  for (let day = 1; day <= 7; day++) {
    pushBooking(day, day === 1 ? 'pending' : 'confirmed', 'pending', day + 5);
    pushBooking(day, 'confirmed', 'pending', day + 9);
  }
  pushBooking(-3, 'cancelled', 'pending', 8);
  for (let week = 2; week <= 16; week++) {
    pushBooking(-week * 7, 'completed', 'paid', week);
  }

  const invoices: DemoRow[] = [];
  const items: DemoRow[] = [];
  const invoicePlan: { status: string; day: number; paid: boolean }[] = [
    { status: 'paid', day: -20, paid: true },
    { status: 'paid', day: -12, paid: true },
    { status: 'paid', day: -6, paid: true },
    { status: 'sent', day: 8, paid: false },
    { status: 'sent', day: 14, paid: false },
    { status: 'sent', day: 21, paid: false },
    { status: 'overdue', day: -18, paid: false },
    { status: 'overdue', day: -9, paid: false },
    { status: 'overdue', day: -4, paid: false },
    { status: 'draft', day: 3, paid: false },
  ];
  invoicePlan.forEach((plan, index) => {
    const customer = customers[index % customers.length];
    const service = services[index % services.length];
    const id = demoId(4, index + 1);
    const total = Number(service.price) + 25;
    invoices.push({
      id,
      organization_id: DEMO_ORG_ID,
      customer_id: customer.id,
      lead_id: null,
      invoice_number: 1042 + index,
      status: plan.status,
      subtotal: total,
      tax_amount: 0,
      total_amount: total,
      due_date: atDay(now, plan.day).slice(0, 10),
      paid_at: plan.paid ? atDay(now, plan.day) : null,
      sent_at: plan.status === 'draft' ? null : atDay(now, plan.day - 1),
      notes: plan.status === 'overdue' ? 'Second reminder is staged in demo only.' : null,
      created_at: atDay(now, plan.day - 2),
      updated_at: atDay(now, Math.min(plan.day, 0)),
    });
    items.push({
      id: demoId(8, index + 1),
      invoice_id: id,
      service_id: service.id,
      description: service.name,
      quantity: 1,
      unit_price: total,
      amount: total,
      organization_id: DEMO_ORG_ID,
    });
  });

  const leadStatuses = ['new', 'new', 'follow_up', 'quoted', 'commercial', 'converted', 'lost', 'follow_up'];
  const leads = leadStatuses.map((status, index) => ({
    id: demoId(5, index + 1),
    organization_id: DEMO_ORG_ID,
    name: `${FIRST[(index + 7) % FIRST.length]} ${LAST[(index + 4) % LAST.length]}`,
    email: `lead${index + 1}@example.com`,
    phone: `(512) 555-03${index}0`,
    address: `${400 + index} South Congress Ave`,
    city: 'Austin',
    state: 'TX',
    zip_code: '78704',
    status,
    source: index % 2 === 0 ? 'website' : 'referral',
    service_interest: services[index % services.length].name,
    estimated_value: 180 + index * 40,
    message: 'Asked for a walkthrough of a two-story home.',
    created_at: atDay(now, -index * 2),
    updated_at: atDay(now, -index),
  }));

  const estimateStatuses = ['draft', 'draft', 'quote_sent', 'quote_sent', 'converted', 'declined'];
  const estimates = estimateStatuses.map((status, index) => ({
    id: demoId(6, index + 1),
    organization_id: DEMO_ORG_ID,
    customer_id: customers[index].id,
    client_name: `${customers[index].first_name} ${customers[index].last_name}`,
    client_email: customers[index].email,
    client_phone: customers[index].phone,
    client_address: customers[index].address,
    client_city: 'Austin',
    client_state: 'TX',
    client_zip: '78704',
    estimated_total: 190 + index * 55,
    status,
    notes: 'Sample estimate. Nothing is sent.',
    created_at: atDay(now, -10 - index),
    updated_at: atDay(now, -index),
  }));

  return {
    customers,
    staff,
    services,
    bookings,
    booking_team_assignments: assignments,
    invoices,
    invoice_items: items,
    leads,
    estimates,
  };
}

let cache: DemoTables | null = null;

export function getDemoTables(): DemoTables {
  if (!cache) cache = buildDemoTables(Date.now());
  return cache;
}

export function resetDemoTables(now = Date.now()): DemoTables {
  cache = buildDemoTables(now);
  return cache;
}

export function demoTableNames(): (keyof DemoTables)[] {
  return [
    'customers', 'staff', 'services', 'bookings', 'booking_team_assignments',
    'invoices', 'invoice_items', 'leads', 'estimates',
  ];
}
