/**
 * Intercepts the single Supabase client while sample demo is on.
 * Business reads come from memory. Writes, messages, and payments stop here.
 */

import { toast } from 'sonner';
import {
  SILENT_DEMO_TABLES,
  demoInvokeKind,
  demoRpcKind,
  isSilentDemoRpc,
} from './blocklist.ts';
import { demoFunctionData } from './responses.ts';
import { blockedDemoQuery, demoQuery, setDemoBlockedHandler } from './query.ts';
import { isPublicDemoActive, isSampleDemoOn } from './session.ts';

const PASSTHROUGH = new Set([
  'organizations',
  'org_memberships',
  'profiles',
  'business_settings',
  'organization_pricing_settings',
]);

setDemoBlockedHandler((silent) => {
  if (silent) return;
  toast('Disabled in demo mode', { id: 'demo-blocked' });
});

function resolved(result: { data: unknown; error: { message: string } | null }) {
  const payload = { ...result, count: null, status: result.error ? 400 : 200, statusText: result.error ? 'Demo' : 'OK' };
  const thenable = {
    __demo: true,
    then(onFulfilled?: (value: typeof payload) => unknown, onRejected?: (reason: unknown) => unknown) {
      return Promise.resolve(payload).then(onFulfilled, onRejected);
    },
    overrideTypes() { return thenable; },
    single() { return thenable; },
    maybeSingle() { return thenable; },
  };
  return thenable;
}

function guardWrites(table: string, builder: object): unknown {
  return new Proxy(builder, {
    get(target, prop, receiver) {
      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      }
      if (prop === 'insert' || prop === 'update' || prop === 'delete' || prop === 'upsert') {
        return () => blockedDemoQuery(table);
      }
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        const result = (value as (...a: unknown[]) => unknown).apply(target, args);
        if (result && typeof result === 'object') return guardWrites(table, result as object);
        return result;
      };
    },
  });
}

function noopChannel() {
  const channel = {
    __demo: true,
    on() { return channel; },
    subscribe(callback?: (status: string) => void) {
      callback?.('SUBSCRIBED');
      return channel;
    },
    unsubscribe() { return Promise.resolve('ok'); },
    send() { return Promise.resolve('ok'); },
  };
  return channel;
}

interface GateClient {
  from: (table: string) => unknown;
  rpc: (fn: string, args?: unknown, options?: unknown) => unknown;
  channel: (name: string, opts?: unknown) => unknown;
  removeChannel: (channel: unknown) => unknown;
  functions: { invoke: (name: string, options?: unknown) => Promise<{ data: unknown; error: { message: string } | null }> };
  storage: { from: (bucket: string) => unknown };
}

let installed = false;

export function installDemoGate(client: GateClient) {
  if (installed) return;
  installed = true;

  const realFrom = client.from.bind(client);
  const realRpc = client.rpc.bind(client);
  const realChannel = client.channel.bind(client);
  const realRemove = client.removeChannel.bind(client);
  const realStorageFrom = client.storage.from.bind(client.storage);
  const functionsDescriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(client), 'functions');
  const readFunctions = () => {
    if (functionsDescriptor?.get) return functionsDescriptor.get.call(client) as GateClient['functions'];
    return client.functions;
  };

  client.from = (table: string) => {
    if (!isSampleDemoOn()) return realFrom(table);
    if (!isPublicDemoActive() && PASSTHROUGH.has(table)) {
      return guardWrites(table, realFrom(table) as object);
    }
    if (SILENT_DEMO_TABLES.has(table)) return demoQuery(table);
    return demoQuery(table);
  };

  client.rpc = ((fn: string, args?: unknown, options?: unknown) => {
    if (!isSampleDemoOn()) return realRpc(fn, args, options);
    const kind = demoRpcKind(fn);
    if (kind === 'silent' || isSilentDemoRpc(fn)) {
      return resolved({ data: null, error: { message: 'Disabled in demo mode' } });
    }
    if (kind === 'block') {
      toast('Disabled in demo mode', { id: 'demo-blocked' });
      return resolved({ data: null, error: { message: 'Disabled in demo mode' } });
    }
    if (isPublicDemoActive()) return resolved({ data: null, error: null });
    return realRpc(fn, args, options);
  }) as GateClient['rpc'];

  client.channel = ((name: string, opts?: unknown) => {
    if (!isSampleDemoOn()) return realChannel(name, opts);
    return noopChannel();
  }) as GateClient['channel'];

  client.removeChannel = ((channel: unknown) => {
    if (channel && typeof channel === 'object' && (channel as { __demo?: boolean }).__demo) {
      return Promise.resolve('ok');
    }
    return realRemove(channel);
  }) as GateClient['removeChannel'];

  const gatedInvoke = (async (name: string, options?: unknown) => {
    const live = readFunctions();
    if (!isSampleDemoOn()) return live.invoke(name, options);
    const kind = demoInvokeKind(name);
    if (kind === 'canned') return { data: demoFunctionData(name), error: null };
    if (kind === 'silent') return { data: null, error: { message: 'Disabled in demo mode' } };
    if (kind === 'block') {
      toast('Disabled in demo mode', { id: 'demo-blocked' });
      return { data: null, error: { message: 'Disabled in demo mode' } };
    }
    if (isPublicDemoActive()) return { data: null, error: null };
    return live.invoke(name, options);
  }) as GateClient['functions']['invoke'];

  // supabase-js 2.88 `functions` is a getter that returns a new client each
  // time. Assigning `.invoke` on one instance never runs. Wrap every get.
  Object.defineProperty(client, 'functions', {
    configurable: true,
    enumerable: true,
    get() {
      const live = readFunctions();
      return new Proxy(live, {
        get(target, prop, receiver) {
          if (prop === 'invoke') return gatedInvoke;
          const value = Reflect.get(target, prop, receiver);
          return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
        },
      });
    },
  });

  client.storage.from = (bucket: string) => {
    const api = realStorageFrom(bucket);
    if (!isSampleDemoOn()) return api;
    return new Proxy(api as object, {
      get(target, prop, receiver) {
        if (prop === 'upload' || prop === 'update' || prop === 'remove' || prop === 'move' || prop === 'copy') {
          return async () => {
            toast('Disabled in demo mode', { id: 'demo-blocked' });
            return { data: null, error: { message: 'Disabled in demo mode' } };
          };
        }
        if (prop === 'download' || prop === 'createSignedUrl' || prop === 'list') {
          return async () => ({ data: null, error: { message: 'Disabled in demo mode' } });
        }
        if (prop === 'getPublicUrl') {
          return () => ({ data: { publicUrl: '' } });
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
  };
}
