import { LinkingOptions, getStateFromPath, getPathFromState } from '@react-navigation/native';
import { Routes } from './types';

export const linking: LinkingOptions<Routes> = {
  prefixes: ['nascon://'],
  config: {
    screens: {
      MatchLive: 'entity/:id',
      CoStream: 'stream/:id',
      PlayerProfile: 'player/:id',
      ClubProfile: 'club/:id',
      Login: 'login',
      Settings: 'settings',
      Home: 'home',
    },
  },
  getStateFromPath: (path, options) => {
    try {
      let normalized = path;
      if (normalized.includes('://')) {
        normalized = normalized.split('://')[1] || '';
      }
      const [pathWithoutQuery] = normalized.split('?');
      const cleanPath = pathWithoutQuery.replace(/^\/+|\/+$/g, '');
      const parts = cleanPath.split('/');
      const segment = parts[0];
      const id = parts.slice(1).join('/');

      if (segment === 'entity' && id) {
        if (id.startsWith('match-')) {
          return {
            routes: [{ name: 'MatchLive', params: { id } }],
          };
        }
        if (id.startsWith('player-')) {
          return {
            routes: [{ name: 'PlayerProfile', params: { id } }],
          };
        }
        if (id.startsWith('club-')) {
          return {
            routes: [{ name: 'ClubProfile', params: { id } }],
          };
        }
        // Fallback for unknown entity id
        return {
          routes: [{ name: 'MatchLive', params: { id } }],
        };
      }

      if (segment === 'stream' && id) {
        return {
          routes: [{ name: 'CoStream', params: { id } }],
        };
      }
    } catch {
      // Fall through to default parser
    }

    return getStateFromPath(path, options);
  },
  getPathFromState: (state, options) => {
    try {
      const route = state.routes[state.routes.length - 1];
      if (route) {
        if (route.name === 'MatchLive' && route.params && (route.params as { id?: string }).id) {
          return `entity/${(route.params as { id: string }).id}`;
        }
        if (route.name === 'PlayerProfile' && route.params && (route.params as { id?: string }).id) {
          return `entity/${(route.params as { id: string }).id}`;
        }
        if (route.name === 'ClubProfile' && route.params && (route.params as { id?: string }).id) {
          return `entity/${(route.params as { id: string }).id}`;
        }
        if (route.name === 'CoStream' && route.params && (route.params as { id?: string }).id) {
          return `stream/${(route.params as { id: string }).id}`;
        }
      }
    } catch {
      // Fall through to default generator
    }
    return getPathFromState(state, options);
  },
};
