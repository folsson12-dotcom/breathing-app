import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, 'index.html contains an inline application script');

class MockClassList {
  constructor(element) { this.element = element; }
  toggle(name, force) {
    const values = new Set(this.element.className.split(/\s+/).filter(Boolean));
    const enabled = force === undefined ? !values.has(name) : force;
    if (enabled) values.add(name); else values.delete(name);
    this.element.className = [...values].join(' ');
  }
}

class MockElement {
  constructor(id, value = '') {
    Object.assign(this, { id, value, checked:false, disabled:false, textContent:'', className:'', title:'', onclick:null });
    this.attributes = new Map();
    this.listeners = new Map();
    this.style = { values:new Map(), setProperty:(name, nextValue) => this.style.values.set(name, nextValue) };
    this.classList = new MockClassList(this);
  }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  dispatch(type) { this.listeners.get(type)?.({ target:this }); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  click() { this.onclick?.(); }
}

const defaults = { minutes:'3', inhale:'4', pause:'2', exhale:'4', rounds:'3', breaths:'30', win:'2', wout:'2', recovery:'15' };
const ids = ['gentleTab','wimTab','gentleSettings','wimSettings','orb','phase','secs','detail','status','clock','start','reset','minutes','inhale','pause','exhale','rounds','breaths','win','wout','recovery','sound','voice','voiceField','ambient','ambientVolume','ambientLevel','hint'];
const elements = Object.fromEntries(ids.map(id => [id, new MockElement(id, defaults[id] ?? '')]));
elements.gentleTab.className = 'active';
elements.wimSettings.className = 'hidden';
elements.ambient.value = 'off';
elements.ambientVolume.value = '35';

let now = 1_000_000;
let nextFrameId = 1;
const frames = new Map(), documentListeners = new Map(), windowListeners = new Map(), spoken = [];
const audioStats = { started:0, stopped:0, periodicWaves:0 };
const document = {
  hidden:false,
  getElementById:id => elements[id],
  querySelectorAll:selector => selector === 'input[type="number"]' ? Object.keys(defaults).map(id => elements[id]) : [],
  addEventListener:(type, listener) => documentListeners.set(type, listener)
};
class MockUtterance { constructor(text) { this.text = text; } }
class MockAudioParam {
  constructor(value = 0) { this.value = value; }
  setValueAtTime(value) { this.value = value; }
  exponentialRampToValueAtTime(value) { this.value = value; }
  setTargetAtTime(value) { this.value = value; }
  cancelScheduledValues() {}
}
class MockAudioNode {
  constructor() {
    this.gain = new MockAudioParam(1); this.frequency = new MockAudioParam(); this.detune = new MockAudioParam(); this.Q = new MockAudioParam(); this.type = 'sine';
  }
  connect() { return this; }
  start() { audioStats.started++; }
  stop() { audioStats.stopped++; }
  setPeriodicWave() {}
}
class MockAudioContext {
  constructor() { this.state = 'running'; this.currentTime = 0; this.destination = new MockAudioNode(); }
  resume() { this.state = 'running'; }
  createOscillator() { return new MockAudioNode(); }
  createGain() { return new MockAudioNode(); }
  createBiquadFilter() { return new MockAudioNode(); }
  createPeriodicWave() { audioStats.periodicWaves++; return {}; }
}
const window = {
  speechSynthesis:{ cancel() {}, speak(utterance) { spoken.push(utterance.text); } },
  SpeechSynthesisUtterance:MockUtterance,
  AudioContext:MockAudioContext,
  addEventListener:(type, listener) => windowListeners.set(type, listener)
};
const context = vm.createContext({
  document, window, Date:{ now:() => now }, console,
  requestAnimationFrame(callback) { const id = nextFrameId++; frames.set(id, callback); return id; },
  cancelAnimationFrame(id) { frames.delete(id); }
});
vm.runInContext(script, context, { filename:'index.html' });

function advance(milliseconds) {
  now += milliseconds;
  const pending = [...frames.values()];
  frames.clear();
  for (const callback of pending) callback(now);
}

assert.equal(elements.phase.textContent, 'Ready');
assert.equal(elements.clock.textContent, '03:00');
assert.match(html, /Ambient Drone &amp; Warm Synthesizers/);
assert.match(html, /Natural &amp; Organic Soundscapes/);
assert.match(html, /Acoustic Instrumental &amp; Neo-Classical/);
assert.match(html, /filter\.type = 'lowpass'/);

elements.start.click();
assert.equal(elements.phase.textContent, 'Inhale');
assert.equal(elements.start.textContent, 'Ⅱ Pause');
assert.equal(elements.orb.style.values.get('--orb-scale'), '0.760');

advance(2_000);
assert.equal(elements.phase.textContent, 'Inhale');
assert.equal(elements.clock.textContent, '02:58');
assert.equal(elements.orb.style.values.get('--orb-scale'), '0.940');

advance(3_000);
assert.equal(elements.phase.textContent, 'Pause');
assert.equal(elements.orb.style.values.get('--orb-scale'), '1.120');

// Simulate a dimmed/suspended page with no animation frames for four seconds.
document.hidden = true;
documentListeners.get('visibilitychange')();
now += 4_000;
document.hidden = false;
documentListeners.get('visibilitychange')();
assert.equal(elements.phase.textContent, 'Exhale');
assert.equal(elements.clock.textContent, '02:51');
assert.equal(elements.start.textContent, 'Ⅱ Pause');

// A user-initiated pause still freezes elapsed time.
elements.start.click();
const pausedClock = elements.clock.textContent;
now += 10_000;
elements.start.click();
assert.equal(elements.clock.textContent, pausedClock);

// Voice is opt-in and announces the active phase.
elements.reset.click();
elements.voice.checked = true;
elements.voice.dispatch('change');
elements.start.click();
assert.equal(spoken.at(-1), 'Inhale');
advance(4_000);
assert.equal(spoken.at(-1), 'Hold');

// Both modes work and Wim Hof retains its manual hold and recovery flow.
elements.wimTab.click();
assert.equal(elements.status.textContent, 'Wim Hof · seated or lying down');
elements.start.click();
assert.equal(elements.status.textContent, 'Wim Hof · Round 1 / 3');
advance(120_000);
assert.equal(elements.phase.textContent, 'Hold');
assert.equal(elements.start.textContent, 'End hold');
elements.start.click();
assert.equal(elements.phase.textContent, 'Recovery');

// Each background profile builds and starts a Web Audio graph, including the
// periodic-wave generator used for the organic soundscape.
for (const profile of ['drone', 'nature', 'acoustic']) {
  elements.reset.click();
  elements.ambient.value = profile;
  const before = audioStats.started;
  elements.start.click();
  assert.ok(audioStats.started > before, `${profile} starts an audio graph`);
}
assert.ok(audioStats.periodicWaves > 0, 'organic soundscape uses seamless periodic noise');
elements.ambientVolume.value = '52';
elements.ambientVolume.dispatch('input');
assert.equal(elements.ambientLevel.textContent, '52%');

console.log('Morning Breath timer tests passed');
