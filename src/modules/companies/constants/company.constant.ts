export const COMPANY_MAX_NOTES = 100;
export const COMPANY_MAX_DOCUMENTS = 50;
export const COMPANY_DEFAULT_PAGE_SIZE = 20;
export const COMPANY_MAX_PAGE_SIZE = 100;

export const COMPANY_CACHE_KEYS = {
  DETAIL: (id: string) => `crm:companies:detail:${id}`,
  CONTACTS: (id: string) => `crm:companies:${id}:contacts`,
  LIST_PREFIX: 'crm:companies:list:',
};
