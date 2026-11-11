// Works out the first letters of some of a room's books (see spines.js).
import { openings } from './library.js';

self.onmessage = ({ data }) => {
  const { design, room, books, count, order } = data;
  openings(Uint8Array.from(room), books, design, count, order, batch => {
    self.postMessage({ batch });
    return true;
  });
  self.postMessage({ done: true });
};
