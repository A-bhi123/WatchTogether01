import { io } from 'socket.io-client';

let socket = null;

export function getSocket() {
  if (!socket) {
    socket = io('http://localhost:5000', {
      withCredentials: true,
      autoConnect: false, // hum khud connect() karenge jab zaroorat ho
    });
  }
  return socket;
}