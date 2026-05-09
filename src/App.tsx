import { QuestionCircleOutlined } from '@ant-design/icons';
import { faSync } from '@fortawesome/free-solid-svg-icons';
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

const { Header, Content, Footer } = Layout;

const appVersion = __APP_VERSION__;
const appTimestampUtc = __BUILD_TIMESTAMP_UTC__;
const appReadmeUrl = __APP_README_URL__;
const appBuildDate = new Date(appTimestampUtc);
const appTimestampLocal = Number.isNaN(appBuildDate.getTime())
  ? appTimestampUtc
  : new Intl.DateTimeFormat(undefined, {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(appBuildDate);
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
      <Layout className="app-layout">
        <Header className="app-header" style={{ background: '#0a2239', display: 'flex', alignItems: 'center', padding: '0 24px' }}>
          <Typography.Title level={3} style={{ color: '#fff', margin: 0 }}>
            DigiKladde
          </Typography.Title>
          <a
            href={appReadmeUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="Hilfe und Benutzeranleitung öffnen"
            title="Hilfe öffnen"
            style={{ marginLeft: 'auto' }}
          >
            <Button
              type="text"
              icon={<QuestionCircleOutlined />}
              style={{ color: '#fff' }}
            />
          </a>
        </Header>
        <Content className="app-content" style={{ padding: 24, maxWidth: 1200, margin: '0 auto', width: '100%' }}>
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
        <Footer
          className="app-footer"
          style={{
            padding: '8px 24px',
            paddingBottom: 'max(8px, env(safe-area-inset-bottom))',
            textAlign: 'center',
            background: '#0a2239',
          }}
        >
          <Space size="middle" align="center">
            <Typography.Text type="secondary" style={{ color: '#818181' }}>
              Version {appVersion} | {appTimestampLocal}
            </Typography.Text>
            <Button type="link" size="small" icon={<FontAwesomeIcon icon={faSync} />} onClick={() => void handleCheckForUpdates()}/>
          </Space>
        </Footer>

        {(offlineReady || needRefresh) && (
          <div
            style={{
              position: 'fixed',
              right: 16,
              bottom: 'calc(16px + env(safe-area-inset-bottom))',
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
