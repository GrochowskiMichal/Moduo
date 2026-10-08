/**
 * Every built email template, keyed by its kind (`EMAIL_KINDS` in @contracts).
 * Each TX block adds its templates here — one line per kind — plus a fixture in
 * `fixtures.ts`, which feeds the tests and the Storybook gallery.
 *
 * The renderer flattens and caps every string, but a name written into a
 * sentence or paragraph only gets the paragraph cap. Templates pass every
 * user-typed name through `singleLine(name, TEXT_LIMITS.name)` before placing it.
 */

import type { EmailKind } from "../../contracts/vocabularies.ts";
import type { EmailDoc } from "../blocks.ts";
import { type RenderedEmail, type RenderOptions, renderEmail } from "../render.ts";
import { type AuthCodeData, authCodeEmail } from "./auth-code.ts";

export { AUTH_CODE_VALID_MINUTES } from "./auth-code.ts";
export {
  type AuthConfirmCodeData,
  type AuthInviteData,
  authConfirmCodeEmail,
  authInviteEmail,
} from "./auth-variants.ts";

export interface EmailTemplateData {
  auth_code: AuthCodeData;
}

export type BuiltEmailKind = keyof EmailTemplateData & EmailKind;

export const EMAIL_TEMPLATES: { [K in BuiltEmailKind]: (data: EmailTemplateData[K]) => EmailDoc } = {
  auth_code: authCodeEmail,
};

export const BUILT_EMAIL_KINDS = Object.keys(EMAIL_TEMPLATES) as BuiltEmailKind[];

export function renderTemplate<K extends BuiltEmailKind>(
  kind: K,
  data: EmailTemplateData[K],
  options?: RenderOptions,
): RenderedEmail {
  return renderEmail(EMAIL_TEMPLATES[kind](data), options);
}
