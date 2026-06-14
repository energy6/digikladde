import type { FlightDetails } from '../models/types';

const STORAGE_KEY = 'digikladde.flightDetailHistory.v1';
const MAX_VALUES_PER_FIELD = 10;

export const flightDetailHistoryFields = [
  'terrain',
  'teacher',
  'startPlace',
  'startTeacher',
  'landPlace',
  'landTeacher',
] as const satisfies ReadonlyArray<keyof FlightDetails>;

export type FlightDetailHistoryField = typeof flightDetailHistoryFields[number];
export type FlightDetailOptions = Partial<Record<keyof FlightDetails, string[]>>;

type FlightDetailHistory = Record<string, Partial<Record<FlightDetailHistoryField, string[]>>>;

const isStringArray = (value: unknown): value is string[] => (
  Array.isArray(value) && value.every((entry) => typeof entry === 'string')
);

const readHistory = (): FlightDetailHistory => {
  try {
    const rawValue = window.localStorage.getItem(STORAGE_KEY);
    if (!rawValue) return {};

    const parsedValue: unknown = JSON.parse(rawValue);
    if (!parsedValue || typeof parsedValue !== 'object' || Array.isArray(parsedValue)) return {};

    const history: FlightDetailHistory = {};
    Object.entries(parsedValue).forEach(([flightSchool, fields]) => {
      if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return;

      const validFields: Partial<Record<FlightDetailHistoryField, string[]>> = {};
      flightDetailHistoryFields.forEach((field) => {
        const values = (fields as Record<string, unknown>)[field];
        if (isStringArray(values)) {
          validFields[field] = values.map((value) => value.trim()).filter(Boolean);
        }
      });

      history[flightSchool] = validFields;
    });

    return history;
  } catch {
    return {};
  }
};

const writeHistory = (history: FlightDetailHistory) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    // Ignore storage failures; flight start must not depend on local history.
  }
};

const mergeValues = (values: Array<string | undefined>): string[] => {
  const seen = new Set<string>();
  const mergedValues: string[] = [];

  values.forEach((value) => {
    const trimmedValue = value?.trim();
    if (!trimmedValue) return;

    const key = trimmedValue.toLocaleLowerCase('de-DE');
    if (seen.has(key)) return;

    seen.add(key);
    mergedValues.push(trimmedValue);
  });

  return mergedValues.slice(0, MAX_VALUES_PER_FIELD);
};

export const getFlightDetailOptions = (flightSchool: string, defaults?: FlightDetails): FlightDetailOptions => {
  const history = readHistory();
  const schoolHistory = history[flightSchool] ?? {};
  const options: FlightDetailOptions = {};

  flightDetailHistoryFields.forEach((field) => {
    options[field] = mergeValues([
      defaults?.[field],
      ...(schoolHistory[field] ?? []),
    ]);
  });

  return options;
};

export const rememberFlightDetails = (flightSchool: string, details: FlightDetails) => {
  const history = readHistory();
  const schoolHistory = history[flightSchool] ?? {};
  const nextSchoolHistory: Partial<Record<FlightDetailHistoryField, string[]>> = { ...schoolHistory };

  flightDetailHistoryFields.forEach((field) => {
    nextSchoolHistory[field] = mergeValues([
      details[field],
      ...(schoolHistory[field] ?? []),
    ]);
  });

  history[flightSchool] = nextSchoolHistory;
  writeHistory(history);
};
