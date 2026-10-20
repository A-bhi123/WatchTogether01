import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { getSocket } from '../services/socket';
import VideoStage from '../components/VideoStage';
import ParticipantStrip from '../components/ParticipantStrip';
import ScreenView from '../components/ScreenView';
import { useWebRTC } from '../hooks/useWebRTC';
import { useRoomHealth } from '../hooks/useRoomHealth';
import './Room.css';

// Voice typing: sirf Chrome/Edge mein hoti hai. Hindi bolna ho to 'hi-IN' kar do.
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const VOICE_LANG = 'en-IN';

// Backend ke DELETE_FOR_EVERYONE_HOURS jaisa hi rakho
const DELETE_WINDOW_HOURS = 60;

const EMOJIS = [
  '😀', '😁', '😂', '🤣', '😊', '😍', '🥰', '😘', '😎', '🤩', '🥳', '😇',
  '🙂', '😉', '😋', '😜', '🤔', '😴', '😅', '😆', '😏', '🤗', '🤤', '😬',
  '😢', '😭', '😡', '🥺', '😱', '🤯', '🙄', '🤫', '👍', '👎', '👏', '🙌',
  '🙏', '💪', '👌', '✌️', '🤝', '👋', '❤️', '🧡', '💛', '💚', '💙', '💜',
  '🖤', '💔', '🔥', '✨', '🎉', '🎬', '🍿', '🎥', '⭐', '💯', '✅', '❌',
  '❤️', '🩷', '🧡', '💛', '💚', '💙', '🩵', '💜', '🤎', '🖤', '🩶', '🤍', 
  '💔', '❤️‍🔥', '❤️‍🩹', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', 
  '♥️', '💌', '💋', '💍', '💐', '🌹', '🥀', '🌷', '🌸', '💮', '🪷', '🌺',
  '🌻', '🌼', '💑', '💏', '🫂', '👋', '🤚', '🖐️', '✋', '🖖', '🫱' ,'🫲',
  '🫳', '🫴', '🫷', '🫸' ,'👌', '🤌', '🤏', '✌️', '🤞', '🫰', '🤟', '🤘', 
  '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '🫵', '👍', '👎','✊' ,'🤛', 
  '🤜', '👏', '🙌', '🫶', '👐', '🤲', '🤝', '🙏', '✍️', '💅', '🤳', '💪', 
  '🦾', '🫱🏻‍🫲🏼', '👏🏻', '🙌🏻', '👍🏻', '👎🏻',
];

// Har user ka color uski id se decide hota hai, isliye hamesha same rehta hai
const NAME_COLORS = [
  '#ff7a7a', '#ffb347', '#f7dc6f', '#7bed9f', '#48dbfb', '#74b9ff',
  '#a29bfe', '#fd79a8', '#55efc4', '#fab1a0', '#81ecec', '#e17055',
];
function colorForUser(userId) {
  return NAME_COLORS[Math.abs(Number(userId)) % NAME_COLORS.length];
}

