/**
 * A small PostgREST-shaped reader over the in-memory demo tables.
 * Inserts, updates, and deletes return an error and do not change the tables.
 */

import { getDemoTables, type DemoRow } from './dataset.ts';
import { SILENT_DEMO_TABLES } from './blocklist.ts';

export interface DemoResult {
  data: unknown;
  error: { message: string; code?: string } | null;
  count: number | null;
  status: number;
  statusText: string;
}

type OpFilter = { kind: 'op'; column: string; op: string; value: unknown; negate?: boolean };
type OrFilter = { kind: 'or'; raw: string };

let onBlocked: (silent: boolean) => void = () => {};

export function setDemoBlockedHandler(handler: (silent: boolean) => void) {
  onBlocked = handler;
}

const CHILD_FK: Record<string, string> = {
  booking_team_assignments: 'booking_id',
  invoice_items: 'invoice_id',
};

const PARENT_FK: Record<string, string> = {
  customers: 'customer_id',
  services: 'service_id',
  staff: 'staff_id',
  leads: 'lead_id',
};

function tableRows(name: string): DemoRow[] {
  const tables = getDemoTables() as unknown as Record<string, DemoRow[]>;
  return (tables[name] ?? []).map((row) => ({ ...row }));
}

function coerceAtom(raw: string): unknown {
  if (raw === 'null') return null;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return raw;
}

function ilike(value: unknown, pattern: string): boolean {
  const source = String(value ?? '');
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
  return new RegExp(`^${escaped}$`, 'i').test(source);
}

function matchOp(row: DemoRow, column: string, op: string, value: unknown): boolean {
  const current = row[column];
  switch (op) {
    case 'eq':
      if (value === null) return current == null;
      if (typeof value === 'boolean' || typeof value === 'number') return current === value;
      return current === value || (typeof current === 'number' && Number(value) === current);
    case 'neq':
      return !matchOp(row, column, 'eq', value);
    case 'gt':
      return current != null && value != null && (current as number) > (value as number);
    case 'gte':
      return current != null && value != null && (current as number) >= (value as number);
    case 'lt':
      return current != null && value != null && (current as number) < (value as number);
    case 'lte':
      return current != null && value != null && (current as number) <= (value as number);
    case 'is':
      if (value === null) return current == null;
      return current === value;
    case 'in':
      return Array.isArray(value) && value.some((item) => matchOp(row, column, 'eq', item));
    case 'ilike':
    case 'like':
      return ilike(current, String(value ?? ''));
    default:
      return true;
  }
}

