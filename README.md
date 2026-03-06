# OpenClaw BotBridge Channel 插件

`openclaw-botbridge` 是一个面向 OpenClaw 的一对一文本通道插件。

它提供以下能力：
- 入站 Webhook（默认 `POST /openclaw-botbridge/webhook`）
- 接入 OpenClaw 回复分发链路
- 出站 REST 回调到你的应用
- 事件去重与按 `botid` 串行处理

## 架构图

- [项目架构图](./docs/ARCHITECTURE.md)

## 安装

### 方法 A：本地源码安装（推荐）

如果你要在自己的 OpenClaw 环境直接安装并调试此插件，可按以下步骤：

```bash
# 1) 获取源码（如果你已经在源码目录，可跳过）
git clone https://github.com/xinyuan0801/botbridge-channel.git
cd botbridge-channel

# 2) 安装依赖并构建
npm install
npm run build

# 3) 以链接模式安装到 OpenClaw
openclaw plugins install -l .
```

### 方法 B：手动安装（可选）

1. 将本目录复制到 `~/.openclaw/extensions/openclaw-botbridge`。
2. 确保目录内至少包含：`dist/`、`openclaw.plugin.json`、`package.json`。
3. 运行 `openclaw plugins list` 确认插件已被发现。

### 安装后检查

1. 在 `~/.openclaw/openclaw.json` 中将插件加入白名单：

```json
{
  "plugins": {
    "enabled": true,
    "allow": ["openclaw-botbridge"]
  }
}
```

2. 重启 Gateway：

```bash
openclaw gateway restart
```

## 最小配置

在 `plugins.entries.openclaw-botbridge.config` 下至少配置：

```json
{
  "inboundToken": "YOUR_INBOUND_SIGNATURE_SECRET",
  "outboundApiUrl": "https://your-app.example.com/send",
  "outboundToken": "YOUR_OUTBOUND_BEARER_TOKEN"
}
```

## 完整配置示例

```json
{
  "enabled": true,
  "webhookPath": "/openclaw-botbridge/webhook",
  "inboundToken": "YOUR_INBOUND_SIGNATURE_SECRET",
  "inboundSignatureHeader": "x-botbridge-signature",
  "outboundApiUrl": "https://your-app.example.com/send",
  "outboundToken": "YOUR_OUTBOUND_BEARER_TOKEN",
  "requestTimeoutMs": 8000,
  "retryMaxAttempts": 3,
  "retryBaseDelayMs": 500,
  "dedupeTtlMs": 600000,
  "maxBodyBytes": 65536,
  "textMaxChars": 8000
}
```

## 入站 Webhook

入站鉴权仅支持签名模式：
- 使用 `inboundToken` 作为签名密钥
- 对原始请求体计算 `HMAC-SHA256`，并使用 `base64` 编码
- 从请求头 `inboundSignatureHeader`（默认 `x-botbridge-signature`）读取签名

接口：

```text
POST {webhookPath}
{inboundSignatureHeader}: <base64-signature>
Content-Type: application/json
```

请求体：

```json
{
  "event_id": "evt-123",
  "botid": "user-42",
  "text": "hello",
  "timestamp": 1730000000000,
  "metadata": {
    "source": "app"
  }
}
```

响应：
- `202 {"accepted": true, "trace_id": "..."}`
- `200 {"accepted": true, "duplicate": true}`
- `400/401/413/422`

签名请求示例：

```bash
BODY='{"event_id":"evt-123","botid":"user-42","text":"hello"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac 'YOUR_INBOUND_SIGNATURE_SECRET' -binary | base64)

curl -X POST "http://localhost:8080/openclaw-botbridge/webhook" \
  -H "x-botbridge-signature: $SIG" \
  -H "Content-Type: application/json" \
  -d "$BODY"
```

## 出站回调协议

插件会调用：

```text
POST {outboundApiUrl}
Authorization: Bearer <outboundToken>
Idempotency-Key: <delivery_id>
Content-Type: application/json
```

请求体：

```json
{
  "delivery_id": "evt-123",
  "botid": "user-42",
  "text": "robot reply",
  "in_reply_to": "evt-123",
  "timestamp": 1730000001000,
  "channel": "openclaw-botbridge"
}
```

重试策略：
- 成功：`2xx`
- 重试：网络错误、超时、`429`、`5xx`
- 不重试：其他 `4xx`
- 最大重试次数：`retryMaxAttempts`

## 测试

```bash
npm test
```

仅执行“Webhook -> Outbound 回调”全链路闭环测试：

```bash
npm test -- tests/webhook.test.ts -t "full webhook to outbound flow"
```
