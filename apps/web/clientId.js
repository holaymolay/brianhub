import { createId } from './localStore.js';

const CLIENT_ID_KEY = 'brianhub_client_id';

export function getClientId() {
  let id = localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = `web-${createId()}`;
    localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}
