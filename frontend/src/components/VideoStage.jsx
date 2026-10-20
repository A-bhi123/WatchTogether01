import { useEffect, useRef, useState } from 'react';
import api, { API_ORIGIN } from '../services/api';
import { getSocket } from '../services/socket';
import { useAudioCheck } from '../hooks/useAudioCheck';

const ALLOWED_EXTENSIONS = ['.mp4', '.mkv', '.webm'];
const MAX_SIZE_MB = 2048; // backend ke MAX_VIDEO_SIZE_MB jaisa hi rakho

const SYNC_POLL_MS = 5000; // har 5 sec mein server se poocho "ab kahan hona chahiye?"
const IGNORE_MS = 3000; // code se kiye badlav ka event itni der tak "hamara apna" maana jayega
const SEEK_DEBOUNCE_MS = 250; // seek bar drag karte waqt sirf aakhri position bhejo
const LOCAL_ACTION_GRACE_MS = 2000; // apni action ke baad itni der sync-jawab ignore
const DRIFT_LIMIT_EVENT = 0.3; // kisi ke play/pause/seek par itna fark chalega
const DRIFT_LIMIT_SYNC = 1.0; // poll ke jawab par itna fark chalega

function getExtension(fileName) {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? '' : fileName.slice(dot).toLowerCase();
}

