// Thin BrianHub API client for the shopping PWA.
//
// Only the endpoints this app actually needs. It carries its own client id
// (NOT the web app's `brianhub_client_id`) because /sync/pull filters out
// changes whose client_id matches the caller — sharing one id between two
// open apps would make each blind to the other's edits.
import { shoppingConfig } from './config.js';
import { createUuid } from './store.js';

const CLIENT_ID_KEY = 'brianhub_shopping_client_id';

export function getClientId() {
  let id = null;
  try {
    id = localStorage.getItem(CLIENT_ID_KEY);
  } catch {
    // Private mode / storage disabled: fall through to an ephemeral id.
  }
  if (!id) {
    id = `shop-${createUuid()}`;
    try {
      localStorage.setItem(CLIENT_ID_KEY, id);
    } catch {
      // Ignore; the id stays ephemeral for this session.
    }
  }
  return id;
}

export class ApiError extends Error {
  constructor(message, status, body = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function request(path, options = {}) {
  const { headers = {}, ...rest } = options;
  let res;
  try {
    res = await fetch(`${shoppingConfig.apiBase}${path}`, {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Id': getClientId(),
        ...headers
      },
      ...rest
    });
  } catch (error) {
    // Status 0 marks "never reached the server" — the queue treats it as retriable.
    throw new ApiError(error?.message ?? 'Network error', 0);
  }
  const text = await res.text();
  const body = parseJson(text);
  if (!res.ok) {
    // The API returns `error` as a plain string on some routes and as
    // { code, message, requestId } on others.
    const detail = body?.error;
    const message = (typeof detail === 'string' && detail)
      || detail?.message
      || body?.message
      || `Request failed (${res.status})`;
    throw new ApiError(message, res.status, body);
  }
  return body;
}

export const api = {
  health: () => request('/health'),

  me: () => request('/auth/me'),
  login: (email, password) => request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  }),
  logout: () => request('/auth/logout', { method: 'POST' }),

  listWorkspaces: () => request('/workspaces'),

  listLists: (workspaceId) =>
    request(`/shopping-lists?workspace_id=${encodeURIComponent(workspaceId)}`),
  createList: (payload) =>
    request('/shopping-lists', { method: 'POST', body: JSON.stringify(payload) }),
  updateList: (id, patch) =>
    request(`/shopping-lists/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch)
    }),
  deleteList: (id) =>
    request(`/shopping-lists/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  listItems: (workspaceId) =>
    request(`/shopping-items?workspace_id=${encodeURIComponent(workspaceId)}`),
  listItemsForList: (listId) =>
    request(`/shopping-items?list_id=${encodeURIComponent(listId)}`),
  // Note: never send sort_order for brand-new items. An explicit sort_order makes
  // the server skip hint-aware placement (taskService.js planShoppingItemInsertion),
  // which is exactly the trained per-store aisle ordering we want applied.
  createItems: (listId, items) =>
    request('/shopping-items', {
      method: 'POST',
      body: JSON.stringify({ list_id: listId, items })
    }),
  updateItem: (id, patch) =>
    request(`/shopping-items/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch)
    }),
  deleteItem: (id) =>
    request(`/shopping-items/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  listStoreRules: (workspaceId) =>
    request(`/store-rules?workspace_id=${encodeURIComponent(workspaceId)}`),

  pull: (workspaceId, cursor = 0) =>
    request('/sync/pull', {
      method: 'POST',
      body: JSON.stringify({ workspace_id: workspaceId, cursor })
    })
};
