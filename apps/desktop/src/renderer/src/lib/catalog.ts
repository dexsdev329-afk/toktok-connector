import { useTranslation } from 'react-i18next';

/**
 * Names and descriptions of integrations, effects and presets. The French text lives in the
 * integration definitions; other languages translate it in their `catalog` section, keyed by
 * id (dots replaced by "_" since "." separates i18n keys). Missing entries fall back to French.
 */
const slug = (id: string) => id.replace(/\./g, '_');

export function useCatalog() {
  const { t } = useTranslation();
  const tr = (key: string, fallback: string) => t(key, { defaultValue: fallback });
  return {
    kindName: (kind: string, fallback: string) => tr(`catalog.kinds.${slug(kind)}.name`, fallback),
    kindDescription: (kind: string, fallback: string) =>
      tr(`catalog.kinds.${slug(kind)}.description`, fallback),
    effectName: (id: string, fallback: string) => tr(`catalog.effects.${slug(id)}.name`, fallback),
    effectDescription: (id: string, fallback: string) =>
      tr(`catalog.effects.${slug(id)}.description`, fallback),
    presetName: (id: string, fallback: string) => tr(`catalog.presets.${slug(id)}`, fallback),
    category: (name: string) => tr(`catalog.categories.${slug(name)}`, name),
  };
}

export const catalogSlug = slug;
