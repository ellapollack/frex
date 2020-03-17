function modulo(n,d) {
  return ((n % d) + d) % d;
}

var audioContext;
var lookahead;

var schedulerInterval = 10; // ms
var kybdActive = true;

var keys, rate, sequence, tuning, waveform;
var baseFreq;

var tanhIIRNode = null;
var analyser;
var oscilloscope;
var output;

var sequencer;
var step=0;
var stepTime;
var lastRate = 0;
var stopped = true;
var highlightedStep;

var pressedKeys = new Set();
var voices = {};

const fields = {k:'keymap',
                p:'partials',
                s:'scale',
                r:'rate',
                q:'sequence',
                n:'baseNote',
                f:'baseFreq'};

Module.onRuntimeInitialized = function() {
  document.getElementById('keymap').oninput = changedKeymap;
  document.getElementById('partials').oninput = changedPartials;
  document.getElementById('scale').oninput = changedTuningString;
  document.getElementById('baseNote').oninput = changedTuningString;
  document.getElementById('baseFreq').oninput = changedTuningString;
  document.getElementById('sequence').oninput = changedSequence;
  document.getElementById('rate').oninput = changedRate;

  for (el of document.getElementsByClassName('input')) {
      el.setAttribute("contenteditable","plaintext-only");
      el.setAttribute("spellcheck", "false");
      el.style.color = "#0f0";
      el.style.background = "#00ff000f";
      el.onblur = () => {
        window.history.replaceState({}, "", getLink())
        kybdActive = true;
      };
      el.onfocus = () => { kybdActive = false };
  }

  for (el of document.getElementsByClassName('single-line')) {
    el.addEventListener('keydown', (e) => {if (e.keyCode == 13) e.preventDefault();});
    el.addEventListener('paste', e => {
      let paste = (e.clipboardData || window.clipboardData).getData('text');
      document.execCommand("insertText", false, paste.replace(/[\r?\n]+/g,""));
      e.preventDefault();
    });
  }

  for (const [key,value] of new URLSearchParams(document.location.search.replace(/^\?|\/$/g,"")))
    if (key in fields) document.getElementById(fields[key]).innerHTML = decodeURIComponent(value);

  for (numbered of document.getElementsByClassName("numbered")) initNumbers(numbered);

  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  document.getElementById("start").onclick = start;
  start();
};

function getStepAtTime(time) {
  return stopped ? 0 : modulo(step + Math.trunc(lastRate * (time - stepTime)), sequence.length);
}

function start() {
  // Check if autoplay is not allowed
  if (audioContext.state=='suspended') audioContext.resume();
  if (audioContext.state=='running') {
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 32768;

    if (audioContext.audioWorklet)
      audioContext.audioWorklet.addModule('./tanhiir.js').then(()=>{
        tanhIIRNode = new AudioWorkletNode(audioContext, 'tanh-iir-processor');
        tanhIIRNode.connect(analyser).connect(audioContext.destination);
        output = tanhIIRNode;
      });
    else { analyser.connect(audioContext.destination); output = analyser; }

    if (analyser.getFloatTimeDomainData)
      oscilloscope = new Float32Array(analyser.fftSize);
    else
      oscilloscope = new Uint8Array(analyser.fftSize);

    lookahead = 2*schedulerInterval/1000;
    for (el of document.getElementsByClassName("input")) {
    }

    document.getElementById("start").style.display = "none";

    document.addEventListener('keydown', onkeydown);
    document.addEventListener('keyup', onkeyup);

    // if(navigator.requestMIDIAccess) {
    //   navigator.requestMIDIAccess({sysex: false}).then((midiAccess) => {
    //     midiAccess.onstatechange = () => {populateIO(midiAccess)};
    //     populateIO(midiAccess);
    //   });
    // }

    changedTuningString();
    changedKeymap();
    changedPartials();
    changedSequence();
    changedRate();
    requestAnimationFrame(draw);
  }
}

function htmlToString(html) {
  return html.replace("<br>","\n").replace(/\n$/,"");
}

