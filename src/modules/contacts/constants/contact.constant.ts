export const CONTACT_MAX_NOTES = 100;
export const CONTACT_MAX_DOCUMENTS = 50;
export const CONTACT_DEFAULT_PAGE_SIZE = 20;
export const CONTACT_MAX_PAGE_SIZE = 100;

export const CONTACT_CACHE_KEYS = {
  DETAIL: (id: string) => `crm:contacts:detail:${id}`,
  LIST_PREFIX: 'crm:contacts:list:',
};
