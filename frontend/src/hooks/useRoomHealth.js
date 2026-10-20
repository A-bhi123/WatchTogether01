import { useCallback, useEffect, useRef, useState } from 'react';
import { getSocket } from '../services/socket';

// Server socket par ye error dekar connection mana karta hai jab login cookie kharab ya expire ho
const AUTH_ERRORS = ['Not authenticated', 'Invalid session', 'User no longer exists'];

// Room ki "sehat": internet, server se connection, aur server ke bheje room errors
export function useRoomHealth({ onAuthFailed }) {
  const [connStatus, setConnStatus] = useState('ok'); // 'ok' | 'offline' | 'reconnecting' | 'restored'
  const [alertMessage, setAlertMessage] = useState('');
  const [reconnectCount, setReconnectCount] = useState(0);
  const onAuthFailedRef = useRef(onAuthFailed);

  useEffect(() => {
    onAuthFailedRef.current = onAuthFailed;
  });

  useEffect(() => {
    const socket = getSocket();
    let wasDown = false;
    let restoredTimer = null;
    let alertTimer = null;

    function markDown() {
      wasDown = true;
      clearTimeout(restoredTimer);
      setConnStatus(navigator.onLine ? 'reconnecting' : 'offline');
    }

    function handleDisconnect(reason) {
      if (reason === 'io client disconnect') return; // hamne khud band kiya (Room chhodte waqt)
      if (reason === 'io server disconnect') {
        // Server ne khud nikala (jaise room se hata diya gaya). Kick/end-room ka alag message aata hai
        setAlertMessage('You were disconnected from this room by the server.');
        return;
      }
      markDown();
    }

    function handleConnect() {
      if (!wasDown) return;
      wasDown = false;
      setConnStatus('restored');
      setReconnectCount((n) => n + 1); // Room ko bolo: chhoota hua data dobara laao
      restoredTimer = setTimeout(() => setConnStatus('ok'), 2500);
    }

    function handleConnectError(err) {
      if (AUTH_ERRORS.includes(err?.message)) {
        onAuthFailedRef.current?.(); // login cookie expire: login page par bhejo
        return;
      }
      markDown(); // server band ya net nahi: socket.io khud baar-baar koshish karta rehta hai
    }

    function handleOffline() {
      markDown();
    }

    function handleOnline() {
      if (wasDown) setConnStatus('reconnecting');
      if (!socket.connected) socket.connect(); // net wapas aaya, ab intezaar mat karo
    }

    function handleRoomError(message) {
      setAlertMessage(String(message));
      clearTimeout(alertTimer);
      alertTimer = setTimeout(() => setAlertMessage(''), 6000);
    }

    socket.on('disconnect', handleDisconnect);
    socket.on('connect', handleConnect);
    socket.on('connect_error', handleConnectError);
    socket.on('room:error', handleRoomError);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    return () => {
      clearTimeout(restoredTimer);
      clearTimeout(alertTimer);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect', handleConnect);
      socket.off('connect_error', handleConnectError);
      socket.off('room:error', handleRoomError);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  const dismissAlert = useCallback(() => setAlertMessage(''), []);

  return { connStatus, alertMessage, dismissAlert, reconnectCount };
}