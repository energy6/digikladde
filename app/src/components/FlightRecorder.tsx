import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { db } from '../db/database';
import type { Course, Flight, Student } from '../models/types';
import { maneuvers } from '../models/types';

const FlightRecorder = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [course, setCourse] = useState<Course | null>(null);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [selectedManeuvers, setSelectedManeuvers] = useState<string[]>([]);
  const [currentFlight, setCurrentFlight] = useState<Flight | null>(null);

  const maneuversEnabled = course?.courseType !== 'Grundkurs';

  useEffect(() => {
    const loadCourse = async () => {
      if (id) {
        const c = await db.courses.get(Number(id));
        setCourse(c || null);
      }
    };
    void loadCourse();
  }, [id]);

  const startFlight = () => {
    if (!selectedStudent) return;
    const flight: Flight = {
      courseId: Number(id),
      studentId: selectedStudent.id!,
      maneuvers: maneuversEnabled ? selectedManeuvers : [],
      startTime: new Date().toISOString(),
    };
    setCurrentFlight(flight);
  };

  const endFlight = async () => {
    if (!currentFlight) return;
    const endedFlight = { ...currentFlight, endTime: new Date().toISOString() };
    await db.flights.add(endedFlight);
    setCurrentFlight(null);
    setSelectedStudent(null);
    setSelectedManeuvers([]);
  };

  const toggleManeuver = (maneuver: string) => {
    setSelectedManeuvers(prev =>
      prev.includes(maneuver) ? prev.filter(m => m !== maneuver) : [...prev, maneuver]
    );
  };

  if (!course) return <div>Lade...</div>;

  return (
    <div>
      <h2 className="mb-4 text-xl font-semibold">Flugaufzeichnung für {course.name}</h2>
      {!currentFlight ? (
        <div>
          <h3>Schüler auswählen</h3>
          <select
            onChange={(e) => {
              const studentId = Number(e.target.value);
              const student = course.students.find(s => s.id === studentId);
              setSelectedStudent(student || null);
            }}
            className="mb-4 border p-2"
          >
            <option value="">Schüler wählen</option>
            {course.students.map(student => (
              <option key={student.id} value={student.id}>{student.name}</option>
            ))}
          </select>
          {maneuversEnabled ? (
            <>
              <h3>Manöver auswählen</h3>
              <div className="mb-4 grid grid-cols-3 gap-2">
                {maneuvers.map(maneuver => (
                  <label key={maneuver} className="flex items-center">
                    <input
                      type="checkbox"
                      checked={selectedManeuvers.includes(maneuver)}
                      onChange={() => toggleManeuver(maneuver)}
                      className="mr-2"
                    />
                    {maneuver}
                  </label>
                ))}
              </div>
            </>
          ) : null}
          <button
            onClick={startFlight}
            disabled={!selectedStudent}
            className="
              rounded-sm bg-green-500 px-4 py-2 text-white
              disabled:opacity-50
            "
          >
            Flug starten
          </button>
        </div>
      ) : (
        <div>
          <p>Flug läuft für {selectedStudent?.name}</p>
          <p>Start: {new Date(currentFlight.startTime).toLocaleTimeString()}</p>
          <button onClick={endFlight} className="
            rounded-sm bg-red-500 px-4 py-2 text-white
          ">
            Flug beenden
          </button>
        </div>
      )}
      <button onClick={() => navigate(`/course/${id}`)} className="
        mt-4 rounded-sm bg-gray-500 px-4 py-2 text-white
      ">
        Zurück
      </button>
    </div>
  );
};

export default FlightRecorder;
