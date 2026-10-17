import { Club, Match, Product, Standing } from '../types';
const now = new Date().toISOString();
export const fixtures: Match[] = [
  { id: 'match-1', home: 'Alpha United', away: 'Beta Athletic', homeScore: 2, awayScore: 1, status: 'Live', startsAt: now, minute: 67, sport: 'Football', venue: 'NASCON Main Ground', version: 1, updatedAt: now, events: [
    { id: 'e1', team: 'Alpha United', minute: 14, description: 'Goal · Ali Khan', points: 1 },
    { id: 'e2', team: 'Beta Athletic', minute: 38, description: 'Goal · Zain Ahmed', points: 1 },
    { id: 'e3', team: 'Alpha United', minute: 62, description: 'Goal · Hamza Malik', points: 1 },
  ] },
  { id: 'match-2', home: 'Cedar FC', away: 'Falcon Club', homeScore: 0, awayScore: 0, status: 'Upcoming', startsAt: '2026-10-18T11:00:00+05:00', minute: 0, sport: 'Football', venue: 'North Pitch', version: 1, updatedAt: now, events: [] },
  { id: 'match-3', home: 'Forest Hoops', away: 'City Giants', homeScore: 78, awayScore: 72, status: 'Completed', startsAt: '2026-10-16T16:00:00+05:00', minute: 40, sport: 'Basketball', venue: 'Indoor Arena', version: 1, updatedAt: now, events: [] },
];
export const tables: Record<string, Standing[]> = {
  'NASCON Football': [
    { team: 'Alpha United', played: 8, won: 6, drawn: 1, lost: 1, diff: 14, points: 19, status: 'Clinched' },
    { team: 'Beta Athletic', played: 8, won: 5, drawn: 1, lost: 2, diff: 8, points: 16, status: 'Clinched' },
    { team: 'Cedar FC', played: 8, won: 3, drawn: 2, lost: 3, diff: 1, points: 11, status: 'Still possible' },
    { team: 'Falcon Club', played: 8, won: 0, drawn: 0, lost: 8, diff: -23, points: 0, status: 'Eliminated' },
  ],
  'City Basketball': [
    { team: 'Forest Hoops', played: 6, won: 5, drawn: 0, lost: 1, diff: 42, points: 10, status: 'Clinched' },
    { team: 'City Giants', played: 6, won: 3, drawn: 0, lost: 3, diff: -8, points: 6, status: 'Still possible' },
    { team: 'River Five', played: 6, won: 1, drawn: 0, lost: 5, diff: -34, points: 2, status: 'Eliminated' },
  ],
};
export const products: Product[] = [
  { id: 'kit', name: 'Alpha home jersey', price: 4500, description: 'The match-day essential. Breathable performance knit with the Alpha club crest.', sizes: ['S', 'M', 'L', 'XL'], colors: ['Forest', 'Cream'], symbol: 'shirt-outline' },
  { id: 'cap', name: 'Club sideline cap', price: 1800, description: 'A relaxed cotton cap for the stands and everywhere after.', sizes: ['One size'], colors: ['Forest', 'Sand'], symbol: 'sunny-outline' },
  { id: 'bottle', name: 'Training bottle', price: 2200, description: 'Stay ready. A reusable 750ml training companion.', sizes: ['750ml'], colors: ['Forest', 'Coral'], symbol: 'water-outline' },
  { id: 'scarf', name: 'Supporter scarf', price: 2500, description: 'Wear your club colours. Soft knit, made for the whole season.', sizes: ['One size'], colors: ['Forest'], symbol: 'ribbon-outline' },
];
export const club: Club = { id: 'alpha', name: 'Alpha United', venue: 'NASCON Main Ground · Islamabad', social: '@alphaunited', version: 1,
  roster: [
    { id: 'p1', name: 'Ali Khan', number: 10, position: 'Forward', role: 'Captain' },
    { id: 'p2', name: 'Hamza Malik', number: 7, position: 'Midfielder', role: 'Starter' },
    { id: 'p3', name: 'Omar Hassan', number: 1, position: 'Goalkeeper', role: 'Starter' },
    { id: 'p4', name: 'Saad Raza', number: 19, position: 'Defender', role: 'Substitute' },
  ], staff: ['Ayesha Noor · Head coach', 'Bilal Shah · Assistant coach'], history: ['2025 · NASCON League champions', '2024 · Club founded in Islamabad'] };
