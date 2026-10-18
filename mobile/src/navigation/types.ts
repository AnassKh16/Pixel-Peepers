import type { NavigatorScreenParams } from '@react-navigation/native';
export type HomeTabs = { Fixtures: undefined; Standings: undefined; Store: undefined; Club: undefined; Profile: undefined };
export type Routes = {
  Home: NavigatorScreenParams<HomeTabs> | undefined; Fixtures: undefined; Standings: undefined; Store: undefined; Club: undefined; Profile: undefined;
  MatchDetail: { id: string }; ProductDetail: { id: string }; Cart: undefined; Checkout: undefined;
  PaymentResult: { id: string }; Receipt: { id: string }; Roster: undefined; Scoring: { id?: string };
  SyncStatus: undefined; Settings: undefined;
  Login: undefined;
  MatchLive: { id: string };
  CoStream: { id: string };
  PlayerProfile: { id: string };
  ClubProfile: { id: string };
};
