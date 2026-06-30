import type { Flight, FlightDetails, Student } from '../models/types';

export const getAltitudeDifferenceMeters = (details?: FlightDetails): number => {
  const value = details?.altitudeDifferenceMeters;
  return Number.isFinite(value) && value && value > 0 ? Math.floor(value) : 0;
};

export const getStudentTotalAltitudeMeters = (student: Pick<Student, 'totalAltitudeMeters'>): number => (
  Number.isFinite(student.totalAltitudeMeters) && student.totalAltitudeMeters > 0
    ? Math.floor(student.totalAltitudeMeters)
    : 0
);

export const getCompletedFlightAltitudeMeters = (flight: Pick<Flight, 'endTime' | 'details'>): number => (
  flight.endTime ? getAltitudeDifferenceMeters(flight.details) : 0
);

