const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const connectStart = html.indexOf('function connectLive(){');
const connectEnd = html.indexOf('\nfunction disconnectLive(){', connectStart);

assert.notEqual(connectStart, -1, 'connectLive must exist');
assert.notEqual(connectEnd, -1, 'disconnectLive must follow connectLive');

const connectSource = html.slice(connectStart, connectEnd);
const aggregateStart = html.indexOf('function normaliseCandleTimeframe(');
const aggregateEnd = html.indexOf('\n/* ==================== COLOR MAPS', aggregateStart);

assert.notEqual(aggregateStart, -1, 'candle aggregation helpers must exist');
assert.notEqual(aggregateEnd, -1, 'color maps must follow aggregateCandles');

const aggregateSource = html.slice(aggregateStart, aggregateEnd);
const aggregateContext = {};
vm.runInNewContext(
  `${aggregateSource}\nglobalThis.aggregateCandles = aggregateCandles; globalThis.aggregateTrades = aggregateTrades;`,
  aggregateContext,
);
const aggregateCandles = (bars, seconds) =>
  JSON.parse(JSON.stringify(aggregateContext.aggregateCandles(bars, seconds)));
const aggregateTrades = (trades, seconds) =>
  JSON.parse(JSON.stringify(aggregateContext.aggregateTrades(trades, seconds)));

function makeHarness({ symbol = 'RELIANCE', exchange = 'NSE', apiKey = 'test-key' } = {}) {
  const elements = {
    wsUrl: { value: 'ws://127.0.0.1:8765' },
    apiKey: { value: apiKey },
    wsSymbol: { value: symbol },
    wsExchange: { value: exchange },
    wsTick: { value: '0.05' },
    tickV: { textContent: '' },
    symLabel: { textContent: '' },
    status: { textContent: '' },
    liveDot: { className: '' },
  };
  const logs = [];
  const sockets = [];

  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.sent = [];
      sockets.push(this);
    }

    send(payload) {
      this.sent.push(JSON.parse(payload));
    }
  }

  const context = {
    WebSocket: FakeWebSocket,
    document: { getElementById: id => elements[id] },
    midSeries: { applyOptions() {} },
    bidSeries: { applyOptions() {} },
    askSeries: { applyOptions() {} },
    vwapSeries: { applyOptions() {} },
    disconnectLive() {},
    clearAllData() {},
    setConnStatus() {},
    connLog(message, level) { logs.push({ message, level }); },
    liveWs: null,
    liveMerged: {},
    TICK: 0.1,
    location: { protocol: 'https:' },
  };

  vm.runInNewContext(`${connectSource}\nglobalThis.connectLive = connectLive;`, context);
  return { connectLive: context.connectLive, elements, logs, sockets };
}

test('opens the Fyers Quote stream before Depth so live trades have volume', () => {
  const harness = makeHarness();

  harness.connectLive();
  const socket = harness.sockets[0];
  socket.onopen();
  socket.onmessage({ data: JSON.stringify({ message: 'Authentication successful' }) });

  assert.deepEqual(
    socket.sent.map(message => message.action),
    ['authenticate', 'subscribe', 'subscribe'],
  );
  assert.equal(socket.sent[1].mode, 2, 'Quote must be subscribed first');
  assert.equal(socket.sent[2].mode, 3, 'Depth must be subscribed second');
  assert.equal(socket.sent[2].depth, 5);
});

test('routes a Nifty futures contract to NFO with a 0.10 tick', () => {
  const harness = makeHarness({ symbol: 'NIFTY29SEP26FUT' });

  harness.connectLive();

  assert.equal(harness.elements.wsExchange.value, 'NFO');
  assert.equal(harness.elements.wsTick.value, '0.10');
  assert.equal(harness.elements.tickV.textContent, '0.10');
});

test('does not open a socket when the OpenAlgo API key is empty', () => {
  const harness = makeHarness({ apiKey: '' });

  harness.connectLive();

  assert.equal(harness.sockets.length, 0);
  assert.deepEqual(harness.logs[0], { message: 'API key required', level: 'err' });
});