function Room() {
  const { code } = useParams();
  const navigate = useNavigate();
  const { user, markSessionExpired } = useAuth();

  const [room, setRoom] = useState(null);
  const [members, setMembers] = useState([]);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [peoplePanelOpen, setPeoplePanelOpen] = useState(false);
  const [error, setError] = useState('');
  // Chat shuru mein band, pehle cameras dikhte hain (phone aur laptop dono par same)
  const [chatVisible, setChatVisible] = useState(false);
  const [chatEnabled, setChatEnabled] = useState(true); // host ne chat on rakhi hai ya off
  const [unread, setUnread] = useState(0);
  const [copied, setCopied] = useState('');

  const [emojiOpen, setEmojiOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [chatNotice, setChatNotice] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [typingUsers, setTypingUsers] = useState([]);
  const [hiddenIds, setHiddenIds] = useState([]); // "Delete for me" se chhupe messages
  const [undoInfo, setUndoInfo] = useState(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [hostDialog, setHostDialog] = useState(null); // { type: 'kick', member } ya { type: 'end' }
  const [video, setVideo] = useState(null);
  const [roomJoined, setRoomJoined] = useState(false);

  const chatBodyRef = useRef(null);
  const chatInputRef = useRef(null);
  const recognitionRef = useRef(null);
  const pressTimerRef = useRef(null);
  const longPressFiredRef = useRef(false);
  const typingStopTimerRef = useRef(null);
  const lastTypingSentRef = useRef(0);
  const typingExpiryRef = useRef({});
  const pendingHideRef = useRef(null);
  const chatVisibleRef = useRef(chatVisible);

  const selectionMode = selectedIds.length > 0;
  const rtc = useWebRTC(roomJoined);
  const { connStatus, alertMessage, dismissAlert, reconnectCount } = useRoomHealth({
    onAuthFailed: markSessionExpired,
  });

  // Effect 1: room data, purane messages aur movie load karo
  useEffect(() => {
    async function load() {
      try {
        const res = await api.get(`/rooms/${code}`);
        setRoom(res.data.room);
        setMembers(res.data.members);
        setChatEnabled(res.data.room.chatEnabled !== false);

        const msgRes = await api.get(`/rooms/${code}/messages`);
        setMessages(msgRes.data.messages);

        const videoRes = await api.get(`/rooms/${code}/video`);
        setVideo(videoRes.data.video);
      } catch (err) {
        setError(err.response?.data?.error || 'Could not load room');
      }
    }
    load();
    // reconnectCount badhte hi ye effect dobara chalta hai: net band rehne ke dauran chhoote messages wapas aa jate hain
  }, [code, reconnectCount]);

  // Effect 2: socket connection
  useEffect(() => {
    const socket = getSocket();
    socket.connect();

    function handleOnlineUsers(users) {
      setOnlineUsers(users);
      setRoomJoined(true); // server ne room join confirm kar diya
    }
    function handleConnect() {
      socket.emit('room:join', code); // pehli baar bhi aur har reconnect par bhi
    }
    function handleDisconnect() {
      setRoomJoined(false);
    }
    function handleUserJoined(joinedUser) {
      setOnlineUsers((prev) => (prev.some((u) => u.id === joinedUser.id) ? prev : [...prev, joinedUser]));
      // Naya banda member list mein bhi dikhe (pehle refresh karna padta tha)
      setMembers((prev) =>
        prev.some((m) => m.id === joinedUser.id)
          ? prev
          : [...prev, { id: joinedUser.id, name: joinedUser.name, is_host: false }]
      );
    }
    function handleUserLeft(leftUser) {
      setOnlineUsers((prev) => prev.filter((u) => u.id !== leftUser.id));
    }
    function handleRoomError(message) {
      console.error('Socket room error:', message);
    }
    function handleChatError(message) {
      showNotice(message);
    }
    function handleChatMessage(msg) {
      setMessages((prev) => [...prev, msg]);
      // Chat band ho aur doosre ka message aaye to laal dot
      if (!chatVisibleRef.current && msg.user_id !== user.id) setUnread((n) => n + 1);
      // Jisne message bheja, uska "typing..." turant hata do
      clearTimeout(typingExpiryRef.current[msg.user_id]);
      setTypingUsers((prev) => prev.filter((u) => u.id !== msg.user_id));
    }
    function handleChatDeleted({ ids, deletedBy }) {
      setMessages((prev) =>
        prev.map((m) =>
          ids.includes(m.id)
            ? { ...m, is_deleted: true, message: '', deleted_by: deletedBy.id, deleted_by_name: deletedBy.name }
            : m
        )
      );
      setSelectedIds((prev) => prev.filter((id) => !ids.includes(id)));
    }
    function handleChatCleared() {
      setMessages([]);
      setSelectedIds([]);
      setHiddenIds([]);
    }
    function handleTypingUpdate({ id, name, isTyping }) {
      clearTimeout(typingExpiryRef.current[id]);
      if (isTyping) {
        setTypingUsers((prev) => (prev.some((u) => u.id === id) ? prev : [...prev, { id, name }]));
        // Safety: agar "stop" event kho jaye to 5 sec baad khud hat jaye
        typingExpiryRef.current[id] = setTimeout(() => {
          setTypingUsers((prev) => prev.filter((u) => u.id !== id));
        }, 5000);
      } else {
        setTypingUsers((prev) => prev.filter((u) => u.id !== id));
      }
    }
    function handleVideoUpdated(newVideo) {
      setVideo(newVideo);
    }

    // ----- Host ke controls ka asar -----
    function handleChatStatus({ enabled }) {
      setChatEnabled(enabled);
    }
    function handleMemberRemoved({ userId }) {
      setMembers((prev) => prev.filter((m) => m.id !== userId));
    }
    function handleKicked() {
      navigate('/dashboard', { replace: true, state: { notice: 'You were removed from the room by the host.' } });
    }
    function handleClosed() {
      navigate('/dashboard', { replace: true, state: { notice: 'The host ended the room.' } });
    }

    socket.on('room:online-users', handleOnlineUsers);
    socket.on('room:user-joined', handleUserJoined);
    socket.on('room:user-left', handleUserLeft);
    socket.on('room:error', handleRoomError);
    socket.on('chat:error', handleChatError);
    socket.on('chat:message', handleChatMessage);
    socket.on('chat:deleted', handleChatDeleted);
    socket.on('chat:cleared', handleChatCleared);
    socket.on('typing:update', handleTypingUpdate);
    socket.on('video:updated', handleVideoUpdated);
    socket.on('room:chat-status', handleChatStatus);
    socket.on('room:member-removed', handleMemberRemoved);
    socket.on('room:kicked', handleKicked);
    socket.on('room:closed', handleClosed);
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);

    if (socket.connected) handleConnect();

    return () => {
      // Undo wait chal raha ho aur user room chhod de, to pending "Delete for me" bhej do
      const pending = pendingHideRef.current;
      if (pending) {
        clearTimeout(pending.timer);
        socket.emit('chat:delete', { messageIds: pending.ids, scope: 'me' });
        pendingHideRef.current = null;
      }

      socket.off('room:online-users', handleOnlineUsers);
      socket.off('room:user-joined', handleUserJoined);
      socket.off('room:user-left', handleUserLeft);
      socket.off('room:error', handleRoomError);
      socket.off('chat:error', handleChatError);
      socket.off('chat:message', handleChatMessage);
      socket.off('chat:deleted', handleChatDeleted);
      socket.off('chat:cleared', handleChatCleared);
      socket.off('typing:update', handleTypingUpdate);
      socket.off('video:updated', handleVideoUpdated);
      socket.off('room:chat-status', handleChatStatus);
      socket.off('room:member-removed', handleMemberRemoved);
      socket.off('room:kicked', handleKicked);
      socket.off('room:closed', handleClosed);
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.disconnect();
    };
  }, [code]);

  // Effect 3: naya message aane par (ya chat dobara khulne par) sabse neeche scroll karo
  // (display:none se wapas aane par scroll position reset ho jati hai, isliye chatVisible bhi dekhte hain)
  useEffect(() => {
    if (chatBodyRef.current) {
      chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
    }
  }, [messages, chatVisible]);

  // Effect 3b: "typing..." aane par neeche tabhi scroll karo jab tum pehle se neeche ho
  useEffect(() => {
    const el = chatBodyRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [typingUsers]);

  // Effect 3c: chat khulte hi unread dot hata do
  useEffect(() => {
    chatVisibleRef.current = chatVisible;
    if (chatVisible) setUnread(0);
  }, [chatVisible]);

  // Effect 4: page chhodte waqt mic aur timers band karo
  useEffect(() => {
    const expiryTimers = typingExpiryRef.current;
    return () => {
      recognitionRef.current?.stop();
      clearTimeout(pressTimerRef.current);
      clearTimeout(typingStopTimerRef.current);
      Object.values(expiryTimers).forEach(clearTimeout);
    };
  }, []);

  function isOnline(memberId) {
    return onlineUsers.some((u) => u.id === memberId);
  }

  function showNotice(text) {
    setChatNotice(text);
    setTimeout(() => setChatNotice(''), 4000);
  }

  // ---------- Host ke actions (sab server par dobara check hote hain) ----------
  function hostSetChat(enabled) {
    getSocket().emit('host:set-chat', { enabled });
  }
  function hostMute(userId) {
    getSocket().emit('host:mute', { userId });
  }
  function hostMuteAll() {
    getSocket().emit('host:mute', { all: true });
  }
  function confirmHostDialog() {
    if (!hostDialog) return;
    if (hostDialog.type === 'kick') getSocket().emit('host:kick', { userId: hostDialog.member.id });
    if (hostDialog.type === 'end') getSocket().emit('host:end-room');
    setHostDialog(null);
  }

  // Typing: shuru hone par har 2 sec mein ek baar bhejo, ruk jane par 2.5 sec baad "stop"
  function notifyTyping() {
    const now = Date.now();
    if (now - lastTypingSentRef.current > 2000) {
      getSocket().emit('typing:start');
      lastTypingSentRef.current = now;
    }
    clearTimeout(typingStopTimerRef.current);
    typingStopTimerRef.current = setTimeout(() => {
      getSocket().emit('typing:stop');
      lastTypingSentRef.current = 0;
    }, 2500);
  }

  function stopTyping() {
    clearTimeout(typingStopTimerRef.current);
    if (lastTypingSentRef.current !== 0) {
      getSocket().emit('typing:stop');
      lastTypingSentRef.current = 0;
    }
  }

  function handleChatInputChange(e) {
    const value = e.target.value;
    setChatInput(value);
    if (value.trim()) notifyTyping();
    else stopTyping();
  }

  function handleSendMessage(e) {
    e.preventDefault();
    if (!chatEnabled && !room?.isHost) return; // UI mein bhi roko (asli rok server karta hai)
    const text = chatInput.trim();
    if (!text) return;
    getSocket().emit('chat:send', { message: text });
    stopTyping();
    setChatInput('');
    setEmojiOpen(false);
  }

  function addEmoji(emoji) {
    setChatInput((prev) => prev + emoji);
    notifyTyping();
    chatInputRef.current?.focus();
  }

  function toggleVoice() {
    if (!SpeechRecognition) {
      showNotice('Voice typing is not supported in this browser. Please use Chrome or Edge.');
      return;
    }
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = VOICE_LANG;
    recognition.interimResults = true;
    recognition.continuous = false;

    const textBefore = chatInput; // bolne se pehle jo likha tha

    recognition.onresult = (event) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setChatInput((textBefore ? textBefore + ' ' : '') + transcript);
      notifyTyping();
    };
    recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        showNotice('Microphone permission denied. Allow it in the browser address bar.');
      } else if (event.error === 'no-speech') {
        showNotice('No speech detected. Try again.');
      } else if (event.error === 'network') {
        showNotice('Voice typing needs an internet connection.');
      } else {
        showNotice('Voice typing failed. Please try again.');
      }
    };
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }

  // Long-press: koi bhi message select ho sakta hai (delete for me ke liye)
  function startPress(msg) {
    longPressFiredRef.current = false;
    pressTimerRef.current = setTimeout(() => {
      longPressFiredRef.current = true;
      setSelectedIds((prev) => (prev.includes(msg.id) ? prev : [...prev, msg.id]));
    }, 500);
  }
  function cancelPress() {
    clearTimeout(pressTimerRef.current);
  }

  // Selection mode mein simple tap = select / unselect
  function handleBubbleClick(msg) {
    // Long-press chhodne par jo "click" aata hai use ignore karo, warna turant unselect ho jayega
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false;
      return;
    }
    if (!selectionMode) return;
    setSelectedIds((prev) => (prev.includes(msg.id) ? prev.filter((id) => id !== msg.id) : [...prev, msg.id]));
  }

  // Delete for everyone: host ko koi bhi message, baaki sirf apna aur 60 ghante ke andar
  function canDeleteForEveryone(msg) {
    if (msg.is_deleted) return false;
    if (room?.isHost) return true;
    const ageHours = (Date.now() - new Date(msg.created_at).getTime()) / 3600000;
    return msg.user_id === user.id && ageHours < DELETE_WINDOW_HOURS;
  }

  function deletedLabel(msg) {
    if (msg.deleted_by && msg.deleted_by === user.id) return '🚫 You deleted this message';
    if (msg.deleted_by && msg.deleted_by !== msg.user_id) {
      return `🚫 Deleted by host (${msg.deleted_by_name || 'host'})`;
    }
    return msg.user_id === user.id ? '🚫 You deleted this message' : '🚫 This message was deleted';
  }

  // "Delete for me" ka Undo wait: pehle wala pending ho to turant bhej do
  function flushPendingHide() {
    const pending = pendingHideRef.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    getSocket().emit('chat:delete', { messageIds: pending.ids, scope: 'me' });
    pendingHideRef.current = null;
    setUndoInfo(null);
  }

  function deleteForMe(ids) {
    flushPendingHide();
    setHiddenIds((prev) => [...prev, ...ids]); // screen se turant hatao
    const timer = setTimeout(() => {
      getSocket().emit('chat:delete', { messageIds: ids, scope: 'me' });
      pendingHideRef.current = null;
      setUndoInfo(null);
    }, 5000);
    pendingHideRef.current = { ids, timer };
    setUndoInfo({ count: ids.length });
  }

  function undoDeleteForMe() {
    const pending = pendingHideRef.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    setHiddenIds((prev) => prev.filter((id) => !pending.ids.includes(id)));
    pendingHideRef.current = null;
    setUndoInfo(null);
  }

  function confirmDelete(scope) {
    const ids = [...selectedIds];
    setDeleteDialogOpen(false);
    setSelectedIds([]);
    if (scope === 'everyone') {
      getSocket().emit('chat:delete', { messageIds: ids, scope: 'everyone' });
    } else {
      deleteForMe(ids);
    }
  }

  function confirmClearChat() {
    setClearDialogOpen(false);
    getSocket().emit('chat:clear');
  }

  function copyToClipboard(text, label) {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(''), 1500);
  }

  if (error) {
    return (
      <div style={styles.centerPage}>
        <p style={{ color: '#ff6b6b', marginBottom: '16px' }}>{error}</p>
        <button onClick={() => navigate('/dashboard')} style={styles.backButton}>Back to Dashboard</button>
      </div>
    );
  }

  if (!room) {
    return <div style={styles.centerPage}><p style={{ color: 'white' }}>Loading room...</p></div>;
  }

  const inviteLink = `${window.location.origin}/join/${room.code}`;
  const visibleMessages = messages.filter((m) => !hiddenIds.includes(m.id));
  const selectedMessages = messages.filter((m) => selectedIds.includes(m.id));
  const everyoneAllowed = selectedMessages.length > 0 && selectedMessages.every(canDeleteForEveryone);
  const showUnreadDot = unread > 0 && !chatVisible;
  // Chat band hai aur main host nahi hoon: input band
  const chatLocked = !chatEnabled && !room.isHost;

  return (
    <div className={`room${chatVisible ? ' room--chat-open' : ''}`}>
            {connStatus !== 'ok' && (
        <div className={`conn-banner conn-banner--${connStatus}`}>
          {connStatus === 'offline' && "📡 You're offline. Waiting for your internet connection..."}
          {connStatus === 'reconnecting' && '🔄 Connection lost. Reconnecting...'}
          {connStatus === 'restored' && '✅ Back online'}
        </div>
      )}

      {alertMessage && (
        <div className="alert-banner">
          <span>⚠ {alertMessage}</span>
          <button onClick={dismissAlert}>✕</button>
        </div>
      )}
      {/* ---------- Header ---------- */}
      <div className="room-header">
        <div className="room-header-left">
          <button className="hdr-btn" onClick={() => navigate('/dashboard')} style={styles.leaveLink} aria-label="Leave">
            ←<span className="label"> Leave</span>
          </button>
          <span className="room-logo">▦</span>
          <span className="room-name">{room.name}</span>
          {room.isHost && <span style={styles.hostBadge}>👑<span className="label"> Host</span></span>}
        </div>

        <div className="room-header-right">
          <button className="hdr-btn" style={styles.codeBox} onClick={() => copyToClipboard(room.code, 'code')}>
            📋 {room.code}{copied === 'code' ? ' ✓' : ''}
          </button>
          <button className="hdr-btn" style={styles.inviteButton} onClick={() => copyToClipboard(inviteLink, 'link')} aria-label="Invite">
            🔗{copied === 'link' ? ' ✓' : ''}<span className="label">{copied === 'link' ? ' Link copied!' : ' Invite'}</span>
          </button>

          <div style={{ position: 'relative' }}>
            <button className="hdr-btn" style={styles.peopleCount} onClick={() => setPeoplePanelOpen(!peoplePanelOpen)} aria-label="People">
              👥 <span className="label">People </span>{onlineUsers.length}
            </button>

            {peoplePanelOpen && (
              <div style={styles.peopleDropdown}>
                <div style={styles.peoplePanelHeader}>
                  <strong style={{ color: 'white' }}>People ({members.length})</strong>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {room.isHost && (
                      <button style={styles.smallAction} onClick={hostMuteAll} title="Mute everyone">🔇 All</button>
                    )}
                    <button style={styles.closeButton} onClick={() => setPeoplePanelOpen(false)}>✕</button>
                  </div>
                </div>

                <div style={styles.peopleList}>
                  {members.map((member) => (
                    <div key={member.id} style={styles.peopleItem}>
                      <span style={{ ...styles.statusDot, background: isOnline(member.id) ? '#4caf50' : '#555' }} />
                      <span style={{ color: 'white', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {member.name}
                      </span>
                      {member.is_host && <span style={styles.hostTag}>👑 Host</span>}

                      {/* Host ko, host ke alawa har member ke saamne mute aur remove */}
                      {room.isHost && !member.is_host && (
                        <>
                          <button
                            style={{ ...styles.iconAction, opacity: isOnline(member.id) ? 1 : 0.4 }}
                            onClick={() => hostMute(member.id)}
                            disabled={!isOnline(member.id)}
                            title="Mute"
                          >
                            🔇
                          </button>
                          <button
                            style={styles.iconAction}
                            onClick={() => setHostDialog({ type: 'kick', member })}
                            title="Remove from room"
                          >
                            ✕
                          </button>
                        </>
                      )}
                    </div>
                  ))}
                </div>

                {room.isHost && (
                  <div style={styles.peopleFooter}>
                    <button style={styles.endRoomButton} onClick={() => setHostDialog({ type: 'end' })}>
                      🛑 End room for everyone
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <button
            className="hdr-btn has-dot"
            style={styles.chatToggle}
            onClick={() => setChatVisible(!chatVisible)}
            aria-label="Toggle chat"
          >
            💬<span className="label"> Chat</span>
            {showUnreadDot && <span className="unread-dot" />}
          </button>
        </div>
      </div>

      {/* ---------- Main: movie + (cameras ya chat) ---------- */}
      <div className="room-main">
        <div className="room-stage">
          <VideoStage
            roomCode={room.code}
            isHost={room.isHost}
            video={video}
            onVideoChange={setVideo}
            socketReady={roomJoined}
            suspended={rtc.screenSharing || Boolean(rtc.screenPeer)}
            shareOwner={rtc.screenSharing}
          />

          {(rtc.screenSharing || rtc.screenPeer) && (
            <ScreenView mine={rtc.screenSharing} peer={rtc.screenPeer} onStop={rtc.toggleScreen} />
          )}
        </div>

        <ParticipantStrip
          isHost={room.isHost}
          localStream={rtc.localStream}
          cameraOn={rtc.cameraOn}
          micOn={rtc.micOn}
          selfSpeaking={rtc.selfSpeaking}
          screenSharing={rtc.screenSharing}
          peers={rtc.peers}
          members={members}
        />

        <div className="room-chat">
          {selectionMode ? (
            <div style={styles.selectionBar}>
              <button style={styles.closeButton} onClick={() => setSelectedIds([])}>✕</button>
              <span style={{ color: 'white', flex: 1, fontSize: '14px' }}>{selectedIds.length} selected</span>
              <button style={styles.deleteButton} onClick={() => setDeleteDialogOpen(true)}>🗑 Delete</button>
            </div>
          ) : (
            <div style={styles.chatHeader}>
              <strong style={{ color: 'white' }}>Live Chat</strong>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button style={styles.clearButton} onClick={() => setClearDialogOpen(true)} title="Clear chat">🧹 Clear</button>
                <span style={chatEnabled ? styles.badgeOn : styles.badgeOff}>
                  {chatEnabled ? 'Active' : 'Disabled'}
                </span>
              </div>
            </div>
          )}

          <div style={styles.chatBody} ref={chatBodyRef}>
            {visibleMessages.length === 0 && typingUsers.length === 0 && (
              <p style={{ color: '#555', textAlign: 'center', marginTop: '40px' }}>No messages yet — say hello!</p>
            )}

            {visibleMessages.map((msg, index) => {
              const isOwn = msg.user_id === user.id;
              const prev = visibleMessages[index - 1];
              const sameSenderAsPrev = prev && prev.user_id === msg.user_id;
              const showName = !isOwn && !sameSenderAsPrev;

              return (
                <div
                  key={msg.id}
                  style={{
                    ...styles.messageRow,
                    justifyContent: isOwn ? 'flex-end' : 'flex-start',
                    marginTop: sameSenderAsPrev ? '3px' : '10px',
                  }}
                >
                  <div
                    style={{
                      ...styles.bubble,
                      ...(isOwn ? styles.bubbleOwn : styles.bubbleOther),
                      ...(msg.is_deleted ? styles.bubbleDeleted : {}),
                      ...(selectedIds.includes(msg.id) ? styles.bubbleSelected : {}),
                    }}
                    onPointerDown={() => startPress(msg)}
                    onPointerUp={cancelPress}
                    onPointerLeave={cancelPress}
                    onPointerCancel={cancelPress}
                    onClick={() => handleBubbleClick(msg)}
                    onContextMenu={(e) => e.preventDefault()}
                  >
                    {showName && (
                      <div style={{ ...styles.senderName, color: colorForUser(msg.user_id) }}>
                        {msg.user_name}
                      </div>
                    )}
                    {msg.is_deleted ? (
                      <span style={styles.deletedText}>{deletedLabel(msg)}</span>
                    ) : (
                      <span style={styles.messageText}>{msg.message}</span>
                    )}
                    <span style={styles.messageTime}>
                      {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              );
            })}

            {typingUsers.map((typer) => (
              <div key={`typing-${typer.id}`} style={{ ...styles.messageRow, justifyContent: 'flex-start', marginTop: '10px' }}>
                <div style={{ ...styles.bubble, ...styles.bubbleOther }}>
                  <div style={{ ...styles.senderName, color: colorForUser(typer.id) }}>{typer.name}</div>
                  <span style={styles.typingText}>typing...</span>
                </div>
              </div>
            ))}
          </div>

          {undoInfo && (
            <div style={styles.undoBar}>
              <span>{undoInfo.count} message{undoInfo.count > 1 ? 's' : ''} deleted for you</span>
              <button style={styles.undoButton} onClick={undoDeleteForMe}>Undo</button>
            </div>
          )}

          {!chatEnabled && room.isHost && (
            <div style={styles.hostHint}>Chat is disabled for members. You can still send messages.</div>
          )}

          {chatNotice && <div style={styles.chatNotice}>{chatNotice}</div>}

          <form style={styles.chatInputRow} onSubmit={handleSendMessage}>
            {emojiOpen && !chatLocked && (
              <div style={styles.emojiPicker}>
                {EMOJIS.map((emoji) => (
                  <button key={emoji} type="button" style={styles.emojiButton} onClick={() => addEmoji(emoji)}>
                    {emoji}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              style={styles.iconButton}
              onClick={() => setEmojiOpen(!emojiOpen)}
              disabled={chatLocked}
              title="Emoji"
            >
              😊
            </button>
            <input
              ref={chatInputRef}
              style={styles.chatInput}
              placeholder={
                chatLocked ? 'Chat is disabled by the host' : listening ? 'Listening... speak now' : 'Say something...'
              }
              value={chatInput}
              onChange={handleChatInputChange}
              maxLength={1000}
              disabled={chatLocked}
            />
            <button
              type="button"
              style={{ ...styles.iconButton, ...(listening ? styles.iconButtonActive : {}) }}
              onClick={toggleVoice}
              disabled={chatLocked}
              title="Voice typing"
            >
              🎤
            </button>
            <button type="submit" style={styles.chatSendButton} disabled={chatLocked}>➤</button>
          </form>
        </div>
      </div>

      {/* Camera/mic ka error (chat khuli ho tab bhi dikhe) */}
      {rtc.mediaError && (
        <div className="room-banner">
          <span>⚠ {rtc.mediaError}</span>
          <button onClick={rtc.dismissError}>✕</button>
        </div>
      )}

      {/* Browser ne doosron ki awaaz roki ho to */}
      {rtc.audioBlocked && (
        <div className="room-banner room-banner--info" style={{ bottom: rtc.mediaError ? '120px' : '70px' }}>
          <span>🔊 Your browser is blocking sound</span>
          <button onClick={rtc.unlockAudio}>Enable sound</button>
        </div>
      )}

      {/* ---------- Neeche ke controls ---------- */}
      <div className="room-controls">
        <button
          className="ctrl-btn"
          style={{ ...styles.controlButton, ...(rtc.micOn ? styles.controlButtonOn : {}) }}
          onClick={rtc.toggleMic}
          aria-label={rtc.micOn ? 'Mute microphone' : 'Unmute microphone'}
        >
          {rtc.micOn ? '🎤' : '🔇'}<span className="label"> {rtc.micOn ? 'Mute' : 'Unmute'}</span>
        </button>
        
        <button
          className="ctrl-btn"
          style={{ ...styles.controlButton, ...(rtc.cameraOn ? styles.controlButtonOn : {}) }}
          onClick={rtc.toggleCamera}
          aria-label="Camera"
        >
          📷<span className="label"> {rtc.cameraOn ? 'Hide cam' : 'Show cam'}</span>
        </button>

        <button
          className="ctrl-btn"
          style={{ ...styles.controlButton, ...(rtc.screenSharing ? styles.controlButtonOn : {}) }}
          onClick={rtc.toggleScreen}
          disabled={!rtc.canShareScreen || (Boolean(rtc.screenPeer) && !rtc.screenSharing)}
          title={
            !rtc.canShareScreen
              ? 'Screen sharing is not supported on this device'
              : rtc.screenPeer && !rtc.screenSharing
                ? `${rtc.screenPeer.name} is sharing their screen`
                : 'Share your screen'
          }
          aria-label="Screen share"
        >
          🖥<span className="label"> {rtc.screenSharing ? 'Stop share' : 'Screen share'}</span>
        </button>

        <button
          className="ctrl-btn has-dot"
          style={styles.controlButton}
          onClick={() => setChatVisible(!chatVisible)}
          aria-label="Toggle chat"
        >
          💬<span className="label"> {chatVisible ? 'Hide chat' : 'Show chat'}</span>
          {showUnreadDot && <span className="unread-dot" />}
        </button>

        {/* Sirf host ko: chat on/off */}
        {room.isHost && (
          <button
            className="ctrl-btn"
            style={{ ...styles.controlButton, ...(chatEnabled ? styles.controlButtonGreen : styles.controlButtonRed) }}
            onClick={() => hostSetChat(!chatEnabled)}
            aria-label={chatEnabled ? 'Disable chat for members' : 'Enable chat for members'}
          >
            {chatEnabled ? '🔇' : '💬'}<span className="label"> {chatEnabled ? 'Disable chat' : 'Enable chat'}</span>
          </button>
        )}

        <button className="ctrl-btn" style={styles.leaveButton} onClick={() => navigate('/dashboard')} aria-label="Leave">
          ✂<span className="label"> Leave</span>
        </button>
      </div>
      
      {deleteDialogOpen && (
        <div style={styles.dialogOverlay} onClick={() => setDeleteDialogOpen(false)}>
          <div style={styles.dialog} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.dialogTitle}>
              Delete {selectedIds.length} message{selectedIds.length > 1 ? 's' : ''}?
            </h3>
            {!everyoneAllowed && (
              <p style={styles.dialogHint}>
                {room.isHost
                  ? 'Delete for everyone is not available for already deleted messages.'
                  : `Delete for everyone works only for your own messages from the last ${DELETE_WINDOW_HOURS} hours.`}
              </p>
            )}
            <div style={styles.dialogButtons}>
              {everyoneAllowed && (
                <button style={{ ...styles.dialogButton, ...styles.dialogDanger }} onClick={() => confirmDelete('everyone')}>
                  Delete for everyone
                </button>
              )}
              <button style={styles.dialogButton} onClick={() => confirmDelete('me')}>Delete for me</button>
              <button style={styles.dialogButton} onClick={() => setDeleteDialogOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {clearDialogOpen && (
        <div style={styles.dialogOverlay} onClick={() => setClearDialogOpen(false)}>
          <div style={styles.dialog} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.dialogTitle}>Clear this chat?</h3>
            <p style={styles.dialogHint}>All messages will be cleared for you only. Other members will still see them.</p>
            <div style={styles.dialogButtons}>
              <button style={{ ...styles.dialogButton, ...styles.dialogDanger }} onClick={confirmClearChat}>Clear chat</button>
              <button style={styles.dialogButton} onClick={() => setClearDialogOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {hostDialog && (
        <div style={styles.dialogOverlay} onClick={() => setHostDialog(null)}>
          <div style={styles.dialog} onClick={(e) => e.stopPropagation()}>
            {hostDialog.type === 'kick' ? (
              <>
                <h3 style={styles.dialogTitle}>Remove {hostDialog.member.name}?</h3>
                <p style={styles.dialogHint}>
                  They will be removed from the room and will not be able to join again with the code or the invite link.
                </p>
              </>
            ) : (
              <>
                <h3 style={styles.dialogTitle}>End this room for everyone?</h3>
                <p style={styles.dialogHint}>
                  Everyone will be sent back to the dashboard and nobody can join this room again. This cannot be undone.
                </p>
              </>
            )}
            <div style={styles.dialogButtons}>
              <button style={{ ...styles.dialogButton, ...styles.dialogDanger }} onClick={confirmHostDialog}>
                {hostDialog.type === 'kick' ? 'Remove from room' : 'End room'}
              </button>
              <button style={styles.dialogButton} onClick={() => setHostDialog(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Layout (sizes, grid, media queries) Room.css mein hai. Yahan sirf rang-roop.
const styles = {
  centerPage: { background: '#0a0a0a', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' },
  backButton: { padding: '10px 20px', background: '#e01e1e', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer' },

  leaveLink: { background: 'none', border: 'none', color: '#ccc', cursor: 'pointer', fontSize: '15px' },
  hostBadge: { background: '#3a2a0a', color: '#e8a24c', fontSize: '12px', padding: '3px 8px', borderRadius: '6px', whiteSpace: 'nowrap' },
  codeBox: { background: '#1a1a1a', color: '#ccc', border: '1px solid #333', borderRadius: '6px', padding: '6px 10px', cursor: 'pointer', fontSize: '13px' },
  inviteButton: { background: 'none', border: '1px solid #e01e1e', color: '#e01e1e', borderRadius: '6px', padding: '6px 10px', cursor: 'pointer', fontSize: '13px' },
  peopleCount: { color: '#ccc', fontSize: '13px', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: '6px' },
  chatToggle: { background: '#e01e1e', color: 'white', border: 'none', borderRadius: '6px', padding: '6px 10px', cursor: 'pointer', fontSize: '13px' },

  peopleDropdown: {
    position: 'absolute', top: 'calc(100% + 8px)', right: 0, width: '290px',
    background: '#141414', border: '1px solid #222', borderRadius: '10px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)', zIndex: 20, overflow: 'hidden',
  },
  peoplePanelHeader: { padding: '12px 14px', borderBottom: '1px solid #222', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  closeButton: { background: 'none', border: 'none', color: '#999', cursor: 'pointer', fontSize: '15px' },
  peopleList: { padding: '10px', display: 'flex', flexDirection: 'column', gap: '6px', overflowY: 'auto', maxHeight: '50vh' },
  peopleItem: { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', borderRadius: '8px', background: '#141414' },
  statusDot: { width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0 },
  hostTag: { fontSize: '11px', color: '#e8a24c', background: '#3a2a0a', padding: '2px 7px', borderRadius: '6px', whiteSpace: 'nowrap' },
  smallAction: { background: '#262626', color: '#ddd', border: 'none', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', fontSize: '12px' },
  iconAction: { background: '#262626', color: '#ddd', border: 'none', borderRadius: '6px', width: '28px', height: '28px', cursor: 'pointer', fontSize: '12px', flexShrink: 0 },
  peopleFooter: { padding: '10px', borderTop: '1px solid #222' },
  endRoomButton: { width: '100%', background: '#3a1a1a', color: '#ff9b9b', border: '1px solid #5a2a2a', borderRadius: '8px', padding: '9px', cursor: 'pointer', fontSize: '13px' },

  chatHeader: { padding: '12px 14px', borderBottom: '1px solid #222', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 },
  selectionBar: { padding: '10px 14px', borderBottom: '1px solid #222', display: 'flex', alignItems: 'center', gap: '10px', background: '#1a1a1a', flexShrink: 0 },
  deleteButton: { background: '#e01e1e', color: 'white', border: 'none', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer', fontSize: '13px' },
  clearButton: { background: 'none', border: '1px solid #333', color: '#bbb', borderRadius: '6px', padding: '3px 8px', cursor: 'pointer', fontSize: '12px' },
  badgeOn: { fontSize: '11px', background: '#1a3a1a', color: '#6bff8f', padding: '2px 8px', borderRadius: '10px' },
  badgeOff: { fontSize: '11px', background: '#3a1a1a', color: '#ff9b9b', padding: '2px 8px', borderRadius: '10px' },

  chatBody: { flex: 1, minHeight: 0, padding: '10px 12px', overflowY: 'auto' },
  messageRow: { display: 'flex' },
  bubble: {
    maxWidth: '80%', padding: '7px 10px 5px', borderRadius: '12px',
    display: 'flex', flexDirection: 'column', userSelect: 'none', WebkitTouchCallout: 'none',
    border: '2px solid transparent',
  },
  bubbleOwn: { background: '#6b1717', borderBottomRightRadius: '3px' },
  bubbleOther: { background: '#262626', borderBottomLeftRadius: '3px' },
  bubbleDeleted: { background: 'transparent', border: '1px dashed #333' },
  bubbleSelected: { border: '2px solid #e01e1e' },
  senderName: { fontSize: '12px', fontWeight: 'bold', marginBottom: '2px' },
  messageText: { color: 'white', fontSize: '14px', wordBreak: 'break-word', whiteSpace: 'pre-wrap' },
  deletedText: { color: '#777', fontSize: '13px', fontStyle: 'italic' },
  messageTime: { color: '#999', fontSize: '10px', alignSelf: 'flex-end', marginTop: '2px' },
  typingText: { color: '#4caf50', fontSize: '13px', fontStyle: 'italic' },

  undoBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#1f1f1f', color: '#ddd', fontSize: '13px', padding: '8px 12px', borderTop: '1px solid #222', flexShrink: 0 },
  undoButton: { background: 'none', border: 'none', color: '#e01e1e', fontWeight: 'bold', cursor: 'pointer', fontSize: '13px' },
  hostHint: { background: '#2a2410', color: '#e8c36b', fontSize: '12px', padding: '7px 12px', borderTop: '1px solid #222', flexShrink: 0 },
  chatNotice: { background: '#3a1a1a', color: '#ffb3b3', fontSize: '12px', padding: '8px 12px', borderTop: '1px solid #222', flexShrink: 0 },
  chatInputRow: { display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 12px', borderTop: '1px solid #222', position: 'relative', flexShrink: 0 },
  // font-size 16px: iPhone par isse chhota ho to input par tap karte hi page zoom ho jata hai
  chatInput: { flex: 1, minWidth: 0, padding: '10px', background: '#1a1a1a', border: '1px solid #333', borderRadius: '8px', color: 'white', fontSize: '16px' },
  chatSendButton: { background: '#e01e1e', color: 'white', border: 'none', borderRadius: '8px', padding: '10px 14px', cursor: 'pointer' },
  iconButton: { background: '#1a1a1a', border: '1px solid #333', borderRadius: '8px', padding: '8px 10px', cursor: 'pointer', fontSize: '16px' },
  iconButtonActive: { background: '#e01e1e', border: '1px solid #e01e1e' },
  emojiPicker: {
    position: 'absolute', bottom: 'calc(100% + 6px)', left: '12px', right: '12px',
    background: '#141414', border: '1px solid #222', borderRadius: '10px', padding: '8px',
    display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: '2px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.5)', zIndex: 10, maxHeight: '200px', overflowY: 'auto',
  },
  emojiButton: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px', padding: '4px', borderRadius: '6px' },

  controlButton: { background: '#1a1a1a', color: 'white' },
  controlButtonOn: { border: '1px solid #e01e1e', background: '#2a1212' },
  controlButtonGreen: { background: '#0f2a18', border: '1px solid #1f6b3a', color: '#6bff8f' },
  controlButtonRed: { background: '#2a1212', border: '1px solid #6b1f1f', color: '#ff9b9b' },
  leaveButton: { background: '#e01e1e', color: 'white' },

  dialogOverlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  dialog: { background: '#1a1a1a', borderRadius: '12px', padding: '22px', width: '340px', maxWidth: '90vw' },
  dialogTitle: { color: 'white', margin: '0 0 10px', fontSize: '17px' },
  dialogHint: { color: '#999', fontSize: '13px', margin: '0 0 14px' },
  dialogButtons: { display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' },
  dialogButton: { background: '#262626', color: 'white', border: 'none', borderRadius: '8px', padding: '11px', cursor: 'pointer', fontSize: '14px' },
  dialogDanger: { background: '#e01e1e', fontWeight: 'bold' },
};

export default Room;