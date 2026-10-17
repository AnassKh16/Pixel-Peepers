export type League = { id: string; name: string; sportId: string; teams: { id: string; name: string }[]; cached?: boolean };
export type Sport = { sport_id: string; name: string; scoring_model: string; periods: unknown; scoring_events: Record<string, number | { points?: number; runs?: number; rounds?: number }>; draw_allowed: boolean; overtime: unknown; tie_break_order: unknown; roster: unknown; cached?: boolean };
export type Match = { id: string; leagueId?: string; homeId?: string; awayId?: string; cached?: boolean; home: string; away: string; homeScore: number; awayScore: number; status: 'Live' | 'Upcoming' | 'Completed'; startsAt: string; minute: number; sport: string; venue: string; version: number; updatedAt: string; events: ScoreEvent[] };
export type ScoreEvent = { id: string; team: string; minute: number; description: string; points: number; compensates?: string };
export type Standing = { team: string; cached?: boolean; played: number; won: number; drawn: number; lost: number; diff: number; points: number; status: 'Clinched' | 'Eliminated' | 'Still possible' };
export type Variant = { id: string; size: string; color: string; price: number; stock: number; reserved: number };
export type Product = { id: string; cached?: boolean; variants?: Variant[]; name: string; price: number; description: string; sizes: string[]; colors: string[]; symbol: string };
export type CartItem = { product: Product; variantId?: string; size: string; color: string; quantity: number };
export type Order = { id: string; pdfBase64?: string; createdAt: string; items: CartItem[]; subtotal: number; discount: number; shipping: number; total: number; status: 'Paid' | 'Declined' | 'Capture failed'; discountCode: string };
export type Player = { id: string; name: string; squadId?: string; leagueId?: string; version?: number; number: number; position: string; role: 'Captain' | 'Starter' | 'Substitute' };
export type Club = { id: string; cached?: boolean; name: string; venue: string; social: string; version: number; roster: Player[]; staff: string[]; history: string[] };
export type QueueItem = { action_id: string; type: 'score_event' | 'roster_transfer'; queued_at: string; base_version: number; payload: Record<string, unknown> };
export type SyncResult = { action_id: string; status: 'Applied' | 'Rejected' | 'Already processed'; reason: string; serverVersion?: number; resolution?: string };