function matchAtom(row: DemoRow, atom: string): boolean {
  const match = atom.match(/^([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)\.(.*)$/);
  if (!match) return false;
  return matchOp(row, match[1], match[2], coerceAtom(match[3]));
}

function splitTop(spec: string): string[] {
  const parts: string[] = [];
  let buf = '';
  let depth = 0;
  for (const char of spec) {
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (char === ',' && depth === 0) {
      if (buf.trim()) parts.push(buf.trim());
      buf = '';
    } else {
      buf += char;
    }
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

function parseEmbed(part: string): { alias: string; table: string; inner: string } | null {
  const open = part.indexOf('(');
  if (open < 0 || !part.endsWith(')')) return null;
  const head = part.slice(0, open).split('!')[0];
  const inner = part.slice(open + 1, -1);
  const [alias, table] = head.split(':');
  if (!alias) return null;
  return { alias, table: table || alias, inner };
}

function stampOrg(value: unknown, orgId: string, depth = 0): unknown {
  if (depth > 4 || value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => stampOrg(item, orgId, depth + 1));
  const row = { ...(value as DemoRow) };
  if ('organization_id' in row && row.organization_id != null) row.organization_id = orgId;
  return row;
}

function project(row: DemoRow, spec: string): DemoRow {
  const parts = splitTop(spec);
  const star = parts.length === 0 || parts.some((part) => part === '*');
  const out: DemoRow = star ? { ...row } : {};
  for (const part of parts) {
    if (part === '*') continue;
    const embed = parseEmbed(part);
    if (!embed) {
      out[part] = part in row ? row[part] : null;
      continue;
    }
    out[embed.alias] = resolveEmbed(row, embed.table, embed.inner);
  }
  return out;
}

function resolveEmbed(parent: DemoRow, table: string, inner: string): unknown {
  const childFk = CHILD_FK[table];
  if (childFk) {
    return tableRows(table)
      .filter((row) => row[childFk] === parent.id)
      .map((row) => project(row, inner));
  }
  const fk = PARENT_FK[table];
  if (!fk || parent[fk] == null) return null;
  const found = tableRows(table).find((row) => row.id === parent[fk]);
  return found ? project(found, inner) : null;
}

class DemoQuery {
  filters: Array<OpFilter | OrFilter> = [];
  orders: { column: string; ascending: boolean }[] = [];
  limitN: number | null = null;
  rangeFrom: number | null = null;
  rangeTo: number | null = null;
  selectSpec = '*';
  head = false;
  wantCount = false;
  mode: 'many' | 'single' | 'maybe' = 'many';
  mutation = false;
  orgStamp: string | null = null;
  table: string;

  constructor(table: string) {
    this.table = table;
  }

  asBlocked() {
    this.mutation = true;
    return this;
  }

  select(columns?: string, options?: { head?: boolean; count?: string }) {
    if (columns) this.selectSpec = columns;
    if (options?.head) this.head = true;
    if (options?.count) this.wantCount = true;
    return this;
  }

  eq(column: string, value: unknown) {
    if (column === 'organization_id' && value != null) this.orgStamp = String(value);
    else this.filters.push({ kind: 'op', column, op: 'eq', value });
    return this;
  }

  neq(column: string, value: unknown) {
    this.filters.push({ kind: 'op', column, op: 'neq', value });
    return this;
  }

  gt(column: string, value: unknown) { return this.op(column, 'gt', value); }
  gte(column: string, value: unknown) { return this.op(column, 'gte', value); }
  lt(column: string, value: unknown) { return this.op(column, 'lt', value); }
  lte(column: string, value: unknown) { return this.op(column, 'lte', value); }
  like(column: string, value: unknown) { return this.op(column, 'like', value); }
  ilike(column: string, value: unknown) { return this.op(column, 'ilike', value); }
  is(column: string, value: unknown) { return this.op(column, 'is', value); }
  in(column: string, value: unknown) { return this.op(column, 'in', value); }
  filter(column: string, op: string, value: unknown) { return this.op(column, op, value); }

  not(column: string, op: string, value: unknown) {
    this.filters.push({ kind: 'op', column, op, value, negate: true });
    return this;
  }

  or(raw: string) {
    this.filters.push({ kind: 'or', raw });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orders.push({ column, ascending: options?.ascending !== false });
    return this;
  }

  limit(count: number) {
    this.limitN = count;
    return this;
  }

  range(from: number, to: number) {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }

  single() { this.mode = 'single'; return this; }
  maybeSingle() { this.mode = 'maybe'; return this; }
  insert() { return this.asBlocked(); }
  update() { return this.asBlocked(); }
  delete() { return this.asBlocked(); }
  upsert() { return this.asBlocked(); }

  op(column: string, opName: string, value: unknown) {
    this.filters.push({ kind: 'op', column, op: opName, value });
    return this;
  }

  then<T>(
    onFulfilled?: (value: DemoResult) => T | PromiseLike<T>,
    onRejected?: (reason: unknown) => T | PromiseLike<T>,
  ) {
    return Promise.resolve(this.execute()).then(onFulfilled, onRejected);
  }

  execute(): DemoResult {
    if (this.mutation) {
      onBlocked(SILENT_DEMO_TABLES.has(this.table));
      return {
        data: null,
        error: { message: 'Disabled in demo mode', code: 'DEMO_BLOCKED' },
        count: 0,
        status: 400,
        statusText: 'Demo',
      };
    }

    let rows = tableRows(this.table).filter((row) => this.filters.every((filter) => {
      if (filter.kind === 'or') {
        return splitTop(filter.raw).some((atom) => matchAtom(row, atom));
      }
      const ok = matchOp(row, filter.column, filter.op, filter.value);
      return filter.negate ? !ok : ok;
    }));

    if (this.orders.length > 0) {
      rows.sort((a, b) => {
        for (const order of this.orders) {
          const av = a[order.column];
          const bv = b[order.column];
          if (av === bv) continue;
          const cmp = av == null ? -1 : bv == null ? 1 : av > bv ? 1 : -1;
          return order.ascending ? cmp : -cmp;
        }
        return 0;
      });
    }

    const count = rows.length;
    if (this.rangeFrom != null) {
      rows = rows.slice(this.rangeFrom, (this.rangeTo ?? rows.length - 1) + 1);
    } else if (this.limitN != null) {
      rows = rows.slice(0, this.limitN);
    }

    let data: unknown = rows.map((row) => project(row, this.selectSpec));
    if (this.orgStamp) data = (data as DemoRow[]).map((row) => stampOrg(row, this.orgStamp as string));

    if (this.head) {
      return { data: null, error: null, count, status: 200, statusText: 'OK' };
    }
    if (this.mode === 'many') {
      return { data, error: null, count: this.wantCount ? count : null, status: 200, statusText: 'OK' };
    }
    const list = data as DemoRow[];
    if (list.length === 1) {
      return { data: list[0], error: null, count: this.wantCount ? 1 : null, status: 200, statusText: 'OK' };
    }
    if (this.mode === 'maybe' && list.length === 0) {
      return { data: null, error: null, count: 0, status: 200, statusText: 'OK' };
    }
    return {
      data: null,
      error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' },
      count: list.length,
      status: 406,
      statusText: 'Not Acceptable',
    };
  }
}

export function demoQuery(table: string) {
  const query = new DemoQuery(table);
  return new Proxy(query, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      if (typeof prop === 'symbol') return undefined;
      return () => receiver;
    },
  });
}

export function blockedDemoQuery(table: string) {
  return demoQuery(table).asBlocked();
}
