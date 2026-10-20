import { useCallback, useEffect, useRef, useState } from 'react';
import { getSocket } from '../services/socket';
import { PeerManager } from '../services/peerManager';

function describeScreenError(err) {
  if (err?.name === 'ScreenBusyError') {
    return `${err.sharerName} is already sharing their screen.`;
  }
  if (!navigator.mediaDevices?.getDisplayMedia) {
    return 'Screen sharing is not supported on this device. Please use a laptop or desktop browser.';
  }
  switch (err?.name) {
    case 'NotAllowedError':
      return 'Screen sharing was cancelled or blocked.';
    case 'NotFoundError':
      return 'No screen or window found to share.';
    case 'NotReadableError':
    case 'AbortError':
      return 'Could not capture the screen. Close other screen-capture apps and try again.';
    default:
      return 'Could not start screen sharing. Please try again.';
  }
}

function describeMediaError(err, device) {
  if (device === 'screen') return describeScreenError(err);

  const label = device === 'mic' ? 'Microphone' : 'Camera';
  const lower = label.toLowerCase();

  if (!navigator.mediaDevices?.getUserMedia) {
    return `${label} needs a secure page (https or localhost).`;
  }
  switch (err?.name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return `${label} permission denied. Click the lock icon in the address bar and allow the ${lower}.`;
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return `No ${lower} found on this device.`;
    case 'NotReadableError':
    case 'TrackStartError':
      return `Your ${lower} is being used by another app or browser. Close it and try again.`;
    case 'OverconstrainedError':
      return `Your ${lower} does not support the requested settings.`;
    case 'SecurityError':
      return `${label} is blocked on this page. Use https or localhost.`;
    default:
      return `Could not start the ${lower}. Please try again.`;
  }
}

// Har device ke liye: abhi on hai ya nahi, shuru kaise karein, band kaise karein
const DEVICES = {
  camera: { isOn: (s) => s.cameraOn, start: (m) => m.startCamera(), stop: (m) => m.stopCamera() },
  mic: { isOn: (s) => s.micOn, start: (m) => m.startMic(), stop: (m) => m.stopMic() },
  screen: { isOn: (s) => s.screenSharing, start: (m) => m.startScreen(), stop: (m) => m.stopScreen() },
};

export function useWebRTC(socketReady) {
  const managerRef = useRef(null);
  const busyRef = useRef({ camera: false, mic: false, screen: false });
  const [state, setState] = useState({
    cameraOn: false,
    micOn: false,
    screenSharing: false,
    selfSpeaking: false,
    audioBlocked: false,
    localStream: null,
    peers: [],
  });
  const [mediaError, setMediaError] = useState('');

  // Manager ek baar banta hai, Room band hote hi camera, mic, screen aur connections band
  useEffect(() => {
    const manager = new PeerManager(
      getSocket(),
      () => setState(manager.getState()),
      (message) => setMediaError(message)
    );
    managerRef.current = manager;
    manager.start();
    return () => {
      manager.stop();
      managerRef.current = null;
    };
  }, []);

  // Room join hua ya socket toota
  useEffect(() => {
    const manager = managerRef.current;
    if (!manager) return;
    if (socketReady) manager.onRoomJoined();
    else manager.reset();
  }, [socketReady]);

  const toggleDevice = useCallback(async (device) => {
    const manager = managerRef.current;
    if (!manager || busyRef.current[device]) return;

    busyRef.current[device] = true;
    setMediaError('');
    try {
      const { isOn, start, stop } = DEVICES[device];
      if (isOn(manager.getState())) stop(manager);
      else await start(manager);
    } catch (err) {
      setMediaError(describeMediaError(err, device));
    } finally {
      busyRef.current[device] = false;
    }
  }, []);

  const toggleCamera = useCallback(() => toggleDevice('camera'), [toggleDevice]);
  const toggleMic = useCallback(() => toggleDevice('mic'), [toggleDevice]);
  const toggleScreen = useCallback(() => toggleDevice('screen'), [toggleDevice]);
  const unlockAudio = useCallback(() => managerRef.current?.unlockAudio(), []);
  const dismissError = useCallback(() => setMediaError(''), []);

  // Room mein kaun screen share kar raha hai (koi aur)
  const screenPeer = state.peers.find((p) => p.media.screen) || null;

  return {
    ...state,
    screenPeer,
    canShareScreen: PeerManager.canShareScreen(),
    mediaError,
    toggleCamera,
    toggleMic,
    toggleScreen,
    unlockAudio,
    dismissError,
  };
}