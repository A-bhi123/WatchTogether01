// Mic ki pasand is browser mein yaad rehti hai (Chrome aur Edge ki alag-alag)
const KEY = 'wt.micSettings';

// autoGainControl band: Chrome ki auto-gain Windows ka mic volume khud badal sakti hai
const DEFAULTS = {
  deviceId: '', // khaali = system ka default mic
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: false,
};

export function loadMicSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveMicSettings(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // storage band ho to bhi app chalta rahe
  }
}

export function buildAudioConstraints(settings) {
  const constraints = {
    echoCancellation: settings.echoCancellation,
    noiseSuppression: settings.noiseSuppression,
    autoGainControl: settings.autoGainControl,
  };
  if (settings.deviceId) constraints.deviceId = { exact: settings.deviceId };
  return constraints;
}