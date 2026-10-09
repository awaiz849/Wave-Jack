// Dev-only: timestamps the mic debug panel shows (see MicDebugPanel).

/** performance.now() timestamps for one recording (null = not reached yet). */
export type MicDebugTiming = {
  tapAt: number | null; // Start Listening / orb tapped
  firstChunkAt: number | null; // first MediaRecorder piece sent on the socket
  firstReplyAt: number | null; // first message of any kind from the backend
  finalAt: number | null; // match / no_match / error received
  outcome: string | null;
  round: number | null; // backend round that produced the match
  audioChunks: number | null; // 1-second chunks that round had
};

export const EMPTY_TIMING: MicDebugTiming = {
  tapAt: null,
  firstChunkAt: null,
  firstReplyAt: null,
  finalAt: null,
  outcome: null,
  round: null,
  audioChunks: null,
};
