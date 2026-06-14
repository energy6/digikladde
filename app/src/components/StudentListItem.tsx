import { List } from "antd";
import type { Flight, Student } from "../models/types";
import { durationFormatter, timeFormatter } from "../utils/DatetimeFormatter";
import { formatRatingLabel } from "../utils/maneuverRatings";

interface StudentListItemProps {
  student: Student;
  flight: Flight;
  nowTs: number;
}

const StudentListItem = ({student, flight, nowTs}: StudentListItemProps) => {
  const startTime = new Date(flight.startTime);
  const landingTime = flight.landingMarkedAt ? new Date(flight.landingMarkedAt) : null;
  const maneuverText = flight.maneuvers.map((maneuver) => formatRatingLabel(maneuver, student.lastRatings)).join(', ');

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
