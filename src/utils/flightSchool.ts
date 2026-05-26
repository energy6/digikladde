export const UNKNOWN_FLIGHT_SCHOOL = 'Unbekannt';
export const ALL_FLIGHT_SCHOOLS = '__ALL_FLIGHT_SCHOOLS__';

export const normalizeFlightSchoolName = (value: string | undefined | null): string => {
  if (!value) return '';
  return value.replace(/\s+/g, ' ').trim();
};

export const isUnknownFlightSchool = (value: string | undefined | null): boolean => {
  const normalized = normalizeFlightSchoolName(value);
  if (!normalized) return true;
  return normalized.toLocaleLowerCase('de-DE') === UNKNOWN_FLIGHT_SCHOOL.toLocaleLowerCase('de-DE');
};

export const sanitizeFlightSchoolName = (value: string | undefined | null): string => {
  const normalized = normalizeFlightSchoolName(value);
  if (!normalized || isUnknownFlightSchool(normalized)) {
    return UNKNOWN_FLIGHT_SCHOOL;
  }
  return normalized;
};

const dedupeKey = (value: string): string => value.toLocaleLowerCase('de-DE');

export const extractFlightSchools = (values: Array<string | undefined | null>): string[] => {
  const unique = new Map<string, string>();

  values.forEach((raw) => {
    const school = sanitizeFlightSchoolName(raw);
    unique.set(dedupeKey(school), school);
  });

  if (!unique.has(dedupeKey(UNKNOWN_FLIGHT_SCHOOL))) {
    unique.set(dedupeKey(UNKNOWN_FLIGHT_SCHOOL), UNKNOWN_FLIGHT_SCHOOL);
  }

  return [...unique.values()].sort((a, b) => {
    if (a === UNKNOWN_FLIGHT_SCHOOL) return -1;
    if (b === UNKNOWN_FLIGHT_SCHOOL) return 1;
    return a.localeCompare(b, 'de-DE');
  });
};
