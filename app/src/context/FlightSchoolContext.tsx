/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { ALL_FLIGHT_SCHOOLS, sanitizeFlightSchoolName } from '../utils/flightSchool';

type FlightSchoolContextValue = {
  activeFlightSchool: string;
  setActiveFlightSchool: (nextValue: string) => void;
};

const STORAGE_KEY = 'digikladde.activeFlightSchool';

const FlightSchoolContext = createContext<FlightSchoolContextValue | null>(null);

const readInitialFlightSchool = (): string => {
  if (typeof window === 'undefined') return ALL_FLIGHT_SCHOOLS;
  const rawValue = window.localStorage.getItem(STORAGE_KEY);
  if (!rawValue || rawValue === ALL_FLIGHT_SCHOOLS) return ALL_FLIGHT_SCHOOLS;
  return sanitizeFlightSchoolName(rawValue);
};

export const FlightSchoolProvider = ({ children }: { children: ReactNode }) => {
  const [activeFlightSchool, setActiveFlightSchoolState] = useState<string>(readInitialFlightSchool);

  const setActiveFlightSchool = (nextValue: string) => {
    const normalized = nextValue === ALL_FLIGHT_SCHOOLS
      ? ALL_FLIGHT_SCHOOLS
      : sanitizeFlightSchoolName(nextValue);

    setActiveFlightSchoolState(normalized);

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, normalized);
    }
  };

  const contextValue = useMemo<FlightSchoolContextValue>(() => ({
    activeFlightSchool,
    setActiveFlightSchool,
  }), [activeFlightSchool]);

  return (
    <FlightSchoolContext.Provider value={contextValue}>
      {children}
    </FlightSchoolContext.Provider>
  );
};

export const useFlightSchool = (): FlightSchoolContextValue => {
  const value = useContext(FlightSchoolContext);
  if (!value) {
    throw new Error('useFlightSchool muss innerhalb des FlightSchoolProvider verwendet werden.');
  }
  return value;
};
