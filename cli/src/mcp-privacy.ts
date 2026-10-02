/** MCP-only data minimization. REST and direct CLI behavior remain unchanged. */
import type { Api } from './commands.js';
import { settingsPatchSchema } from './settings-schema.js';

const restricted = new Set(['taxid', 'sellertaxid', 'buyertaxid', 'bankaccount', 'routingnumber', 'iban', 'ssn', 'socialsecuritynumber', 'governmentid', 'passportnumber', 'creditcardnumber', 'cardnumber', 'cvv', 'password', 'apikey', 'accesstoken', 'refreshtoken', 'clientsecret', 'secretkey']);
const isRestricted = (key: string) => restricted.has(key.replace(/[_-]/g, '').toLowerCase());
const present = (value: unknown) => value !== undefined && value !== null && value !== '';
export function containsRestrictedFields(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsRestrictedFields);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, child]) => (isRestricted(key) && present(child)) || containsRestrictedFields(child));
}
export function omitRestrictedFields(value: unknown): any {
  if (Array.isArray(value)) return value.map(omitRestrictedFields);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !isRestricted(key)).map(([key, child]) => [key, omitRestrictedFields(child)]));
}
export const mcpSettingsPatchSchema = settingsPatchSchema.extend({
  business: settingsPatchSchema.shape.business.unwrap().omit({ taxId: true }).optional(),
});
export function withMcpPrivacy(api: Api): Api {
  return new Proxy(api, {
    get(target, property, receiver) {
      const method = Reflect.get(target, property, receiver);
      if (typeof method !== 'function') return method;
      return async (...args: unknown[]) => {
        if (containsRestrictedFields(args)) throw new Error('Restricted identity or credential fields cannot be processed through MCP. Use the secure application interface.');
        const value = await method.apply(target, args);
        // A partial backup would silently lose data on restore. Never return one.
        if (property === 'backup' && containsRestrictedFields(value)) throw new Error('This backup contains restricted fields. Export the complete backup directly in the secure application; no partial backup was returned.');
        if (property === 'backup') return value; // Preserve blank required fields for lossless restore.
        return omitRestrictedFields(value);
      };
    },
  });
}
