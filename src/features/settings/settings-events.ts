export type SettingsSectionId =
  | "appearance"
  | "account"
  | "workspace"
  | "integrations"
  | "preferences"
  | "focus"
  | "advanced"
  | "about";

export const SETTINGS_OPEN_EVENT = "moduo:settings:open";

export type SettingsOpenDetail = {
  section?: SettingsSectionId;
};

export function dispatchOpenSettings(detail: SettingsOpenDetail = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<SettingsOpenDetail>(SETTINGS_OPEN_EVENT, { detail }));
}

export function isSettingsSectionId(value: unknown): value is SettingsSectionId {
  return (
    value === "appearance" ||
    value === "account" ||
    value === "workspace" ||
    value === "integrations" ||
    value === "preferences" ||
    value === "focus" ||
    value === "advanced" ||
    value === "about"
  );
}
