import axios from 'axios';

export const API_ORIGIN = 'http://localhost:5000';

const NETWORK_MESSAGE = "Can't reach the server. Check your internet connection and try again.";
const TIMEOUT_MESSAGE = 'The server took too long to respond. Please try again.';
const SERVER_MESSAGE = 'Something went wrong on our side. Please try again in a moment.';
const UNAVAILABLE_MESSAGE = 'The service is temporarily unavailable. Please try again in a moment.';

// In URLs par 401 ka matlab "session expire" nahi, balki galat password/OTP ya "abhi login nahi" hai
const AUTH_FLOW_PATHS = [
  '/auth/login', '/auth/verify-otp', '/auth/resend-otp',
  '/auth/register', '/auth/verify-register-otp', '/auth/resend-register-otp',
  '/auth/forgot-password', '/auth/reset-password', '/auth/me', '/auth/session', '/auth/logout',
];

// AuthContext yahan apna function lagata hai: login ke baad 401 aaye to session khatam
let unauthorizedHandler = null;
export function setUnauthorizedHandler(fn) {
  unauthorizedHandler = fn;
}

const api = axios.create({
  baseURL: `${API_ORIGIN}/api`,
  withCredentials: true,
  timeout: 20000, // 20 sec mein jawab na aaye to error (badi upload apna timeout: 0 deti hai)
});

// Har error ko ek jaisa banao: err.response.data.error mein hamesha user ke layak message.
// Isliye har page ka purana `err.response?.data?.error || '...'` ab apne aap sahi message dikhata hai.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // User ne khud cancel kiya (jaise upload cancel), isse error mat banao
    if (axios.isCancel(error) || error.code === 'ERR_CANCELED') return Promise.reject(error);

    const response = error.response;

    // Server tak pahunche hi nahi: net band, server band, ya jawab mein der
    if (!response) {
      error.isNetworkError = true;
      error.response = {
        status: 0,
        data: { error: error.code === 'ECONNABORTED' ? TIMEOUT_MESSAGE : NETWORK_MESSAGE },
      };
      return Promise.reject(error);
    }

    const data = response.data && typeof response.data === 'object' ? response.data : {};

    if (response.status === 503) {
      response.data = { ...data, error: data.error || UNAVAILABLE_MESSAGE };
    } else if (response.status >= 500) {
      response.data = { ...data, error: data.error || SERVER_MESSAGE };
    } else if (!data.error) {
      response.data = { ...data, error: 'Request failed. Please try again.' };
    }

    // Login ke baad kisi bhi API par 401 = session expire ho gaya
    const url = error.config?.url || '';
    if (response.status === 401 && !AUTH_FLOW_PATHS.some((path) => url.startsWith(path))) {
      unauthorizedHandler?.();
    }

    return Promise.reject(error);
  }
);

export default api;