import { ICE_SERVERS } from '../config/rtc';
import { createSpeakingDetector, resumeAudioContext } from './speakingDetector';

function emptyMedia() {
  return { camera: false, mic: false, screen: false, screenStreamId: null };
}

export class PeerManager {
  // Phone ke browsers mein getDisplayMedia hota hi nahi
  static canShareScreen() {
    return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getDisplayMedia);
  }

  constructor(socket, onChange, onError) {
    this.socket = socket;
    this.onChange = onChange; // kuch badle to React ko batao
    this.onError = onError; // server ne kuch mana kiya to user ko batao
    this.peers = new Map(); // socketId -> peer ki saari info + RTCPeerConnection

    // Camera aur mic ke tracks isi ek stream mein rehte hain
    this.localStream = new MediaStream();
    this.cameraTrack = null;
    this.micTrack = null;

    // Screen share ki apni alag stream. Id sthayi rehti hai, isliye doosri taraf pehchan ho jati hai
    this.screenStream = new MediaStream();
    this.screenVideoTrack = null;
    this.screenAudioTrack = null;

    this.starting = { camera: false, mic: false, screen: false };

    this.selfSpeaking = false;
    this.selfDetector = null;

    this.audioBlocked = false; // browser ne doosron ki awaaz chalane se roka hai
    this.unlockHandler = () => this.unlockAudio();

    this.disposed = false;
  }

  notify() {
    if (!this.disposed) this.onChange();
  }

  start() {
    this.socket.on('rtc:peers', this.handlePeers);
    this.socket.on('rtc:peer-joined', this.handlePeerJoined);
    this.socket.on('rtc:peer-left', this.handlePeerLeft);
    this.socket.on('rtc:signal', this.handleSignal);
    this.socket.on('media:state', this.handleMediaState);
    this.socket.on('screen:denied', this.handleScreenDenied);
    this.socket.on('host:muted', this.handleHostMuted);
 }

  stop() {
    this.disposed = true;
    this.socket.off('rtc:peers', this.handlePeers);
    this.socket.off('rtc:peer-joined', this.handlePeerJoined);
    this.socket.off('rtc:peer-left', this.handlePeerLeft);
    this.socket.off('rtc:signal', this.handleSignal);
    this.socket.off('media:state', this.handleMediaState);
    this.socket.off('screen:denied', this.handleScreenDenied);
    this.socket.off('host:muted', this.handleHostMuted);
    this.stopCamera(false); // camera ki light band
    this.stopMic(false); // mic band
    this.stopScreen(false); // screen capture band
    this.closeAll();
    this.setAudioBlocked(false);
  }

  // React ke liye plain data (RTCPeerConnection andar hi rehta hai)
  getState() {
    return {
      cameraOn: this.cameraTrack !== null,
      micOn: this.micTrack !== null,
      screenSharing: this.screenVideoTrack !== null,
      selfSpeaking: this.selfSpeaking,
      audioBlocked: this.audioBlocked,
      localStream: this.localStream,
      peers: [...this.peers.values()].map((p) => ({
        socketId: p.socketId,
        userId: p.userId,
        name: p.name,
        media: p.media,
        stream: p.stream,
        screenStream: p.screenStream,
        connection: p.connection,
        speaking: p.speaking,
      })),
    };
  }

  // ---------- Room ke peers ----------
  handlePeers = (list) => {
    list.forEach((info) => this.addPeer(info));
    this.notify();
  };

  handlePeerJoined = (info) => {
    this.addPeer(info);
    this.notify();
  };

  handlePeerLeft = ({ socketId }) => {
    this.closePeer(socketId);
    this.notify();
  };

  handleMediaState = ({ socketId, media }) => {
    const peer = this.peers.get(socketId);
    if (!peer) return;
    peer.media = media;
    this.notify();
  };

  // Server ne bola: koi aur pehle se screen share kar raha hai
  handleScreenDenied = ({ by }) => {
    this.stopScreen(false);
    this.onError?.(`${by} is already sharing their screen.`);
 };

 
  // Host ne mic mute karne ko kaha: hum mic band kar dete hain, banda chahe to dobara unmute kar sakta hai
  handleHostMuted = ({ by }) => {
    if (!this.micTrack) return;
    this.stopMic();
    this.onError?.(`${by} (host) muted your microphone. You can unmute again.`);
  };

  addPeer(info) {
    const peer = this.peers.get(info.socketId) || this.createPeer(info.socketId);
    peer.userId = info.userId;
    peer.name = info.name;
    peer.media = info.media || emptyMedia();
  }

  createPeer(socketId) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    const peer = {
      socketId,
      userId: null,
      name: 'Guest',
      media: emptyMedia(),
      stream: null, // camera + mic ki stream
      screenStream: null, // screen share ki stream
      connection: 'new',
      speaking: false,
      audioEl: null, // is banda ki awaaz chalane wala element
      detector: null, // is banda ke "bol raha hai" ka pata lagane wala
      pc,
      // Dono taraf offer ek saath ban jaye to kaun peeche hatega: socket id chhoti wala "polite" hai
      polite: this.socket.id < socketId,
      makingOffer: false,
      ignoreOffer: false,
      cameraSender: null,
      micSender: null,
      screenVideoSender: null,
      screenAudioSender: null,
    };
    this.peers.set(socketId, peer);

    // Mere paas rasta (ICE candidate) mila: doosre ko bhej do
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.socket.emit('rtc:signal', { to: socketId, data: { candidate: candidate.toJSON() } });
      }
    };

    // Kuch badla (track juda/hata): naya offer banao aur bhejo
    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        this.socket.emit('rtc:signal', { to: socketId, data: { description: pc.localDescription.toJSON() } });
      } catch (err) {
        console.error('WebRTC negotiation failed:', err);
      } finally {
        peer.makingOffer = false;
      }
    };

    // Doosre ka video ya awaaz aa gayi
    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (!stream) return;

      // Screen share ki stream alag hai. Uski id server se media:state mein pehle hi aa chuki hoti hai
      if (peer.media.screenStreamId && stream.id === peer.media.screenStreamId) {
        peer.screenStream = stream;
        this.notify();
        return;
      }

      peer.stream = stream; // camera + mic ek hi stream mein aate hain

      if (event.track.kind === 'audio' && !peer.audioEl) {
        const audioEl = new Audio();
        audioEl.autoplay = true;
        audioEl.srcObject = stream;
        peer.audioEl = audioEl;
        this.playRemoteAudio(peer);

        peer.detector = createSpeakingDetector(event.track, (speaking) => {
          peer.speaking = speaking;
          this.notify();
        });
      }

      this.notify();
    };

    pc.onconnectionstatechange = () => {
      peer.connection = pc.connectionState;
      if (pc.connectionState === 'failed') pc.restartIce(); // dobara rasta dhoondo
      this.notify();
    };

    // Jo kuch pehle se on hai wo naye banda ko bhi bhejo
    if (this.cameraTrack) peer.cameraSender = pc.addTrack(this.cameraTrack, this.localStream);
    if (this.micTrack) peer.micSender = pc.addTrack(this.micTrack, this.localStream);
    if (this.screenVideoTrack) {
      peer.screenVideoSender = pc.addTrack(this.screenVideoTrack, this.screenStream);
    }
    if (this.screenAudioTrack) {
      peer.screenAudioSender = pc.addTrack(this.screenAudioTrack, this.screenStream);
    }

    return peer;
  }

  closePeer(socketId) {
    const peer = this.peers.get(socketId);
    if (!peer) return;

    peer.detector?.stop();
    if (peer.audioEl) {
      peer.audioEl.pause();
      peer.audioEl.srcObject = null;
    }

    peer.pc.onicecandidate = null;
    peer.pc.onnegotiationneeded = null;
    peer.pc.ontrack = null;
    peer.pc.onconnectionstatechange = null;
    peer.pc.close();
    this.peers.delete(socketId);
  }

  closeAll() {
    [...this.peers.keys()].forEach((id) => this.closePeer(id));
  }

  // Socket toot kar dobara juda: socket id badal gayi, purane connections bekaar hain
  reset() {
    this.closeAll();
    this.notify();
  }

  // Room join ho gaya: server naye socket ki media state nahi jaanta, to batao
  onRoomJoined() {
    if (this.cameraTrack || this.micTrack) {
      this.socket.emit('media:update', {
        camera: this.cameraTrack !== null,
        mic: this.micTrack !== null,
      });
    }
    if (this.screenVideoTrack) {
      this.socket.emit('media:update', { screen: true, screenStreamId: this.screenStream.id });
    }
  }

  // Ek sender ko track do: pehle se sender ho to reuse (naya offer nahi), warna naya sender
  async attachTrack(peer, senderKey, track, stream) {
    if (peer[senderKey]) {
      await peer[senderKey].replaceTrack(track);
    } else {
      peer[senderKey] = peer.pc.addTrack(track, stream);
    }
  }

  // ---------- Doosron ki awaaz chalana ----------
  playRemoteAudio(peer) {
    peer.audioEl.play().catch((err) => {
      if (err.name === 'NotAllowedError') this.setAudioBlocked(true); // browser ne roka
    });
  }

  // Awaaz blocked ho to: koi bhi click ya key dabane par apne aap dobara koshish
  setAudioBlocked(value) {
    if (this.audioBlocked === value) return;
    this.audioBlocked = value;

    if (value) {
      document.addEventListener('pointerdown', this.unlockHandler);
      document.addEventListener('keydown', this.unlockHandler);
    } else {
      document.removeEventListener('pointerdown', this.unlockHandler);
      document.removeEventListener('keydown', this.unlockHandler);
    }
    this.notify();
  }

  unlockAudio() {
    resumeAudioContext();
    const attempts = [...this.peers.values()]
      .filter((peer) => peer.audioEl)
      .map((peer) => peer.audioEl.play());

    Promise.allSettled(attempts).then((results) => {
      const stillBlocked = results.some(
        (r) => r.status === 'rejected' && r.reason?.name === 'NotAllowedError'
      );
      this.setAudioBlocked(stillBlocked);
    });
  }

  // ---------- Signaling: doosre peer ki chitthi aayi ----------
  handleSignal = async ({ from, data }) => {
    if (!from || !data) return;

    const peer = this.peers.get(from) || this.createPeer(from);
    const { pc } = peer;

    try {
      if (data.description) {
        const description = data.description;

        // Glare: hum bhi offer bana rahe the aur doosre ka offer bhi aa gaya
        const offerCollision =
          description.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');

        peer.ignoreOffer = !peer.polite && offerCollision; // impolite banda apna offer rakhta hai
        if (peer.ignoreOffer) return;

        await pc.setRemoteDescription(description);

        if (description.type === 'offer') {
          await pc.setLocalDescription(); // answer apne aap ban jata hai
          this.socket.emit('rtc:signal', { to: from, data: { description: pc.localDescription.toJSON() } });
        }
      } else if (data.candidate) {
        try {
          await pc.addIceCandidate(data.candidate);
        } catch (err) {
          if (!peer.ignoreOffer) throw err;
        }
      }
    } catch (err) {
      console.error('WebRTC signaling error:', err);
    }
  };

  // ---------- Camera ----------
  async startCamera() {
    if (this.cameraTrack || this.starting.camera) return;
    this.starting.camera = true;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24, max: 30 } },
        audio: false,
      });
      const track = stream.getVideoTracks()[0];
      track.onended = () => this.stopCamera(); // camera nikal diya ya OS ne band kar diya

      this.cameraTrack = track;
      this.localStream.addTrack(track);

      for (const peer of this.peers.values()) {
        await this.attachTrack(peer, 'cameraSender', track, this.localStream);
      }

      this.socket.emit('media:update', { camera: true });
      this.notify();
    } finally {
      this.starting.camera = false;
    }
  }

  stopCamera(announce = true) {
    if (!this.cameraTrack) return;

    const track = this.cameraTrack;
    track.onended = null;
    this.localStream.removeTrack(track);
    track.stop(); // hardware camera ki light band
    this.cameraTrack = null;

    for (const peer of this.peers.values()) {
      peer.cameraSender?.replaceTrack(null).catch(() => {});
    }

    if (announce) this.socket.emit('media:update', { camera: false });
    this.notify();
  }

  // ---------- Microphone ----------
  async startMic() {
    if (this.micTrack || this.starting.mic) return;
    this.starting.mic = true;

    try {
      // autoGainControl band: Chrome ki auto-gain Windows ka mic volume khud badal sakti hai
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false },
        video: false,
      });
      const track = stream.getAudioTracks()[0];
      track.onended = () => this.stopMic(); // mic nikal diya ya OS ne band kar diya
      // Windows ya koi aur app mic ko apne kabze mein le le to browser ko awaaz milna band ho jati hai
      track.onmute = () =>
        this.onError?.('Your microphone stopped sending sound. Another app may be using it, or Windows muted it.');
      console.info('Microphone in use:', track.label, track.getSettings()); // Chrome aur Edge ka farq dekhne ke liye

      this.micTrack = track;
      this.localStream.addTrack(track);

      for (const peer of this.peers.values()) {
        await this.attachTrack(peer, 'micSender', track, this.localStream);
      }

      // Apni "bol raha hoon" wali border ke liye
      resumeAudioContext();
      this.selfDetector = createSpeakingDetector(track, (speaking) => {
        this.selfSpeaking = speaking;
        this.notify();
      });

      this.socket.emit('media:update', { mic: true });
      this.notify();
    } finally {
      this.starting.mic = false;
    }
  }

  stopMic(announce = true) {
    if (!this.micTrack) return;

    const track = this.micTrack;
    track.onended = null;
    this.localStream.removeTrack(track);
    track.stop(); // mic poori tarah band, browser ki recording light bhi bujhti hai
    this.micTrack = null;

    this.selfDetector?.stop();
    this.selfDetector = null;
    this.selfSpeaking = false;

    for (const peer of this.peers.values()) {
      peer.micSender?.replaceTrack(null).catch(() => {});
    }

    if (announce) this.socket.emit('media:update', { mic: false });
    this.notify();
  }

  // ---------- Screen share ----------
  async startScreen() {
    if (this.screenVideoTrack || this.starting.screen) return;

    // Courtesy check: koi aur pehle se share kar raha ho to picker kholne ka faida nahi
    const sharer = [...this.peers.values()].find((p) => p.media.screen);
    if (sharer) {
      const err = new Error('Someone else is already sharing');
      err.name = 'ScreenBusyError';
      err.sharerName = sharer.name;
      throw err;
    }

    this.starting.screen = true;
    try {
      // Browser ka picker khulega: user tab / window / poori screen chunega
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 15, max: 30 } },
        // Tab/system ki awaaz ko bigaadna nahi hai, isliye ye teen band
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        selfBrowserSurface: 'exclude', // Chrome: apna hi tab share karne ka option na dikhao
        systemAudio: 'include',
      });

      const videoTrack = stream.getVideoTracks()[0];
      const audioTrack = stream.getAudioTracks()[0] || null; // user ne awaaz tick na ki ho to nahi hoga

      // Browser ki "Stop sharing" bar dabane par bhi share band ho
      videoTrack.onended = () => this.stopScreen();

      this.screenVideoTrack = videoTrack;
      this.screenAudioTrack = audioTrack;
      this.screenStream.addTrack(videoTrack);
      if (audioTrack) this.screenStream.addTrack(audioTrack);

      // PEHLE room ko batao (stream id ke saath), PHIR tracks jodo.
      // Is order se doosri taraf offer aane se pehle hi pata hota hai ki ye stream screen ki hai.
      this.socket.emit('media:update', { screen: true, screenStreamId: this.screenStream.id });

      for (const peer of this.peers.values()) {
        await this.attachTrack(peer, 'screenVideoSender', videoTrack, this.screenStream);
        if (audioTrack) {
          await this.attachTrack(peer, 'screenAudioSender', audioTrack, this.screenStream);
        }
      }

      this.notify();
    } finally {
      this.starting.screen = false;
    }
  }

  stopScreen(announce = true) {
    if (!this.screenVideoTrack) return;

    const tracks = [this.screenVideoTrack, this.screenAudioTrack].filter(Boolean);
    this.screenVideoTrack.onended = null;
    for (const track of tracks) {
      this.screenStream.removeTrack(track);
      track.stop(); // screen capture band
    }
    this.screenVideoTrack = null;
    this.screenAudioTrack = null;

    for (const peer of this.peers.values()) {
      peer.screenVideoSender?.replaceTrack(null).catch(() => {});
      peer.screenAudioSender?.replaceTrack(null).catch(() => {});
    }

    if (announce) this.socket.emit('media:update', { screen: false, screenStreamId: null });
    this.notify();
  }
}