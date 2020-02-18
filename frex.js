function modulo(n,d) {
  return ((n % d) + d) % d;
}

var audioContext;
var lookahead;

var schedulerInterval = 10; // ms

var keys, rate, sequence, tuning, waveform;
var baseFreq;

var analyser;
var oscilloscope;

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


window.addEventListener('keydown', this.onkeydown);
window.addEventListener('keyup', this.onkeyup);

window.onload = function() {
  document.getElementById('keymap').oninput = changedKeymap;
  document.getElementById('partials').oninput = changedPartials;
  document.getElementById('scale').oninput = changedTuningString;
  document.getElementById('baseNote').oninput = changedTuningString;
  document.getElementById('baseFreq').oninput = changedTuningString;
  document.getElementById('sequence').oninput = changedSequence;
  document.getElementById('rate').oninput = changedRate;

  for (el of document.getElementsByClassName('input'))
    el.onblur = () =>  window.history.replaceState({}, "", getLink());

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

window.onbeforeunload = () => {
   Module.ccall('free', 'void', ['number'], [tuning]);
   return null;
}

function parseMath(expr) {
  let result = Module.ccall('te_interp', 'number', ['string','number'], [expr, 0]);
  return isNaN(result) ? 0 : result;
}

function getStepAtTime(time) {
  return stopped ? 0 : modulo(step + Math.trunc(lastRate * (time - stepTime)), sequence.length);
}

function start() {
  // Check if autoplay is not allowed
  if (audioContext.state=='suspended') audioContext.resume();
  if (audioContext.state=='running') {
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 32768;

    analyser.connect(audioContext.destination);

    if (analyser.getFloatTimeDomainData)
      oscilloscope = new Float32Array(analyser.frequencyBinCount);
    else
      oscilloscope = new Uint8Array(analyser.frequencyBinCount);

    lookahead = 2*schedulerInterval/1000;
    for (el of document.getElementsByClassName("input")) {
      el.setAttribute("contenteditable","plaintext-only");
      el.setAttribute("spellcheck", "false");
      el.style.color = "#0f0";
      el.style.background = "#00ff000f";
    }
    document.getElementById("start").style.display = "none";

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
    let phase = modulo(-time*sr, period);
    for (let i=0; i<2*period; i++)
      str += (i===0? "M " : "L ") + (i-phase)/period + " " +
             transform(oscilloscope[i+oscilloscope.length-Math.ceil(2*period)]) + " ";

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
      if (!(pressedKeys.has(key)
          || (sequence.length > step
              && sequence[step].includes(key))))
        stopVoice(key, stepTime);

    if (sequence.length>step) {
      for (let i=0; i<sequence[step].length; i++) {
        let key = sequence[step][i];
        startVoice(key, stepTime);
      }
    }
  }
}

function startVoice(key, time) {
  if (key in keys) {
    let freq = Module.ccall('noteToFreq', 'number', ['number', 'number'], [keys[key], tuning]);
    if (freq!=0 && !isNaN(freq)) {
      let absFreq = Math.abs(freq);
      let osc = audioContext.createOscillator();
      let gain = audioContext.createGain();
      let fade = 0.25/absFreq
      osc.setPeriodicWave(waveform);
      osc.frequency.value = freq;
      gain.gain.value = 0;
      gain.gain.setTargetAtTime(20/absFreq, time, fade);
      osc.connect(gain).connect(analyser);
      osc.start(time);
      if (key in voices) stopVoice(key, time);
      voices[key] = {osc: osc, gain: gain, fade: fade};
    }
  }
}

function stopVoice(key, time) {
  if (key in voices) {
    voices[key].gain.gain.setTargetAtTime(0, time, voices[key].fade);
    voices[key].osc.stop(time + 10 * voices[key].fade);
    delete voices[key];
  }
}

function onkeydown(e) {
  if (!(e.repeat || e.ctrlKey || e.metaKey)) {
    pressedKeys.add(e.key);
    startVoice(e.key, audioContext.currentTime);
  }
}

function onkeyup(e) {
  pressedKeys.delete(e.key);
  let time = audioContext.currentTime;
  if (rate==0 || !sequence[getStepAtTime(time)].includes(e.key))
    stopVoice(e.key, time);
}

function changedRate() {
  let expr = document.getElementById('rate').innerHTML;
  rate = parseMath(expr);

  if (rate==0) {
    for (key in voices) stopVoice(key, audioContext.currentTime);
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
  for (key in voices) if (!sequence[step].includes(key)) stopVoice(key, audioContext.currentTime);
  for (const key of sequence[step]) if (!(key in voices)) startVoice(key, audioContext.currentTime);
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

  baseFreq = Math.abs(parseMath(baseFreqString));

  let tmp = Module.ccall('newTuning','number', ['string','string','string'], [baseNoteString, baseFreqString, scaleString]);
  if (tmp != 0) {
    Module.ccall('free', 'void', ['number'], [tuning]);
    tuning = tmp;
    for (key in voices) startVoice(key, audioContext.currentTime);
  }
}

function changedPartials() {
  let elm = document.getElementById("partials");
  let partials = htmlToString(elm.innerHTML).split(/\r?\n/).map(parseMath).map(Math.round);
  let spectrum = new Float32Array(1 + Math.max(...partials.map(Math.abs)));
  for (partial of partials) if (partial!=0) spectrum[Math.abs(partial)] = 1/partial;
  waveform = audioContext.createPeriodicWave(new Float32Array(spectrum.length), spectrum);
  for (voice of Object.values(voices)) { voice.osc.setPeriodicWave(waveform); }
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
  numbers.style.fontSize = style.getPropertyValue('font-size');

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
