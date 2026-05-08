import { useState, type SyntheticEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { db } from '../db/database';
import type { Student } from '../models/types';

const StudentForm = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [glider, setGlider] = useState('');
  const [color, setColor] = useState('');

  const handleSubmit = async (e: SyntheticEvent) => {
    e.preventDefault();
    const student: Student = { name, glider, color, totalFlights: 0 };
    const studentId = Number(await db.students.add(student));
    if (id) {
      const course = await db.courses.get(Number(id));
      if (course) {
        course.students.push({ ...student, id: studentId });
        await db.courses.update(Number(id), { students: course.students });
      }
    }
    await navigate(id ? `/course/${id}` : '/');
  };

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">Schüler hinzufügen</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block">Name:</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="border p-2 w-full"
            required
          />
        </div>
        <div>
          <label className="block">Schirm:</label>
          <input
            type="text"
            value={glider}
            onChange={(e) => setGlider(e.target.value)}
            className="border p-2 w-full"
            required
          />
        </div>
        <div>
          <label className="block">Farbe:</label>
          <input
            type="text"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="border p-2 w-full"
            required
          />
        </div>
        <button type="submit" className="bg-blue-500 text-white px-4 py-2 rounded">
          Hinzufügen
        </button>
      </form>
    </div>
  );
};

export default StudentForm;