function draw() {
  let time = audioContext.currentTime;
  let currentStep = getStepAtTime(time);
  if (highlightedStep != currentStep) {
    if (highlightedStep) highlightedStep.style.color = "";
    highlightedStep = document.querySelector('#sequence').parentNode.firstChild.childNodes[currentStep];
    if (highlightedStep) highlightedStep.style.color = "white";
  }

  let transform;
  if (analyser.getFloatTimeDomainData) {
    analyser.getFloatTimeDomainData(oscilloscope);
    transform = x => x;
  } else {
    analyser.getByteTimeDomainData(oscilloscope);
    transform = x => (x-128)/128;
  }

  if (oscilloscope.length && baseFreq) {
    let el = document.getElementById("oscilloscope");
    let str = "";
    let sr = audioContext.sampleRate;
    let period = Math.min(oscilloscope.length/2, sr/baseFreq);
    let phase = modulo(time*sr, period);
    for (let i=0; i<2*period; i++)
      str += (i===0? "M " : "L ") + (i-phase)/period + " " +
             transform(oscilloscope[oscilloscope.length-1-i]) + " ";

    el.setAttribute('d', str);
  }
  window.requestAnimationFrame(draw);
}

function stepSequence() {
  let time = audioContext.currentTime;
  let nextStep, nextStepTime;
  lastRate = rate;

  while (true) {

    if (stopped) { nextStep = step; nextStepTime = time; stopped = false; }
    else {
      nextStep = modulo(step + (rate<0 ? -1 : 1), sequence.length);
      nextStepTime = stepTime + Math.abs(1/rate);
    }

    if (nextStepTime > time + lookahead) break;
    else { stepTime = nextStepTime; step = nextStep; }

    for (key in voices)
      if (!sequence[step].includes(key))
        stopVoice(key, stepTime, 'seq');

    for (let i=0; i<sequence[step].length; i++) {
      startVoice(sequence[step][i], stepTime, 'seq');
    }
  }
}

function startVoice(key, time, source) {
  if (key in keys) {
    let freq = tuning.noteToFreq(keys[key]);
    if (freq!=0 && !isNaN(freq)) {
      if (key in voices) voices[key].holds.add(source);
      else {
        let absFreq = Math.abs(freq);
        let osc = audioContext.createOscillator();
        let gain = audioContext.createGain();
        osc.setPeriodicWave(waveform);
        osc.frequency.value = freq;
        gain.gain.value = 0;
        gain.gain.setTargetAtTime(20/absFreq, time, 0.25/absFreq);
        osc.connect(gain);
        gain.connect(output);
        osc.start(time);
        voices[key] = {osc: osc,
                       gain: gain,
                       holds: new Set([source]),
                       startTime: time};
      }
    }
  }
}

function stopVoice(key, time, source) {
  if (key in voices) {
    voices[key].holds.delete(source);
    if (voices[key].holds.size==0) {
      let fade = 0.25/voices[key].osc.frequency.value;
      voices[key].gain.gain.setTargetAtTime(0, time, fade);
      voices[key].osc.stop(time + 10*fade);
      delete voices[key];
    }
  }
}

function onkeydown(e) {
  if (kybdActive && !(e.repeat || e.ctrlKey || e.metaKey))
    startVoice(e.key, audioContext.currentTime, 'kybd');
}

function onkeyup(e) {
  if (kybdActive && !(e.ctrlKey || e.metaKey))
  stopVoice(e.key, audioContext.currentTime, 'kybd');
}

function changedRate() {
  rate = parseExpr(document.getElementById('rate').innerHTML);

  if (rate==0) {
    for (key in voices) stopVoice(key, audioContext.currentTime, 'seq');
    sequencer = clearInterval(sequencer);
    step = 0;
    stopped = true;
  }
  else if (!sequencer) sequencer = setInterval(stepSequence, schedulerInterval);
}