function formatSize(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatTime(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00';
  const s = Math.floor(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

// Toast ka text: "Rahul paused" jaisa
function describeAction(state) {
  if (!state.by) return null;
  if (state.reason === 'play') return `${state.by} played`;
  if (state.reason === 'pause') return `${state.by} paused`;
  if (state.reason === 'seek') return `${state.by} jumped to ${formatTime(state.position)}`;
  return null;
}

function VideoStage({ roomCode, isHost, video, onVideoChange, socketReady, suspended, shareOwner }) {
  const videoRef = useRef(null);
  const fileInputRef = useRef(null);
  const abortRef = useRef(null);
  const applyStateRef = useRef(() => {});
  const seekTimerRef = useRef(null);
  const toastTimerRef = useRef(null);
  const lastLocalActionRef = useRef(0);
  // Har event type ke liye: "is waqt tak ka agla event hamara apna (code wala) hai"
  const ignoreRef = useRef({ play: 0, pause: 0, seek: 0 });

  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadError, setUploadError] = useState('');
  const [playError, setPlayError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [needsClick, setNeedsClick] = useState(false);
  const [toast, setToast] = useState('');

  const videoId = video ? video.id : null;
    const audioWarning = useAudioCheck(videoRef, video);

  // ---------- Upload (sirf host) ----------
  async function uploadFile(file) {
    setUploadError('');
    setPlayError('');

    if (!ALLOWED_EXTENSIONS.includes(getExtension(file.name))) {
      setUploadError('Only MP4, MKV and WebM files are supported.');
      return;
    }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      setUploadError(`This file is too large. Maximum size is ${MAX_SIZE_MB} MB.`);
      return;
    }

    const formData = new FormData();
    formData.append('video', file);

    const controller = new AbortController();
    abortRef.current = controller;
    setUploading(true);
    setProgress(0);

    try {
      const res = await api.post(`/rooms/${roomCode}/videos`, formData, {
        signal: controller.signal,
        timeout: 0, // movie ki upload kitni bhi lambi ho, 20 sec ki default limit se mat roko
        onUploadProgress: (event) => {
          if (event.total) setProgress(Math.round((event.loaded / event.total) * 100));
        },
      });
      onVideoChange(res.data.video);
   if (res.data.warning) setUploadError(res.data.warning); // jaise ffprobe na mile to
    } catch (err) {
      if (err.code === 'ERR_CANCELED') {
        setUploadError('Upload cancelled.');
      } else if (err.response) {
        setUploadError(err.response.data?.error || 'Upload failed. Please try again.');
      } else {
        setUploadError('Could not reach the server. Check your connection and try again.');
      }
    } finally {
      setUploading(false);
      abortRef.current = null;
    }
  }

  function openFilePicker() {
    if (!uploading) fileInputRef.current?.click();
  }

  function handleFileChosen(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) uploadFile(file);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    if (!isHost || uploading) return;
    const file = e.dataTransfer.files?.[0];
    if (file) uploadFile(file);
  }

  function handleVideoError(e) {
    const code = e.target.error?.code;
    setPlayError(
      code === 4
        ? "Your browser can't play this file (format or codec not supported). MP4 (H.264 + AAC) or WebM works best."
        : 'Could not load the video. Please try again.'
    );
  }

  // ---------- Sync: loop se bachav ----------
  // Code se play/pause/seek karne se pehle isse flag lagate hain, aur event aate hi flag hat jata hai
  function markIgnore(kind) {
    ignoreRef.current[kind] = Date.now() + IGNORE_MS;
  }
  function consumeIgnore(kind) {
    if (Date.now() < ignoreRef.current[kind]) {
      ignoreRef.current[kind] = 0;
      return true;
    }
    return false;
  }

  function showToast(text) {
    setToast(text);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(''), 2500);
  }

  // ---------- Sync: server ki state video par lagana ----------
  async function applyState(state) {
    const el = videoRef.current;
    if (!el || videoId === null || state.videoId !== videoId) return; // kisi purani movie ki state

        if (suspended) return; // screen share chal rahi hai, movie ki state abhi mat lagao

    const message = describeAction(state);
    if (message) showToast(message);

    if (el.readyState < 1) return; // metadata abhi load nahi hui, load hote hi dobara maang lenge

    // Poll ka jawab: agar tum abhi khud kuch kar rahe ho (seek drag, pause...) to tumhe mat chhedo
    if (
      state.reason === 'sync' &&
      (el.seeking || Date.now() - lastLocalActionRef.current < LOCAL_ACTION_GRACE_MS)
    ) {
      return;
    }

    const limit = state.reason === 'sync' ? DRIFT_LIMIT_SYNC : DRIFT_LIMIT_EVENT;

    if (Math.abs(el.currentTime - state.position) > limit) {
      markIgnore('seek');
      el.currentTime = state.position;
    }

    if (state.isPlaying && el.paused) {
      markIgnore('play');
      try {
        await el.play();
        setNeedsClick(false);
      } catch (err) {
        ignoreRef.current.play = 0; // play hua hi nahi, to uska event bhi nahi aayega
        if (err.name === 'NotAllowedError') setNeedsClick(true); // browser ne autoplay roka
      }
    } else if (!state.isPlaying && !el.paused) {
      markIgnore('pause');
      el.pause();
    }
  }

  // Har render par latest applyState rakho, taaki socket listener purana version na pakde
  useEffect(() => {
    applyStateRef.current = applyState;
  });

  // Server se aane wali state sunna (doosron ke events, aur apne request ka jawab)
  useEffect(() => {
    const socket = getSocket();
    function handleState(state) {
      applyStateRef.current(state);
    }
    socket.on('player:state', handleState);
    return () => socket.off('player:state', handleState);
  }, []);

  // Room join hone par (aur nayi movie aane par) abhi ki state maango
  useEffect(() => {
    if (socketReady && videoId !== null) {
      getSocket().emit('player:request-state');
    }
  }, [socketReady, videoId]);

  // Har 5 sec mein "ab kahan hona chahiye?" poocho, isse drift aur race conditions theek hote hain
  useEffect(() => {
    if (!socketReady || videoId === null) return;
    const timer = setInterval(() => getSocket().emit('player:request-state'), SYNC_POLL_MS);
    return () => clearInterval(timer);
  }, [socketReady, videoId]);

  // Nayi movie aate hi local state reset
  useEffect(() => {
    setNeedsClick(false);
  }, [videoId]);

    // Screen share shuru hone par movie ruk jati hai, khatam hone par room ki state par wapas aati hai
  useEffect(() => {
    const el = videoRef.current;
    if (suspended) {
      if (el && !el.paused) {
        markIgnore('pause'); // ye hamara apna pause hai, alag se event mat bhejo
        el.pause();
      }
      if (shareOwner) sendUpdate('pause'); // share karne wala poore room ki movie pause kar de
    } else if (socketReady && videoId !== null) {
      getSocket().emit('player:request-state');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suspended]);


  // Page chhodte waqt timers band
  useEffect(() => {
    return () => {
      clearTimeout(seekTimerRef.current);
      clearTimeout(toastTimerRef.current);
    };
  }, []);

  // ---------- Sync: apni action server ko bhejna (har koi) ----------
  function sendUpdate(reason) {
    const el = videoRef.current;
    if (!el || videoId === null) return;
    clearTimeout(seekTimerRef.current);
    lastLocalActionRef.current = Date.now();
    getSocket().emit('player:update', {
      videoId,
      reason,
      isPlaying: !el.paused,
      position: el.currentTime,
    });
  }

  function handlePlay() {
    if (consumeIgnore('play')) return; // ye hamara code wala play tha
    sendUpdate('play');
  }

  function handlePause() {
    if (consumeIgnore('pause')) return;
    sendUpdate('pause');
  }

  function handleSeeked() {
    if (consumeIgnore('seek')) return;
    lastLocalActionRef.current = Date.now();
    // Seek bar drag karne par bahut saare seeked events aate hain, 250 ms ruk kar sirf aakhri bhejo
    clearTimeout(seekTimerRef.current);
    seekTimerRef.current = setTimeout(() => sendUpdate('seek'), SEEK_DEBOUNCE_MS);
  }

  function handleLoadedMetadata() {
    // Ab video tayyar hai, tab ki sabse taazi position maango
    if (socketReady) getSocket().emit('player:request-state');
  }

  function handleJoinClick() {
    setNeedsClick(false);
    getSocket().emit('player:request-state'); // click ke baad browser play() allow kar deta hai
  }

  return (
    <div
      style={styles.stage}
      onDragOver={(e) => {
        if (isHost) {
          e.preventDefault();
          setDragOver(true);
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".mp4,.mkv,.webm,video/mp4,video/webm,video/x-matroska"
        style={{ display: 'none' }}
        onChange={handleFileChosen}
      />

      {video ? (
        <>
          <video
            key={video.id}
            ref={videoRef}
            style={styles.video}
            src={`${API_ORIGIN}${video.url}`}
            controls
            preload="metadata"
            onError={handleVideoError}
            onLoadedData={() => setPlayError('')}
            onLoadedMetadata={handleLoadedMetadata}
            onPlay={handlePlay}
            onPause={handlePause}
            onSeeked={handleSeeked}
          />

          <div style={styles.topBar}>
            <span style={styles.titleChip}>🎬 {video.title} · {formatSize(video.size)}</span>
            <div style={styles.topRight}>
              <span className="vs-sync" style={styles.syncChip}>● Synced with room</span>
              {isHost && (
                <button style={styles.changeButton} onClick={openFilePicker} disabled={uploading}>
                  Change movie
                </button>
              )}
            </div>
          </div>

          {toast && <div style={styles.toast}>{toast}</div>}

          {needsClick && (
            <div style={styles.joinOverlay}>
              <button style={styles.joinButton} onClick={handleJoinClick}>▶ Click to join the movie</button>
              <p style={{ color: '#aaa', fontSize: '12px', marginTop: '10px' }}>
                Your browser needs one click before it can play with sound.
              </p>
            </div>
          )}
        </>
      ) : isHost ? (
        <div
          style={{ ...styles.dropzone, ...(dragOver ? styles.dropzoneActive : {}) }}
          onClick={openFilePicker}
        >
          <div style={{ fontSize: '40px' }}>📁</div>
          <h3 style={{ color: 'white', margin: '10px 0 4px' }}>Select Movie From Device</h3>
          <p style={{ color: '#999', fontSize: '13px', margin: 0 }}>
            MP4, MKV, WebM — streams to all participants
          </p>
          <p style={{ color: '#666', fontSize: '12px', margin: '8px 0 0' }}>Click or drag & drop a file here</p>
        </div>
      ) : (
        <div style={styles.waiting}>
          <div style={{ fontSize: '36px' }}>🎬</div>
          <p style={{ color: '#bbb', margin: '10px 0 0' }}>Waiting for the host to select a movie...</p>
        </div>
      )}

      {uploading && (
        <div style={styles.uploadOverlay}>
          <p style={{ color: 'white', margin: '0 0 12px', fontSize: '15px' }}>
            {progress >= 100 ? 'Processing... checking the audio and converting it if needed' : `Uploading... ${progress}%`}
          </p>
          <div style={styles.progressTrack}>
            <div style={{ ...styles.progressFill, width: `${progress}%` }} />
          </div>
          <p style={{ color: '#888', fontSize: '12px', margin: '12px 0' }}>Keep this tab open until the upload finishes.</p>
          <button style={styles.cancelButton} onClick={() => abortRef.current?.abort()}>Cancel</button>
        </div>
      )}

      {playError && <div style={styles.errorBanner}>{playError}</div>}
      {audioWarning && (
        <div style={{ ...styles.errorBanner, bottom: playError ? '120px' : '70px' }}>🔇 {audioWarning}</div>
      )}
      {uploadError && !uploading && <div style={styles.errorBanner}>{uploadError}</div>}
    </div>
  );
}

const styles = {
  stage: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000' },
  video: { width: '100%', height: '100%', objectFit: 'contain', background: '#000' },
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0, padding: '10px 14px',
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px',
    background: 'linear-gradient(rgba(0,0,0,0.7), transparent)', pointerEvents: 'none',
  },
  titleChip: { color: 'white', fontSize: '13px', maxWidth: '55%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  topRight: { display: 'flex', alignItems: 'center', gap: '10px' },
  syncChip: { color: '#4caf50', fontSize: '12px' },
  changeButton: {
    pointerEvents: 'auto', background: 'rgba(0,0,0,0.6)', color: 'white', border: '1px solid #444',
    borderRadius: '6px', padding: '5px 10px', cursor: 'pointer', fontSize: '12px',
  },
  toast: {
    position: 'absolute', top: '48px', left: '50%', transform: 'translateX(-50%)',
    background: 'rgba(0,0,0,0.75)', color: 'white', fontSize: '13px', padding: '7px 14px',
    borderRadius: '16px', pointerEvents: 'none', zIndex: 3,
  },
  joinOverlay: {
    position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 4,
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  },
  joinButton: {
    background: '#e01e1e', color: 'white', border: 'none', borderRadius: '10px',
    padding: '14px 26px', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer',
  },
  dropzone: {
    border: '2px dashed #e01e1e', borderRadius: '12px', padding: '40px 50px', textAlign: 'center',
    background: 'rgba(224,30,30,0.05)', cursor: 'pointer',
  },
  dropzoneActive: { background: 'rgba(224,30,30,0.18)' },
  waiting: { textAlign: 'center' },
  uploadOverlay: {
    position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.88)', display: 'flex',
    flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 5,
  },
  progressTrack: { width: '60%', maxWidth: '360px', height: '8px', background: '#262626', borderRadius: '4px', overflow: 'hidden' },
  progressFill: { height: '100%', background: '#e01e1e', transition: 'width 0.2s' },
  cancelButton: { background: '#262626', color: 'white', border: 'none', borderRadius: '8px', padding: '9px 20px', cursor: 'pointer' },
  errorBanner: {
    position: 'absolute', bottom: '70px', left: '50%', transform: 'translateX(-50%)',
    background: '#3a1a1a', color: '#ffb3b3', fontSize: '13px', padding: '10px 14px',
    borderRadius: '8px', maxWidth: '80%', textAlign: 'center', zIndex: 6,
  },
};

export default VideoStage;