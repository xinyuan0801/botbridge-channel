import type { IncomingMessage, ServerResponse } from "node:http";

export type PluginLogger = {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

export type ReplyPayload = {
  text?: string;
  isReasoning?: boolean;
};

export type ReplyDispatchKind = "tool" | "block" | "final";

export type DispatchReplyWithBufferedBlockDispatcher = (params: {
  ctx: Record<string, unknown>;
  cfg: unknown;
  dispatcherOptions: {
    deliver: (payload: ReplyPayload, info: { kind: ReplyDispatchKind }) => Promise<void> | void;
    onError?: (error: unknown, info: { kind: ReplyDispatchKind }) => void;
  };
  replyOptions?: Record<string, unknown>;
}) => Promise<unknown>;

export type PluginRuntime = {
  channel?: {
    reply?: {
      dispatchReplyWithBufferedBlockDispatcher?: DispatchReplyWithBufferedBlockDispatcher;
    };
  };
};

export type OpenClawPluginApi = {
  id: string;
  config: unknown;
  pluginConfig?: Record<string, unknown>;
  runtime: PluginRuntime;
  logger: PluginLogger;
  registerChannel: (registration: unknown) => void;
  registerHttpRoute: (params: {
    path: string;
    auth: "gateway" | "plugin";
    handler: (
      req: IncomingMessage,
      res: ServerResponse,
    ) => Promise<boolean | void> | boolean | void;
    match?: "exact" | "prefix";
    replaceExisting?: boolean;
  }) => void;
};

export type OutboundSendResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      error: string;
    };