function changedSequence() {
  let elm = document.getElementById('sequence');
  sequence = htmlToString(elm.innerHTML).split(/\r?\n/);
  step = modulo(step, sequence.length);
  if (sequencer) {
    for (key in voices)
      if (!sequence[step].includes(key))
        stopVoice(key, audioContext.currentTime, 'seq');
    for (const key of sequence[step])
      if (!(key in voices))
        startVoice(key, audioContext.currentTime, 'seq');
  }
}

function changedKeymap() {
  let elm = document.getElementById('keymap');
  let lines = htmlToString(keymap.innerHTML).split(/\r?\n/);

  keys = {};

  for (let i=0; i<lines.length; i++)
    for (let j=0; j<lines[i].length; j++)
      keys[lines[i][j]] = i+1;
}

function changedTuningString() {

  let elm = document.getElementById("scale");
  let scaleString = htmlToString(elm.innerHTML);
  let baseNoteString = document.getElementById("baseNote").innerHTML;
  let baseFreqString = document.getElementById("baseFreq").innerHTML;

  baseFreq = Math.abs(parseExpr(baseFreqString));

  tuning = new Tuning(baseNoteString, baseFreqString, scaleString);

  let time = audioContext.currentTime;

  for (key in voices) {
    let period = 1/voices[key].osc.frequency.value;
    let phase = modulo(time-voices[key].startTime, period) / period;
    let newFreq = tuning.noteToFreq(keys[key]);
    if (newFreq!==0 && !isNaN(newFreq)) {
      let absFreq = Math.abs(newFreq);
      voices[key].osc.frequency.setValueAtTime(newFreq, time);
      voices[key].gain.gain.setTargetAtTime(20/absFreq,time,0.25/absFreq);
      voices[key].startTime = time - phase/newFreq;
    }
  }
}

function changedPartials() {
  let elm = document.getElementById("partials");
  let partials = htmlToString(elm.innerHTML).split(/\r?\n/).map(parseExpr).map(Math.round);
  let spectrum = new Float32Array(Math.min(4096, 1 + Math.max(...partials.map(Math.abs))));
  for (partial of partials) if (partial!=0 && Math.abs(partial)<4096) spectrum[Math.abs(partial)] = 1/partial;
  waveform = audioContext.createPeriodicWave(new Float32Array(spectrum.length), spectrum, {disableNormalization: true});
  let time = audioContext.currentTime;
  for (voice of Object.values(voices)) {
    let period = 1/voice.osc.frequency.value;
    let startTime = time - modulo(time-voice.startTime, period) + period;
    voice.osc.stop(startTime);
    let newOsc = audioContext.createOscillator();
    newOsc.setPeriodicWave(waveform);
    newOsc.frequency.value = voice.osc.frequency.value;
    newOsc.connect(voice.gain);
    newOsc.start(startTime);
    voice.osc = newOsc;
  }
}

function getLink() {
  let str = "";
  for (const [key,value] of Object.entries(fields)) {
    str += "&" + key + "=" + encodeURIComponent(document.getElementById(value).innerHTML);
  }
  return str.replace(/^\&/,"?");
}

function initNumbers(numbered, title) {
  let container = document.createElement("div");
  let numbers = document.createElement("pre");
  numbered.parentNode.insertBefore(container, numbered);
  container.appendChild(numbers);
  container.appendChild(numbered);
  if (title) {
    let title = document.createElement("pre");

  }
  container.style.position = "relative";
  numbers.style.position = "absolute";
  numbers.style.textAlign = "right";
  numbers.style.top = "0";
  numbers.style.marginLeft = "1em";

  let style = window.getComputedStyle(numbered);
  numbers.style.padding = style.getPropertyValue('padding');

  updateNumbers(numbered);
  numbered.addEventListener("input", () => {updateNumbers(numbered)});
}

function updateNumbers(numbered) {
  let numbers = numbered.parentNode.firstChild;

  numbers.innerHTML = '<div class="l1">1</div>';
  let line = 2;
  while (numbers.clientHeight < numbered.clientHeight)
  {
    numbers.insertAdjacentHTML("beforeend", '<div class="l'+line+'">'+line+"</div>");
    line++;
  }

  numbers.style.left = (-numbers.clientWidth).toString()+"px";
}
