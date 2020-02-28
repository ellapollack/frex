## Controls

- ### `KEY MAP`
  each line is a string of **keys** which are mapped to the **note** equal to their line number

- ### `RATE`
  a **math expression** for the rate of `SEQUENCE` playback (steps per second)

- ### `SEQUENCE`
  each line is a string of **keys** which are played at the **step** equal to their line number

- ### `BASE NOTE`
  a **math expression** for the integer note number of the tonic

- ### `BASE FREQ`
  a **math expression** for the frequency of the tonic (cycles per second)

- ### `SCALE`
  each line is a **math expression** for the frequency interval of the `SCALE` **degree** equal to its line number. The last line is the octave interval.

- ### `PARTIALS`
  each line is a **math expression** for the integer frequency interval of a sine component in the oscillator waveform

---

**Frequency Explorer** was built using these open-source code libraries:

- [scalemap](https://github.com/maxwellpollack/scalemap) for **microtonal note-to-frequency mapping**
- [TinyExpr](https://codeplea.com/tinyexpr) for **math expression parsing**
- [Emscripten](https://emscripten.org/) for **compiling C &rarr; WebAssembly**
