export type RunStatus = 'ok' | 'retry' | 'fail';

export type DigestRow = {
  job: string;
  // Owner on the chronologically latest event, including an explicit null.
  owner: string | null;
  // All valid events for this job; retries count only retry events.
  runs: number;
  retries: number;
  lastStatus: RunStatus;
  // Most recent supplied error, retained after recovery; null if none was logged.
  lastError: string | null;
  // Original timestamp strings, preserving their logged timezone offsets.
  firstAt: string;
  lastAt: string;
  // True if any event failed, even when the latest event recovered.
  hasFailure: boolean;
};

export type NightDigest = {
  night: string;
  // Ascending job-name order (code point order), shared by HTML and JSON.
  rows: DigestRow[];
  badLines: number;
  // Event counts, not job counts.
  counts: Record<RunStatus, number>;
};

// Synchronous reader, implemented in reader.ts. Missing/invalid nights return
// null; existing empty files return a digest with zero rows/counts. Other I/O
// errors propagate. Events aggregate by timestamp instant, with file order
// breaking ties. Blank lines are ignored; malformed JSON or shape is counted.
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;
