# Project conventions

- Service and estimated booking duration labels use `src/lib/formatDuration.ts` only at presentation boundaries; persisted minutes and scheduling/payroll calculations stay numeric to avoid changing booked time or pay.