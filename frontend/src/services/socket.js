import { io } from 'socket.io-client';
import { API_ORIGIN } from './api';
import { setIceServers } from '../config/rtc';

let socket = null;

export function getSocket() {
  if (!socket) {
    // API_ORIGIN khaali ho (production) to isi website ke address par connect hota hai
    socket = io(API_ORIGIN || undefined, {
      withCredentials: true,
      autoConnect: false, // hum khud connect() karenge jab zaroorat ho
    });

    // Server har connection par STUN/TURN ki taaza list bhejta hai (TURN ke credentials har baar naye)
    socket.on('rtc:ice-servers', setIceServers);
  }
  return socket;
}