import { Appearance } from 'react-native';

export const lightColors = {
  cream: '#FBF6EC', sand: '#EFE6D3', forest: '#16261F', moss: '#1F3A2E',
  coral: '#FF6A4D', gold: '#F2B441',
  card: '#FBF6EC', border: '#EFE6D3', onPrimary: '#16261F',
  panel: '#16261F', panelText: '#FBF6EC', panelMuted: '#EFE6D3',
  selection: '#16261F', onSelection: '#FBF6EC',
  tabBackground: '#16261F', tabInactive: '#FBF6EC', tabActive: '#FF6A4D', tabActiveBackground: 'transparent',
  accentText: '#FF6A4D', overlay: '#16261FCC', transparent: 'transparent',
  chatBackground: '#fff', tileVideo: '#d8decb', streamVideo: '#0d2218',
  subtleBorder: 'rgba(0,0,0,0.06)', divider: 'rgba(0,0,0,0.04)',
  mediaOverlay: 'rgba(0,0,0,0.3)', mediaBorder: 'rgba(255,255,255,0.1)',
  alphaAccent: '#FF8A6E',
  chatPlaceholder: '#EFE6D3',
};

export const darkColors: Record<keyof typeof lightColors, string> = {
  cream: '#120B04', sand: '#1E1708', forest: '#E6EFE6', moss: '#B9C4B4',
  coral: '#A8120F', gold: '#F2B441',
  card: '#1E1708', border: '#2A2210', onPrimary: '#E6EFE6',
  panel: '#1E1708', panelText: '#E6EFE6', panelMuted: '#B9C4B4',
  selection: '#A8120F', onSelection: '#E6EFE6',
  tabBackground: '#1E1708', tabInactive: '#B9C4B4', tabActive: '#E6EFE6', tabActiveBackground: '#A8120F',
  accentText: '#E6EFE6', overlay: '#120B04CC', transparent: 'transparent',
  chatBackground: '#1E1708', tileVideo: '#120B04', streamVideo: '#120B04',
  subtleBorder: '#2A2210', divider: '#2A2210', mediaOverlay: '#120B04', mediaBorder: '#2A2210',
  alphaAccent: '#A8120F',
  chatPlaceholder: '#B9C4B4',
};
export const isDark = Appearance.getColorScheme() === 'dark';
export const colors = isDark ? darkColors : lightColors;

export const tenants = {
  skorly: { name: 'Skorly', logo: 'S', primary: colors.coral },
  alpha: { name: 'Alpha Sports', logo: 'A', primary: colors.alphaAccent },
  beta: { name: 'Beta Athletics', logo: 'B', primary: colors.gold },
};
export const tenant = tenants.skorly;
