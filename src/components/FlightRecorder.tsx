import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from '../db/database';
import type { Course, Student, Flight } from '../models/types';
import { maneuvers } from '../models/types';

const FlightRecorder = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [course, setCourse] = useState<Course | null>(null);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [selectedManeuvers, setSelectedManeuvers] = useState<string[]>([]);
  const [currentFlight, setCurrentFlight] = useState<Flight | null>(null);

  useEffect(() => {
    const loadCourse = async () => {
      if (id) {
        const c = await db.courses.get(Number(id));
        setCourse(c || null);
      }
    };
    loadCourse();
  }, [id]);

  const startFlight = () => {
    if (!selectedStudent) return;
    const flight: Flight = {
      courseId: Number(id),
      studentId: selectedStudent.id!,
      maneuvers: selectedManeuvers,
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
      <h2 className="text-xl font-semibold mb-4">Flugaufzeichnung für {course.name}</h2>
      {!currentFlight ? (
        <div>
          <h3>Schüler auswählen</h3>
          <select
            onChange={(e) => {
              const studentId = Number(e.target.value);
              const student = course.students.find(s => s.id === studentId);
              setSelectedStudent(student || null);
            }}
            className="border p-2 mb-4"
          >
            <option value="">Schüler wählen</option>
            {course.students.map(student => (
              <option key={student.id} value={student.id}>{student.name}</option>
            ))}
          </select>
          <h3>Manöver auswählen</h3>
          <div className="grid grid-cols-3 gap-2 mb-4">
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
          <button
            onClick={startFlight}
            disabled={!selectedStudent}
            className="bg-green-500 text-white px-4 py-2 rounded disabled:opacity-50"
          >
            Flug starten
          </button>
        </div>
      ) : (
        <div>
          <p>Flug läuft für {selectedStudent?.name}</p>
          <p>Start: {new Date(currentFlight.startTime).toLocaleTimeString()}</p>
          <button onClick={endFlight} className="bg-red-500 text-white px-4 py-2 rounded">
            Flug beenden
          </button>
        </div>
      )}
      <button onClick={() => navigate(`/course/${id}`)} className="mt-4 bg-gray-500 text-white px-4 py-2 rounded">
        Zurück
      </button>
    </div>
  );
};

export default FlightRecorder;