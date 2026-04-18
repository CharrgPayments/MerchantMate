// In-process pub/sub used by the SSE notification stream
// (GET /api/alerts/stream). createAlert() in alertService.ts publishes
// here on every successful insert, and the SSE handler subscribes per
// connected user. Single-process only — that's fine for our deployment
// shape (one Node process per Repl), but if we ever go multi-instance
// this needs to be replaced with a shared transport (Redis pub/sub,
// Postgres LISTEN/NOTIFY, etc.).

import { EventEmitter } from "node:events";
import type { UserAlert } from "@shared/schema";

class AlertBus {
  private emitter = new EventEmitter();

  constructor() {
    // SSE typically holds many concurrent listeners; lift the default cap
    // so we don't get noisy MaxListeners warnings under normal load.
    this.emitter.setMaxListeners(0);
  }

  emit(userId: string, alert: UserAlert) {
    this.emitter.emit(`alert:${userId}`, alert);
  }

  subscribe(userId: string, handler: (alert: UserAlert) => void): () => void {
    const channel = `alert:${userId}`;
    this.emitter.on(channel, handler);
    return () => this.emitter.off(channel, handler);
  }
}

export const alertBus = new AlertBus();
