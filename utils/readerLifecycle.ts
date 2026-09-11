export type ReaderFlushReason =
  | "background"
  | "external-file"
  | "hardware-back"
  | "reader-exit";

type ActiveReaderSession = {
  sessionId: string;
  fileId: string;
  flush: (reason: ReaderFlushReason) => Promise<void>;
};

let activeReaderSession: ActiveReaderSession | null = null;
const readerWriteQueues = new Map<string, Promise<void>>();

export function registerActiveReaderSession(session: ActiveReaderSession) {
  activeReaderSession = session;

  return () => {
    if (activeReaderSession?.sessionId === session.sessionId) {
      activeReaderSession = null;
    }
  };
}

export async function flushActiveReaderSession(reason: ReaderFlushReason) {
  const session = activeReaderSession;
  if (!session) return;

  try {
    await session.flush(reason);
  } catch (error) {
    console.log(`Reader 위치 저장 실패 (${reason}):`, error);
  }
}

export function hasSupersedingReaderSession(sessionId: string, fileId: string) {
  return Boolean(
    activeReaderSession
    && activeReaderSession.sessionId !== sessionId
    && activeReaderSession.fileId === fileId,
  );
}

export function enqueueReaderWrite(key: string, write: () => Promise<void>) {
  const previous = readerWriteQueues.get(key) ?? Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(write);

  readerWriteQueues.set(key, next);
  const clearCompletedWrite = () => {
    if (readerWriteQueues.get(key) === next) {
      readerWriteQueues.delete(key);
    }
  };
  void next.then(clearCompletedWrite, clearCompletedWrite);

  return next;
}

export async function waitForReaderWrites(key: string) {
  await readerWriteQueues.get(key)?.catch(() => {});
}
