import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Layout, Typography } from 'antd';
import CourseList from './components/CourseList';
import CourseForm from './components/CourseForm';
import CourseDetail from './components/CourseDetail';
import StudentForm from './components/StudentForm';
import FlightRecorder from './components/FlightRecorder';

const { Header, Content } = Layout;

function App() {
  return (
    <Router>
      <Layout style={{ minHeight: '100vh' }}>
        <Header style={{ background: '#0a2239', display: 'flex', alignItems: 'center', padding: '0 24px' }}>
          <Typography.Title level={3} style={{ color: '#fff', margin: 0 }}>
            DigiKladde
          </Typography.Title>
        </Header>
        <Content style={{ padding: 24, maxWidth: 1200, margin: '0 auto', width: '100%' }}>
          <Routes>
            <Route path="/" element={<CourseList />} />
            <Route path="/course/new" element={<CourseForm />} />
            <Route path="/course/:id" element={<CourseDetail />} />
            <Route path="/course/:id/edit" element={<CourseForm />} />
            <Route path="/course/:id/add-student" element={<StudentForm />} />
            <Route path="/course/:id/flight" element={<FlightRecorder />} />
          </Routes>
        </Content>
      </Layout>
    </Router>
  );
}

export default App;
