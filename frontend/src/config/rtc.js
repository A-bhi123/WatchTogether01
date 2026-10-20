// STUN: browser ko batata hai ki wo internet par kis public address se dikhta hai.
// TURN: seedha connection na ban paye (strict router, mobile network, office) to beech mein relay karta hai.
export const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  // Phase 26 (production) mein yahan TURN server jodenge, jaise:
  // { urls: 'turn:your-turn-server:3478', username: '...', credential: '...' },
];