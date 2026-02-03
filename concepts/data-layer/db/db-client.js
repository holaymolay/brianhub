/**
 * @template T
 * @typedef {Object} DbClient
 * @property {(sql: string, params?: any[]) => Promise<T[]>} query
 * @property {(sql: string, params?: any[]) => Promise<T | null>} queryOne
 * @property {(sql: string, params?: any[]) => Promise<void>} exec
 * @property {<U>(fn: (tx: DbClient) => Promise<U>) => Promise<U>} transaction
 */

export const DbClient = {};
