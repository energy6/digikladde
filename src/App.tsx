import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, Layout, Space, Typography } from 'antd';
import { useRef } from 'react';
import { BrowserRouter, HashRouter, Route, Routes } from 'react-router-dom';
import { useRegisterSW } from 'virtual:pwa-register/react';
import CourseDetail from './components/CourseDetail';
import CourseEvaluation from './components/CourseEvaluation';
import CourseForm from './components/CourseForm';
import CourseList from './components/CourseList';
import FlightRecorder from './components/FlightRecorder';
import StudentForm from './components/StudentForm';
import { faSync } from '@fortawesome/free-solid-svg-icons';

const { Header, Content, Footer } = Layout;

const appVersion = __APP_VERSION__;
const appTimestamp = __BUILD_TIMESTAMP__;
const Router = import.meta.env.BASE_URL === '/' ? BrowserRouter : HashRouter;

function App() {
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW: (_swUrl, registration) => {
      registrationRef.current = registration ?? null;

      if (registration) {
        window.setInterval(() => {
          void registration.update();
        }, 30 * 60 * 1000);
      }
    },
    onRegisterError: (error) => {
      console.error('Service-Worker-Registrierung fehlgeschlagen:', error);
    },
  });

  const closeUpdateBanner = () => {
    setOfflineReady(false);
    setNeedRefresh(false);
  };

  const handleCheckForUpdates = async () => {
    if (!registrationRef.current) return;
    await registrationRef.current.update();
  };

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
          <Space size="middle" align="center">
            <Typography.Text type="secondary" style={{ color: '#818181' }}>
              Version {appVersion} | {appTimestamp}
            </Typography.Text>
            <Button type="link" size="small" icon={<FontAwesomeIcon icon={faSync} />} onClick={() => void handleCheckForUpdates()}/>
          </Space>
        </Footer>

        {(offlineReady || needRefresh) && (
          <div
            style={{
              position: 'fixed',
              right: 16,
              bottom: 16,
              zIndex: 1000,
              background: '#ffffff',
              border: '1px solid #d9d9d9',
              borderRadius: 8,
              boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
              padding: 12,
              maxWidth: 360,
            }}
          >
            <Space orientation="vertical" size={8} style={{ width: '100%' }}>
              <Typography.Text strong>
                {needRefresh ? 'Update verfügbar' : 'Offline bereit'}
              </Typography.Text>
              <Typography.Text type="secondary">
                {needRefresh
                  ? 'Eine neue App-Version wurde gefunden. Jetzt neu laden?'
                  : 'Die App ist installiert und kann offline genutzt werden.'}
              </Typography.Text>
              <Space>
                {needRefresh && (
                  <Button type="primary" onClick={() => void updateServiceWorker(true)}>
                    Jetzt aktualisieren
                  </Button>
                )}
                <Button onClick={closeUpdateBanner}>Schließen</Button>
              </Space>
            </Space>
          </div>
        )}
      </Layout>
    </Router>
  );
}

export default App;