test('aggregates per-second OHLC data into one-minute candles', () => {
  const bars = [
    { time: 120, mid: 100, open: 100, high: 102, low: 99, close: 101 },
    { time: 150, mid: 103, open: 101, high: 104, low: 100, close: 103 },
    { time: 180, mid: 98, open: 103, high: 103, low: 97, close: 98 },
  ];

  assert.deepEqual(aggregateCandles(bars, 60), [
    { time: 120, firstTime: 120, open: 100, high: 104, low: 99, close: 103, lastTime: 150 },
    { time: 180, firstTime: 180, open: 103, high: 103, low: 97, close: 98, lastTime: 180 },
  ]);
});

test('keeps a late connection as a partial clock-aligned candle', () => {
  const startOfMinute = 9 * 3600 + 15 * 60;
  const candles = aggregateCandles([
    { time: startOfMinute + 35, mid: 100 },
    { time: startOfMinute + 59, mid: 102 },
    { time: startOfMinute + 60, mid: 101 },
  ], 60);

  assert.deepEqual(candles[0], {
    time: startOfMinute,
    firstTime: startOfMinute + 35,
    open: 100,
    high: 102,
    low: 100,
    close: 102,
    lastTime: startOfMinute + 59,
  });
  assert.equal(candles[1].time, startOfMinute + 60);
});

test('supports five-minute and ten-minute candle boundaries', () => {
  const bars = [
    { time: 0, mid: 100 },
    { time: 299, mid: 105 },
    { time: 300, mid: 102 },
    { time: 599, mid: 108 },
    { time: 600, mid: 110 },
  ];

  assert.equal(aggregateCandles(bars, 300).length, 3);
  assert.equal(aggregateCandles(bars, 600).length, 2);
  assert.deepEqual(aggregateCandles(bars, 600)[0], {
    time: 0, firstTime: 0, open: 100, high: 108, low: 100, close: 108, lastTime: 599,
  });
});

test('ignores invalid rows and falls back to one-minute candles', () => {
  const bars = [
    { time: 60, mid: 100 },
    { time: null, mid: 500 },
    { time: 90, mid: Number.NaN },
    { time: 119, mid: 101 },
  ];

  assert.deepEqual(aggregateCandles(bars, 7), [
    { time: 60, firstTime: 60, open: 100, high: 101, low: 100, close: 101, lastTime: 119 },
  ]);
});

test('combines buy and sell bubbles separately inside each candle', () => {
  const aggregated = aggregateTrades([
    { time: 35, price: 100, qty: 100, side: 'B' },
    { time: 50, price: 102, qty: 200, side: 'B' },
    { time: 55, price: 99, qty: 80, side: 'S' },
    { time: 60, price: 103, qty: 40, side: 'B' },
  ], 60);

  assert.deepEqual(aggregated, [
    { time: 0, firstTime: 35, lastTime: 50, side: 'B', qty: 300, price: 30400 / 300 },
    { time: 0, firstTime: 55, lastTime: 55, side: 'S', qty: 80, price: 99 },
    { time: 60, firstTime: 60, lastTime: 60, side: 'B', qty: 40, price: 103 },
  ]);
});

test('rescales combined bubbles when changing to five and ten minutes', () => {
  const trades = [
    { time: 0, price: 100, qty: 100, side: 'B' },
    { time: 299, price: 102, qty: 200, side: 'B' },
    { time: 300, price: 104, qty: 400, side: 'B' },
    { time: 599, price: 106, qty: 800, side: 'B' },
  ];

  assert.deepEqual(aggregateTrades(trades, 300).map(t => t.qty), [300, 1200]);
  assert.deepEqual(aggregateTrades(trades, 600).map(t => t.qty), [1500]);
});

test('ignores invalid trades during candle aggregation', () => {
  assert.deepEqual(aggregateTrades([
    { time: 0, price: 100, qty: 20, side: 'B' },
    { time: null, price: 100, qty: 20, side: 'B' },
    { time: 10, price: Number.NaN, qty: 20, side: 'B' },
    { time: 20, price: 100, qty: 0, side: 'B' },
    { time: 30, price: 100, qty: 20, side: 'X' },
  ], 60), [
    { time: 0, firstTime: 0, lastTime: 0, side: 'B', qty: 20, price: 100 },
  ]);
});
