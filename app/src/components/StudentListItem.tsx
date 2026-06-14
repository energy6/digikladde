import { List } from "antd";
import type { Flight, Student } from "../models/types";
import { durationFormatter, timeFormatter } from "../utils/DatetimeFormatter";

interface StudentListItemProps {
  student: Student;
  flight: Flight;
  nowTs: number;
}

const formatManeuver = (maneuver: string, student: Student): string => {
  const rating = student.lastRatings?.[maneuver];
  return typeof rating === 'number' ? `${maneuver} (${rating})` : maneuver;
};

const StudentListItem = ({student, flight, nowTs}: StudentListItemProps) => {
  const startTime = new Date(flight.startTime);
  const landingTime = flight.landingMarkedAt ? new Date(flight.landingMarkedAt) : null;
  const maneuverText = flight.maneuvers.map((maneuver) => formatManeuver(maneuver, student)).join(', ');

  return (
    <List.Item.Meta
      title={<span style={{ color: '#fff', fontWeight: 600 }}>{student.name} ({student.totalFlights ?? 0})</span>}
      description={<>
        <div style={{ color: '#deeeff' }}>
          <div>{student.glider} — {student.color}</div>
          <div>
            Flug: {timeFormatter.format(startTime)}
            {landingTime && ` - ${timeFormatter.format(landingTime)}`}
            {` | ${durationFormatter(startTime.getTime(), landingTime ? landingTime.getTime() : nowTs)}`}
          </div>
          {maneuverText ? <div>{`Manöver: ${maneuverText}`}</div> : null}
        </div>
      </>}
    />
  );
};

export default StudentListItem;
