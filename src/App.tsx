import { Layout, Typography } from 'antd';
import { BrowserRouter, HashRouter, Route, Routes } from 'react-router-dom';
import CourseDetail from './components/CourseDetail';
import CourseEvaluation from './components/CourseEvaluation';
import CourseForm from './components/CourseForm';
import CourseList from './components/CourseList';
import FlightRecorder from './components/FlightRecorder';
import StudentForm from './components/StudentForm';

const { Header, Content, Footer } = Layout;

const appVersion = __APP_VERSION__;
const appTimestamp = __BUILD_TIMESTAMP__;
const Router = import.meta.env.BASE_URL === '/' ? BrowserRouter : HashRouter;

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
            <Route path="/course/:id/evaluation" element={<CourseEvaluation />} />
            <Route path="/course/:id/edit" element={<CourseForm />} />
            <Route path="/course/:id/add-student" element={<StudentForm />} />
            <Route path="/course/:id/flight" element={<FlightRecorder />} />
          </Routes>
        </Content>
        <Footer style={{ padding: '8px 24px', textAlign: 'center', background: '#0a2239' }}>
          <Typography.Text type="secondary" style={{ color: '#818181' }}>
            Version {appVersion} | {appTimestamp}
          </Typography.Text>
        </Footer>
      </Layout>
    </Router>
  );
}

export default App;
