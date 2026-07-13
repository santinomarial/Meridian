import { io, type Socket } from 'socket.io-client';

const SOCKET_URL: string =
  (import.meta.env['VITE_SOCKET_URL'] as string | undefined) ??
  (import.meta.env.DEV ? 'http://localhost:3000' : window.location.origin);

let _socket: Socket | null = null;

export function getSocket(): Socket {
  if (_socket === null) {
    _socket = io(SOCKET_URL, {
      autoConnect: false,
      withCredentials: true,
      transports: ['websocket', 'polling'],
    });
  }
  return _socket;
}

export function destroySocket(): void {
  if (_socket !== null) {
    _socket.disconnect();
    _socket = null;
  }
}
