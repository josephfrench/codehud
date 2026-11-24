/**
 * Wire protocol between agents (via the MCP bridge), the local HUD server,
 * and browsers. Browsers receive ServerEvents over SSE at GET /api/events.
 */
import type { FileRef, SystemMap } from './index.ts';

export interface FocusRequest {
  /** Node ids to highlight. */
  nodes?: string[];
  /** File paths (relative to map root) to resolve to nodes. */
  files?: string[];
  /** Edge ids to highlight. */
  edges?: string[];
  /** Short note shown in the activity feed, e.g. "editing the checkout route". */
  note?: string;
  /** Zoom the viewport to the highlighted nodes (default true). */
  zoom?: boolean;
  /** Which agent session this came from. */
  session?: string;
}

export interface QuestionOption {
  id: string;
  label: string;
  description?: string;
}

export interface QuestionInput {
  /** The question itself. One or two sentences. */
  question: string;
  /** Why the agent is asking / what it is about to do. Always visible. Markdown, keep short. */
  context: string;
  /** Expanded context shown when the human clicks "show me more". Markdown. */
  moreContext?: string;
  nodes?: string[];
  files?: FileRef[];
  edges?: string[];
  options?: QuestionOption[];
  /** Allow free-text answer in addition to options (default true). */
  allowFreeText?: boolean;
  session?: string;
  agent?: string;
}

export interface Answer {
  text: string;
  optionId?: string;
  answeredAt: string;
}

export type QuestionStatus = 'pending' | 'answered' | 'cancelled' | 'expired';

export interface Question extends QuestionInput {
  id: string;
  createdAt: string;
  status: QuestionStatus;
  /** Node ids after resolving `files`. */
  resolvedNodes: string[];
  answer?: Answer;
}

export interface AgentSession {
  id: string;
  label?: string;
  cwd?: string;
  lastSeen: string;
  status?: 'idle' | 'working' | 'waiting';
}

export interface ActivityItem {
  id: string;
  at: string;
  kind: 'focus' | 'question' | 'answer' | 'note' | 'map' | 'session';
  text: string;
  nodes?: string[];
  session?: string;
}

export type ServerEvent =
  | { type: 'hello'; map: SystemMap | null; questions: Question[]; sessions: AgentSession[]; activity: ActivityItem[] }
  | { type: 'map'; map: SystemMap }
  | { type: 'focus'; focus: FocusRequest & { resolvedNodes: string[] } }
  | { type: 'question'; question: Question }
  | { type: 'answer'; question: Question }
  | { type: 'session'; session: AgentSession }
  | { type: 'activity'; item: ActivityItem };

/** Written by the server to ~/.codehud/server.json so local clients (MCP bridge, CLI) can find it. */
export interface ServerInfo {
  port: number;
  host: string;
  token: string;
  pid: number;
  startedAt: string;
}
