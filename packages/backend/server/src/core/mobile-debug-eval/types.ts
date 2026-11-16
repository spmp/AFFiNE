export interface PendingCommand {
  id: string;
  code: string;
  /** Only a client whose id is this, or whose label contains it, runs it. */
  target?: string;
  createdAt: number;
  consumedAt: number | null;
}

/** A page running the eval client (one per tab), as it identifies itself. */
export interface EvalClient {
  id: string;
  /** e.g. "desktop Chrome", "mobile iPhone Safari" */
  label: string;
  lastSeen: number;
}

export interface EvalResult {
  id: string;
  ok: boolean;
  result?: string;
  error?: string;
  receivedAt: number;
}
