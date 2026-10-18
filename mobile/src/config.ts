import * as SecureStore from 'expo-secure-store';

export let BASE_URL = 'http://192.168.137.1:8080';
const key = 'skorly.server';
export async function loadServerAddress() {
  BASE_URL = (await SecureStore.getItemAsync(key)) || BASE_URL;
  return BASE_URL;
}
export async function saveServerAddress(value: string) {
  const address = value.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/?#]+(?::\d+)?(?:\/[^\s?#]*)?$/.test(address)) {
    throw new Error('Enter a valid server address starting with http:// or https://.');
  }
  await SecureStore.setItemAsync(key, address);
  BASE_URL = address;
}

export function getServerHost(url: string = BASE_URL): string {
  try {
    const match = url.match(/^https?:\/\/([^:/]+)/);
    return match ? match[1] : 'localhost';
  } catch {
    return 'localhost';
  }
}
