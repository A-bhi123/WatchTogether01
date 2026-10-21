// STUN: browser ko batata hai ki wo internet par kis public address se dikhta hai.
// TURN: seedha connection na ban paye (strict router, mobile network, office) to beech mein relay karta hai.
//
// Asli list server deta hai: socket connect hote hi "rtc:ice-servers" event aata hai.
// (TURN ke username/password kuch ghante mein expire hote hain, isliye unhe yahan likhna hi nahi chahiye.)
// Ye default list sirf tab kaam aati hai jab server ne kuch na bheja ho.
export let ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export function setIceServers(servers) {
  if (Array.isArray(servers) && servers.length > 0) ICE_SERVERS = servers;
}