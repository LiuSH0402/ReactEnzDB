import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function positiveNumber(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const queueRoot = path.resolve(process.env.ENZY_MODEL_QUEUE_DIR ?? path.join(os.tmpdir(), "enzy-model-queue"));
const ticketsDir = path.join(queueRoot, "tickets");
const activeLockDir = path.join(queueRoot, "active.lock");
const ownerPath = path.join(activeLockDir, "owner.json");
const pollMs = positiveNumber("ENZY_MODEL_QUEUE_POLL_MS", 1_000);
const ticketStaleMs = positiveNumber("ENZY_MODEL_TICKET_STALE_MS", 300_000);
const lockStaleMs = positiveNumber("ENZY_MODEL_LOCK_STALE_MS", 600_000);
const heartbeatMs = Math.min(positiveNumber("ENZY_MODEL_HEARTBEAT_MS", 15_000), lockStaleMs / 3);

type QueueOwner = {
  token: string;
  label: string;
  pid: number;
  acquired_at: number;
  heartbeat_at: number;
};

export type ModelQueueSlot = {
  token: string;
  release: () => Promise<void>;
};

export class ModelQueueAbortedError extends Error {
  constructor() {
    super("The queued request was cancelled.");
    this.name = "ModelQueueAbortedError";
  }
}

function isErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

async function writeJsonAtomic(filePath: string, payload: object): Promise<void> {
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  await fs.writeFile(temporary, JSON.stringify(payload), "utf8");
  await fs.rename(temporary, filePath);
}

async function readOwner(): Promise<QueueOwner | null> {
  try {
    return JSON.parse(await fs.readFile(ownerPath, "utf8")) as QueueOwner;
  } catch {
    return null;
  }
}

async function removeStaleTickets(ownTicket: string): Promise<void> {
  let names: string[];
  try {
    names = (await fs.readdir(ticketsDir)).filter((name) => name.endsWith(".json"));
  } catch {
    return;
  }
  const cutoff = Date.now() - ticketStaleMs;
  await Promise.all(names.map(async (name) => {
    const ticket = path.join(ticketsDir, name);
    if (ticket === ownTicket) return;
    try {
      if ((await fs.stat(ticket)).mtimeMs < cutoff) await fs.unlink(ticket);
    } catch {
      // Another waiter may have removed or refreshed the ticket.
    }
  }));
}

async function lockModifiedAt(): Promise<number | null> {
  for (const candidate of [ownerPath, activeLockDir]) {
    try {
      return (await fs.stat(candidate)).mtimeMs;
    } catch {
      // Try the lock directory when owner.json is not ready yet.
    }
  }
  return null;
}

async function reclaimStaleLock(): Promise<boolean> {
  const modifiedAt = await lockModifiedAt();
  if (modifiedAt === null || Date.now() - modifiedAt <= lockStaleMs) return false;
  const stalePath = path.join(queueRoot, `active.lock.stale.${randomUUID()}`);
  try {
    await fs.rename(activeLockDir, stalePath);
  } catch {
    return false;
  }
  await fs.rm(stalePath, { recursive: true, force: true });
  return true;
}

async function tryAcquire(token: string, label: string): Promise<boolean> {
  try {
    await fs.mkdir(activeLockDir);
  } catch (error) {
    if (isErrorCode(error, "EEXIST")) {
      await reclaimStaleLock();
      return false;
    }
    throw error;
  }

  try {
    const now = Date.now() / 1_000;
    await writeJsonAtomic(ownerPath, {
      token,
      label,
      pid: process.pid,
      acquired_at: now,
      heartbeat_at: now,
    } satisfies QueueOwner);
  } catch (error) {
    await fs.rm(activeLockDir, { recursive: true, force: true });
    throw error;
  }
  return true;
}

function waitForPoll(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new ModelQueueAbortedError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, pollMs);
    const abort = () => {
      clearTimeout(timer);
      reject(new ModelQueueAbortedError());
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

async function releaseOwnedLock(token: string): Promise<void> {
  const owner = await readOwner();
  if (!owner || owner.token !== token) return;
  const releasePath = path.join(queueRoot, `active.lock.release.${token}`);
  try {
    await fs.rename(activeLockDir, releasePath);
  } catch {
    return;
  }
  await fs.rm(releasePath, { recursive: true, force: true });
}

export async function acquireModelQueueSlot(label: string, signal?: AbortSignal): Promise<ModelQueueSlot> {
  await fs.mkdir(ticketsDir, { recursive: true });
  const token = randomUUID().replaceAll("-", "");
  const timestamp = `${Date.now()}000000`.padStart(20, "0");
  const ticket = path.join(ticketsDir, `${timestamp}-${token}.json`);
  await fs.writeFile(ticket, JSON.stringify({ token, label, pid: process.pid, created_at: Date.now() / 1_000 }), { encoding: "utf8", flag: "wx" });

  let acquired = false;
  try {
    while (!acquired) {
      if (signal?.aborted) throw new ModelQueueAbortedError();
      const now = new Date();
      await fs.utimes(ticket, now, now);
      await removeStaleTickets(ticket);
      const tickets = (await fs.readdir(ticketsDir)).filter((name) => name.endsWith(".json")).sort();
      if (!tickets.includes(path.basename(ticket))) throw new ModelQueueAbortedError();
      if (tickets[0] === path.basename(ticket)) acquired = await tryAcquire(token, label);
      if (!acquired) await waitForPoll(signal);
    }
    await fs.unlink(ticket).catch(() => undefined);

    let heartbeatChain = Promise.resolve();
    const heartbeat = setInterval(() => {
      heartbeatChain = heartbeatChain.then(async () => {
        const owner = await readOwner();
        if (!owner || owner.token !== token) return;
        owner.heartbeat_at = Date.now() / 1_000;
        await writeJsonAtomic(ownerPath, owner);
      }).catch(() => undefined);
    }, heartbeatMs);
    heartbeat.unref();

    let released = false;
    return {
      token,
      release: async () => {
        if (released) return;
        released = true;
        clearInterval(heartbeat);
        await heartbeatChain;
        await releaseOwnedLock(token);
      },
    };
  } catch (error) {
    await fs.unlink(ticket).catch(() => undefined);
    if (acquired) await releaseOwnedLock(token);
    throw error;
  }
}
