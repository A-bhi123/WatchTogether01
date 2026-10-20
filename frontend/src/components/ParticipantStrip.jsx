import { useEffect, useRef, useState } from 'react';

function hasVideoTrack(stream) {
  return Boolean(stream && stream.getVideoTracks().length > 0);
}

function VideoTile({ stream, showVideo, mirrored, name, isHost, status, pinned, onTogglePin, speaking, micOn, sharing }) {
  const videoRef = useRef(null);

  // showVideo badalne par srcObject dobara lagate hain, taaki naya track pakda jaye
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream || null;
  }, [stream, showVideo]);

  const classes = ['tile'];
  if (pinned) classes.push('tile--pinned');
  if (speaking) classes.push('tile--speaking');

  return (
    <div className={classes.join(' ')}>
      {/* muted isliye: doosron ki awaaz alag Audio element se chalti hai, apni awaaz echo hoti */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="tile-video"
        style={{
          display: showVideo ? 'block' : 'none',
          transform: mirrored ? 'scaleX(-1)' : 'none',
        }}
      />

      {!showVideo && (
        <div className="tile-placeholder">
          <span className="tile-camera-icon">📷</span>
          {status && <span className="tile-status">{status}</span>}
        </div>
      )}

      <div className="tile-name">{isHost ? '👑 ' : ''}{name}</div>

      {sharing && <div className="tile-share">🖥 Sharing</div>}
      {!micOn && <div className="tile-mic" title="Mic off">🔇</div>}

      <button
        type="button"
        className={`tile-pin${pinned ? ' tile-pin--on' : ''}`}
        onClick={onTogglePin}
        aria-label={pinned ? 'Unpin' : 'Pin'}
        title={pinned ? 'Unpin' : 'Pin'}
      >
        📌{pinned ? ' Unpin' : ''}
      </button>
    </div>
  );
}

function ParticipantStrip({ isHost, localStream, cameraOn, micOn, selfSpeaking, screenSharing, peers, members }) {
  // null = koi pin nahi, 'self' = apni tile, warna kisi peer ka socketId
  const [pinnedId, setPinnedId] = useState(null);

  // Pin kiya hua banda room chhod de to apne aap unpin
  useEffect(() => {
    if (pinnedId && pinnedId !== 'self' && !peers.some((p) => p.socketId === pinnedId)) {
      setPinnedId(null);
    }
  }, [peers, pinnedId]);

  function togglePin(id) {
    setPinnedId((current) => (current === id ? null : id));
  }

  function isHostUser(userId) {
    return members.some((m) => m.id === userId && m.is_host);
  }

  function statusFor(peer) {
    if (!peer.media.camera || hasVideoTrack(peer.stream)) return '';
    return peer.connection === 'failed' ? 'Connection failed' : 'Connecting...';
  }

  const showSelf = pinnedId === null || pinnedId === 'self';
  const visiblePeers = pinnedId === null ? peers : peers.filter((p) => p.socketId === pinnedId);

  return (
    <div className={`room-strip${pinnedId !== null ? ' room-strip--pinned' : ''}`}>
      {showSelf && (
        <VideoTile
          stream={localStream}
          showVideo={cameraOn}
          mirrored
          name="You"
          isHost={isHost}
          pinned={pinnedId === 'self'}
          onTogglePin={() => togglePin('self')}
          speaking={micOn && selfSpeaking}
          micOn={micOn}
          sharing={screenSharing}
        />
      )}

      {visiblePeers.map((peer) => (
        <VideoTile
          key={peer.socketId}
          stream={peer.stream}
          showVideo={peer.media.camera && hasVideoTrack(peer.stream)}
          name={peer.name}
          isHost={isHostUser(peer.userId)}
          status={statusFor(peer)}
          pinned={pinnedId === peer.socketId}
          onTogglePin={() => togglePin(peer.socketId)}
          speaking={peer.media.mic && peer.speaking}
          micOn={peer.media.mic}
          sharing={peer.media.screen}
        />
      ))}
    </div>
  );
}

export default ParticipantStrip;