import { useEffect, useRef, useState } from 'react';

// Share chalte waqt movie ki jagah main stage par ye dikhta hai
function ScreenView({ mine, peer, onStop }) {
  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const [muted, setMuted] = useState(false);

  const stream = peer?.screenStream || null;
  const hasAudio = Boolean(stream && stream.getAudioTracks().length > 0);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    el.srcObject = stream;
    if (!stream) return;

    el.muted = false;
    setMuted(false);
    el.play().catch((err) => {
      if (err.name === 'NotAllowedError') {
        // Browser ne awaaz wala autoplay roka: bina awaaz ke chalao, user baad mein unmute kare
        el.muted = true;
        setMuted(true);
        el.play().catch(() => {});
      }
    });
  }, [stream]);

  function toggleMute() {
    const el = videoRef.current;
    if (!el) return;
    el.muted = !el.muted;
    setMuted(el.muted);
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else containerRef.current?.requestFullscreen?.();
  }

  // Share karne wale ko apni hi screen dikhane se "infinity mirror" ban jata, isliye sirf panel
  if (mine) {
    return (
      <div className="screen-view screen-view--mine">
        <div style={{ fontSize: '40px' }}>🖥</div>
        <h3 style={{ margin: 0 }}>You're sharing your screen</h3>
        <p style={{ margin: 0, color: '#999', fontSize: '13px' }}>
          Everyone in the room can see it. The movie is paused until you stop.
        </p>
        <button className="screen-stop" onClick={onStop}>Stop sharing</button>
      </div>
    );
  }

  return (
    <div className="screen-view" ref={containerRef}>
      <video ref={videoRef} autoPlay playsInline className="screen-video" />

      {!stream && <div className="screen-wait">Connecting to {peer?.name}'s screen...</div>}

      <div className="screen-chip">🖥 {peer?.name} is sharing their screen</div>

      <div className="screen-bar">
        {hasAudio && (
          <button onClick={toggleMute}>{muted ? '🔇 Unmute' : '🔊'}</button>
        )}
        <button onClick={toggleFullscreen} title="Fullscreen">⛶</button>
      </div>
    </div>
  );
}

export default ScreenView;