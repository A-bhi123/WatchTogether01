import { useEffect, useState } from 'react';
import { loadMicSettings, saveMicSettings, buildAudioConstraints } from '../services/micSettings';

function describeError(err) {
  switch (err?.name) {
    case 'NotAllowedError':
      return 'Microphone permission denied. Click the lock icon in the address bar and allow the microphone.';
    case 'NotFoundError':
      return 'No microphone found.';
    case 'NotReadableError':
      return 'This microphone is being used by another app. Close it and try again.';
    case 'OverconstrainedError':
      return 'This microphone is not available any more. Choose another one.';
    default:
      return 'Could not open the microphone.';
  }
}

function MicSettings({ onClose, onSaved }) {
  const [draft, setDraft] = useState(loadMicSettings);
  const [devices, setDevices] = useState([]);
  const [level, setLevel] = useState(0);
  const [activeLabel, setActiveLabel] = useState('');
  const [error, setError] = useState('');

  // Jab bhi choice badle, naye settings se mic ka preview dobara chalao (ye awaaz kahin bheji nahi jati)
  useEffect(() => {
    let cancelled = false;
    let stream = null;
    let context = null;
    let frame = 0;

    async function startPreview() {
      setError('');
      setLevel(0);
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: buildAudioConstraints(draft), video: false });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        const track = stream.getAudioTracks()[0];
        setActiveLabel(track.label || 'Unknown microphone');

        // Permission milne ke baad hi mic ke naam dikhte hain
        const all = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) setDevices(all.filter((d) => d.kind === 'audioinput'));

        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        context = new AudioContextClass();
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);

        function tick() {
          analyser.getByteTimeDomainData(samples);
          let sum = 0;
          for (let i = 0; i < samples.length; i++) {
            const centered = (samples[i] - 128) / 128;
            sum += centered * centered;
          }
          setLevel(Math.min(1, Math.sqrt(sum / samples.length) * 5));
          frame = requestAnimationFrame(tick);
        }
        tick();
      } catch (err) {
        if (!cancelled) setError(describeError(err));
      }
    }

    startPreview();

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
      context?.close().catch(() => {});
    };
  }, [draft]);

  function update(patch) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function handleSave() {
    saveMicSettings(draft);
    onSaved();
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <h3 style={styles.title}>Microphone settings</h3>

        {error && <p style={styles.error}>{error}</p>}

        <label style={styles.label}>Microphone</label>
        <select style={styles.select} value={draft.deviceId} onChange={(e) => update({ deviceId: e.target.value })}>
          <option value="">System default</option>
          {devices.map((d, i) => (
            <option key={d.deviceId || i} value={d.deviceId}>
              {d.label || `Microphone ${i + 1}`}
            </option>
          ))}
        </select>
        {activeLabel && <p style={styles.hint}>In use: {activeLabel}</p>}

        <label style={styles.label}>Say something: the bar should move</label>
        <div style={styles.meterTrack}>
          <div style={{ ...styles.meterFill, width: `${Math.round(level * 100)}%` }} />
        </div>

        <label style={styles.check}>
          <input type="checkbox" checked={draft.echoCancellation} onChange={(e) => update({ echoCancellation: e.target.checked })} />
          Echo cancellation
        </label>
        <label style={styles.check}>
          <input type="checkbox" checked={draft.noiseSuppression} onChange={(e) => update({ noiseSuppression: e.target.checked })} />
          Noise suppression
        </label>
        <label style={styles.check}>
          <input type="checkbox" checked={draft.autoGainControl} onChange={(e) => update({ autoGainControl: e.target.checked })} />
          Auto gain (can change your system mic volume in Chrome)
        </label>

        <p style={styles.hint}>
          Tip: the bar does not move? Pick another microphone. Voice cuts or sounds weak? Try switching a setting off.
          Use headphones to avoid echo.
        </p>

        <div style={styles.buttons}>
          <button style={{ ...styles.button, ...styles.save }} onClick={handleSave}>Save</button>
          <button style={styles.button} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  dialog: { background: '#1a1a1a', borderRadius: '12px', padding: '22px', width: '380px', maxWidth: '92vw', maxHeight: '90vh', overflowY: 'auto' },
  title: { color: 'white', margin: '0 0 14px', fontSize: '17px' },
  error: { background: '#3a1a1a', color: '#ffb3b3', fontSize: '13px', padding: '8px 10px', borderRadius: '8px', margin: '0 0 12px' },
  label: { display: 'block', color: '#bbb', fontSize: '13px', margin: '12px 0 6px' },
  select: { width: '100%', padding: '10px', background: '#262626', color: 'white', border: '1px solid #333', borderRadius: '8px', fontSize: '14px' },
  hint: { color: '#888', fontSize: '12px', margin: '8px 0 0' },
  meterTrack: { height: '10px', background: '#262626', borderRadius: '5px', overflow: 'hidden' },
  meterFill: { height: '100%', background: '#4caf50', transition: 'width 0.05s' },
  check: { display: 'flex', alignItems: 'center', gap: '8px', color: '#ddd', fontSize: '13px', margin: '10px 0 0' },
  buttons: { display: 'flex', gap: '8px', marginTop: '16px' },
  button: { flex: 1, padding: '11px', background: '#262626', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '14px' },
  save: { background: '#e01e1e', fontWeight: 'bold' },
};

export default MicSettings;