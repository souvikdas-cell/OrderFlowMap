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
