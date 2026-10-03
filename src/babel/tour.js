// The guided tour: the same stops and words as BabelWorld.tour in the app.
// Each stop builds keyframes { scene, duration, hold } from addresses.
import * as L from './library.js';
import * as W from './world.js';

function stop(code, view = {}) {
  const { place } = L.parseAddress(code, L.BORGES);
  return Object.assign(W.sceneAt(place), view);
}

const frame = (scene, duration, hold = 0) => ({ scene, duration, hold });

export const PICTURE = [
  '        .,,,,,,,,,,.',
  '      .,            ,.',
  '    .,    .,,,,.      ,.',
  '   ,.     ,.  .,       .,',
  '    .,    .,,,,.      ,.',
  '      .,            ,.',
  '        .,,,,,,,,,,.',
  '',
  '   a gallery, seen from above',
].join('/');

const QUOTE = "borges:'the library is unlimited and periodic'";

export const TOUR = [
  {
    title: 'A gallery of the Library',
    body: [
      '“The universe (which others call the Library) is composed of an indefinite, perhaps infinite, number of hexagonal galleries.” So begins the story Jorge Luis Borges published in 1941.',
      'This is one gallery, built to his description. Four of its six walls carry five shelves each, and every shelf holds thirty-two books: 640 books in the room. In the middle is an air shaft with a low railing. Two lamps give a light that is “insufficient, incessant”.',
    ],
    tryIt: 'Drag to look round; W A S D to walk',
    build() {
      const start = stop('borges:0');
      return [
        frame(start, 2.5, 1.0),
        frame({ ...start, yaw: start.yaw + 1.9 }, 9.0, 0.5),
        frame({ ...start, yaw: start.yaw - 1.2 }, 12.0),
      ];
    },
  },
  {
    title: 'Above and below, without end',
    body: [
      'Lean over the railing. Below is another gallery, and below that another, each with its own shaft, as far down as the light reaches. Above is the same.',
      'Every floor here is turned one wall further round than the one beneath it, so the doorways of each floor point a different way. That matters for getting about, as the next stop shows.',
    ],
    tryIt: 'Up and down, or E and Q',
    build() {
      const g = W.geometry(L.BORGES);
      const r = g.shaft + 0.24;
      const a = Math.PI / 3;
      const down = stop('borges:0', {
        x: r * Math.cos(a), z: r * Math.sin(a), yaw: Math.atan2(Math.cos(a), Math.sin(a)), pitch: -1.25,
      });
      return [frame(down, 5.0, 5.0), frame({ ...down, pitch: 1.25 }, 7.0)];
    },
  },
  {
    title: 'The vestibule',
    body: [
      'A wall without shelves opens onto a narrow vestibule, which leads to the next gallery, “identical to the first and to all”. In it are two tiny closets, a mirror “which faithfully duplicates appearances”, and a spiral stair that “winds upward and downward into the remotest distance”.',
      'With two doorways a gallery lies on a single corridor. Only the stairs, and the turn of each floor, let you reach the rest of the Library.',
    ],
    tryIt: 'Walk through the doorway and on into the next room',
    build() {
      const g = W.geometry(L.BORGES);
      const looking = stop('borges:0', { x: g.shaft + 0.45, z: 0, yaw: -Math.PI / 2, pitch: -0.03 });
      const inside = stop('borges:0', { x: g.apothem + 0.75, z: -0.3, yaw: -Math.PI / 2 - 0.5, pitch: 0 });
      return [
        frame(looking, 4.0, 3.0),
        frame(inside, 6.0, 0.5),
        frame({ ...inside, yaw: -Math.PI + 0.35, pitch: 0.5 }, 5.0, 3.0),
        frame({ ...inside, yaw: -0.25, pitch: -0.02 }, 6.0),
      ];
    },
  },
  {
    title: 'Take a book down',
    body: [
      'Each book has 410 pages, each page 40 lines, each line 80 letters. There are 25 symbols: 22 letters, the space, the comma and the full stop. A book is therefore 1,312,000 symbols.',
      'This is wall 2, shelf 4, volume 17 of the middle gallery. Like almost every book in the Library it is noise from its first letter to its last. Turn the pages: there are 409 more like it.',
    ],
    tryIt: 'Click any book; arrow keys or a swipe turn the page',
    build() {
      return [frame(stop('borges:0:2.4.17'), 4.0, 2.5), frame(stop('borges:0:2.4.17.1'), 0.5)];
    },
  },
  {
    title: 'Every book, exactly once',
    body: [
      'The librarians reasoned that the Library holds every possible book: every arrangement of the 25 symbols over 1,312,000 places. That is 25 multiplied by itself 1,312,000 times, a number with 1,834,098 digits. The atoms in the visible universe need only 80.',
      'So somewhere here is the true story of your death, and a faithful catalogue of the Library, and thousands of false ones. All but an unimaginably small share is gibberish.',
    ],
    tryIt: 'Books → Books, for the count',
    build() {
      const g = W.geometry(L.BORGES);
      const s = stop('borges:0', { x: -(g.shaft + 0.35), z: 0.2, yaw: 0.9, pitch: 0.12, zoom: 1.25 });
      return [frame(s, 4.0, 1.0), frame({ ...s, yaw: 2.2 }, 14.0)];
    },
  },
  {
    title: 'Your sentence already has a shelf',
    body: [
      'Here the books are placed by a rule that can be run both ways. Give it a place and it writes the book; give it a book and it names the place. Nothing is stored: the book is worked out when you take it down.',
      'So any text can be looked up. This book opens with a line from the story’s last page and is blank after it. It was always here. But notice its address: to name the room by number would take about as many digits as the book has letters, so the address simply quotes the book.',
    ],
    tryIt: 'The magnifying glass at the top finds any text',
    build() { return [frame(stop(QUOTE), 1.0)]; },
  },
  {
    title: 'Its neighbours are strangers',
    body: [
      'This is the very next book on the same shelf. It shares nothing with the one before. The rule scrambles so thoroughly that changing an address by one changes every letter of the book.',
      'That is why finding a sentence does not help you find a second: sense is scattered through the Library with no pattern at all. Search finds only what you already know how to write.',
    ],
    build() {
      const { place } = L.parseAddress(QUOTE, L.BORGES);
      // Next volume along, or the one before at the end of a shelf.
      place.volume += place.volume < place.design.volumes ? 1 : -1;
      place.page = 1;
      return [frame(W.sceneAt(place), 1.0)];
    },
  },
  {
    title: 'Pictures, too',
    body: [
      'A page is a grid of 80 by 40 characters, so any picture drawn in letters, commas and full stops is on a page somewhere. This one is a plan of a gallery.',
      'Paste or type several lines into the search box and it will take you to the book that opens with them. The picture is not put there by the search. Every arrangement of symbols is in the Library; the search only works out where.',
    ],
    tryIt: 'Search with more than one line',
    build() { return [frame(W.sceneAt(L.placeQuoting(PICTURE, L.BORGES)), 1.0)]; },
  },
  {
    title: 'The same books, in order',
    body: [
      'Shelve the books alphabetically instead, and each one is a number between 0 and 1 written out in base 25. This book is one seventh: its letters repeat for ever, as the digits of a fraction must.',
      'An ordered library is easy to search and useless to browse. Its neighbours differ only in the last letter of the last page, and to find a book you must already know all of it.',
    ],
    tryIt: 'Books → Order; an address such as reals:=1/7',
    build() { return [frame(stop('reals:=1/7'), 1.0)]; },
  },
  {
    title: 'A library you can finish',
    body: [
      'Shrink the book to two lines of two characters, in an alphabet of two symbols: a space and the letter a. Now there are 2⁴ = 16 books, and here they all are, on two walls of a small square room. Take them down one by one and you have read everything that can be written.',
      'Borges’s Library is this, with larger numbers.',
    ],
    tryIt: 'Books → Symbols, Pages, Lines, Characters',
    build() { return [frame(stop('tiny:0'), 1.0)]; },
  },
  {
    title: 'Your turn',
    body: [
      'Walk, climb, and take books down. The address at the top always says where you are, and the page’s own address holds the same thing, so a link brings anyone to the very spot. Anything typed there takes you straight to it: borges:7K2M-9QXD:2.4.17.112 is a room, a book and a page. The dice pick a room at random.',
      'Change the shape of the rooms and the size of the books under Rooms and Books. Each has an ⓘ note.',
    ],
    build() { return [frame(stop('borges:0'), 1.0)]; },
  },
];
