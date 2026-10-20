// "Kaun bol raha hai": awaaz ki loudness naapta hai (Web Audio API)

const CHECK_EVERY_MS = 100;
const LOUDNESS_THRESHOLD = 0.035; // isse upar = koi bol raha hai (zyada/kam karke tune kar sakte ho)
const HOLD_MS = 350; // awaaz ruk bhi jaye to itni der "bol raha hai" dikhao, warna border jhilmilata hai

let sharedContext = null; // ek hi AudioContext sab ke liye (browsers ki limit hoti hai)

function getContext() {
  if (!sharedContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    sharedContext = new AudioContextClass();
  }
  if (sharedContext.state === 'suspended') {
    // Bina user ke click ke browser audio context chalu nahi karta, pehle click par chalu kar do
    const resume = () => sharedContext?.resume().catch(() => {});
    document.addEventListener('pointerdown', resume, { once: true });
    document.addEventListener('keydown', resume, { once: true });
  }
  return sharedContext;
}

export function resumeAudioContext() {
  if (sharedContext && sharedContext.state === 'suspended') {
    sharedContext.resume().catch(() => {});
  }
}

// track: ek audio track. onChange(true/false) tab bulaya jata hai jab "bol raha hai" badle
export function createSpeakingDetector(track, onChange) {
  const context = getContext();
  const source = context.createMediaStreamSource(new MediaStream([track]));
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser); // speaker se nahi jodte, warna awaaz double sunayi degi

  const samples = new Uint8Array(analyser.fftSize);
  let speaking = false;
  let lastLoudAt = 0;

  const timer = setInterval(() => {
    analyser.getByteTimeDomainData(samples);

    // RMS: awaaz ki average taakat (0 = chuppi, 1 = bahut tez)
    let sumSquares = 0;
    for (let i = 0; i < samples.length; i++) {
      const centered = (samples[i] - 128) / 128;
      sumSquares += centered * centered;
    }
    const loudness = Math.sqrt(sumSquares / samples.length);

    const now = Date.now();
    if (loudness > LOUDNESS_THRESHOLD) lastLoudAt = now;

    const nowSpeaking = now - lastLoudAt < HOLD_MS;
    if (nowSpeaking !== speaking) {
      speaking = nowSpeaking;
      onChange(speaking);
    }
  }, CHECK_EVERY_MS);

  return {
    stop() {
      clearInterval(timer);
      source.disconnect();
    },
  };
}