# 架构图

## 组件架构

```mermaid
flowchart LR
  subgraph EXT[外部系统]
    Client[上游业务系统]
    Callback[下游回调 API]
  end

  subgraph OC[OpenClaw Runtime]
    Router[Gateway HTTP 路由]
    ReplyEngine[reply.dispatchReplyWithBufferedBlockDispatcher]
    ChannelAPI[OpenClaw Channel Outbound]
  end

  subgraph PLG[openclaw-botbridge 插件]
    Register[index.ts register]
    Config[config.ts 配置解析]
    Webhook[http/webhook.ts]
    Body[http/body.ts 读请求体]
    Auth[http/auth.ts HMAC 校验]
    Validate[types.ts 入站校验]
    Dedupe[state/dedupe.ts 事件去重]
    Queue[state/per-key-queue.ts 按 botid 串行]
    Dispatch[bridge/dispatch.ts 入站分发]
    Sender[bridge/sender.ts 出站重试发送]
    Channel[channel.ts outbound.sendText]
  end

  Client -->|POST webhook + signature| Router
  Router -->|webhookPath| Webhook

  Webhook --> Config
  Webhook --> Body --> Auth --> Validate --> Dedupe
  Dedupe -->|重复 event_id| Client
  Dedupe -->|首次 event_id| Queue --> Dispatch --> ReplyEngine
  Dispatch -->|selectedText| Sender -->|POST outboundApiUrl| Callback

  ChannelAPI -->|sendText(to, text)| Channel --> Sender

  Register --> Config
  Register -->|registerHttpRoute| Router
  Register -->|registerChannel| ChannelAPI
```

## 关键链路说明

- 入站：`Webhook -> 验签 -> 校验 -> 去重 -> 按 botid 串行 -> OpenClaw Reply 分发 -> 出站回调`
- 出站（主动）：`OpenClaw Channel outbound.sendText -> sender 重试发送 -> 下游回调 API`
- 可靠性：`DedupeStore` 防重放，`PerKeySerialQueue` 保证同一 `botid` 顺序执行，`sender` 对超时/网络错误/429/5xx 重试。

