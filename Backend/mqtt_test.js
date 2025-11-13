/**
 * mqtt-to-ws.js
 *
 * Usage:
 * 1. Install deps:
 *    npm init -y
 *    npm install mqtt ws
 *
 * 2. Run:
 *    node mqtt-to-ws.js
 *
 * Defaults:
 * - MQTT broker: mqtt://localhost:1883
 * - Topic: x/y
 * - WebSocket port: 8889
 */

const mqtt = require('mqtt');
const WebSocket = require('ws');

/* ---------- Configuration ---------- */
const MQTT_URL = process.env.MQTT_URL || 'mqtt://localhost:1883';
const MQTT_TOPIC = process.env.MQTT_TOPIC || 'x';
const WS_PORT = parseInt(process.env.WS_PORT || '8889', 10); // changed to 8889

// How to interpret raw bytes: "big" or "little"
const BYTE_ORDER = process.env.BYTE_ORDER || 'big';
const SIGNED = (process.env.SIGNED || 'false') === 'true';
/* ----------------------------------- */

/* ---------- Helpers ---------- */
function tryParseAsciiBitString(buf) {
  const s = buf.toString('utf8').trim();
  if (!/^[01]+$/.test(s)) return null;
  return BigInt('0b' + s);
}

function bufferToBigInt(buf, order = 'big', signed = false) {
  if (buf.length === 0) return 0n;
  let bytes = Array.from(buf);
  if (order === 'little') bytes = bytes.reverse();

  let result = 0n;
  for (const b of bytes) result = (result << 8n) + BigInt(b);

  if (signed) {
    const highestByte = bytes[0];
    const bitlen = BigInt(bytes.length * 8);
    const signBitSet = (highestByte & (1 << 7)) !== 0;
    if (signBitSet) result = result - (1n << bitlen);
  }

  return result;
}

function safeCoerceBigInt(bi) {
  const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
  const minSafe = BigInt(Number.MIN_SAFE_INTEGER);
  if (bi <= maxSafe && bi >= minSafe) return Number(bi);
  return bi.toString();
}

/* ---------- MQTT client ---------- */
const client = mqtt.connect(MQTT_URL);

client.on('connect', () => {
  console.log(`Connected to MQTT broker ${MQTT_URL}`);
  client.subscribe(MQTT_TOPIC, (err) => {
    if (err) console.error('Subscribe error:', err);
    else console.log(`Subscribed to topic "${MQTT_TOPIC}"`);
  });
});

client.on('error', (err) => console.error('MQTT error:', err));

/* ---------- WebSocket server ---------- */
const wss = new WebSocket.Server({ port: WS_PORT }, () => {
  console.log(`WebSocket server listening on ws://localhost:${WS_PORT}`);
});

wss.on('connection', (ws, req) => {
  console.log('WS client connected:', req.socket.remoteAddress);
  ws.send(JSON.stringify({ welcome: true, topic: MQTT_TOPIC }));
});

/* ---------- Message handling ---------- */
client.on('message', (topic, payloadBuffer) => {
  try {
    let bi = tryParseAsciiBitString(payloadBuffer);
    if (bi === null) bi = bufferToBigInt(payloadBuffer, BYTE_ORDER, SIGNED);

    const coerced = safeCoerceBigInt(bi);

    // 👇 New console.log for the topic value
    if (topic === MQTT_TOPIC) {
      console.log(`Value from ${topic}:`, coerced);
    }

    const json = {
      topic,
      value: coerced,
      raw_hex: payloadBuffer.toString('hex'),
      raw_base64: payloadBuffer.toString('base64'),
      bytes: payloadBuffer.length,
      ts: new Date().toISOString(),
    };

    const str = JSON.stringify(json);

    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(str);
    });

    console.log('-> broadcast', str);
  } catch (e) {
    console.error('Failed to parse message:', e);
  }
});

/* ---------- Graceful shutdown ---------- */
function shutdown() {
  console.log('Shutting down...');
  client.end(true, () => {
    wss.close(() => process.exit(0));
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
