import { QuestionCircleOutlined, SettingOutlined } from '@ant-design/icons';
import { faSync } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, Layout, Space, Typography } from 'antd';
import { useRef, useState } from 'react';
import { BrowserRouter, HashRouter, Route, Routes } from 'react-router-dom';
import { useRegisterSW } from 'virtual:pwa-register/react';
import CourseDetail from './components/CourseDetail';
import CourseEvaluation from './components/CourseEvaluation';
import CourseList from './components/CourseList';
import FlightRecorder from './components/FlightRecorder';
import { SettingsModal, type SettingsValues } from './components/modals';
import { FlightSchoolProvider } from './context/FlightSchoolContext';
import { RelaySyncProvider } from './context/RelaySyncContext';

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
const SETTINGS_STORAGE_KEY = 'digikladde.appSettings';

const readDefaultRelayBaseUrl = (): string => {
  if (typeof window === 'undefined') return 'https://digikladde.aircursion.de';
  return window.location.origin;
};

const deriveDefaultUsername = (): string => {
  if (typeof window === 'undefined') return 'Pilot';

  const navigatorWithUserAgentData = window.navigator as Navigator & {
    userAgentData?: { platform?: string };
  };

  const rawPlatform = navigatorWithUserAgentData.userAgentData?.platform ?? window.navigator.platform ?? '';
  const platform = rawPlatform.toLowerCase();

  if (platform.includes('mac')) return 'Pilot (Mac)';
  if (platform.includes('win')) return 'Pilot (Windows)';
  if (platform.includes('linux')) return 'Pilot (Linux)';
  if (platform.includes('iphone') || platform.includes('ipad') || platform.includes('android')) return 'Pilot (Mobile)';

  return 'Pilot';
};

const sanitizeUsername = (rawValue: string): string => rawValue.trim().replace(/\s+/g, ' ').slice(0, 60);

const normalizeRelayBaseUrl = (rawValue: string): string | null => {
  const trimmed = rawValue.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    const normalizedPath = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '');
    return `${parsed.origin}${normalizedPath}`;
  } catch {
    return null;
  }
};

const readInitialSettings = (): SettingsValues => {
  const fallback: SettingsValues = {
    username: deriveDefaultUsername(),
    relayBaseUrl: readDefaultRelayBaseUrl(),
  };

  if (typeof window === 'undefined') return fallback;

  const rawStored = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
  if (!rawStored) return fallback;

  try {
    const parsed = JSON.parse(rawStored) as Partial<SettingsValues>;

    const username = sanitizeUsername(typeof parsed.username === 'string' ? parsed.username : '') || fallback.username;
    const relayBaseUrl = normalizeRelayBaseUrl(typeof parsed.relayBaseUrl === 'string' ? parsed.relayBaseUrl : '') ?? fallback.relayBaseUrl;

    return { username, relayBaseUrl };
  } catch {
    return fallback;
  }
};

function App() {
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [settings, setSettings] = useState<SettingsValues>(readInitialSettings);
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

  const handleSaveSettings = (nextSettings: SettingsValues) => {
    setSettings(nextSettings);

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(nextSettings));
    }

    setSettingsModalOpen(false);
  };

  return (
    <Router>
      <FlightSchoolProvider>
        <RelaySyncProvider username={settings.username} relayBaseUrl={settings.relayBaseUrl}>
          <Layout className="app-layout">
        <Header className="app-header" style={{ background: '#0a2239', display: 'flex', alignItems: 'center', padding: '0 24px' }}>
          <Space size={8} align="center">
            <Typography.Title level={3} style={{ color: '#fff', margin: 0 }}>
              DigiKladde
            </Typography.Title>
          </Space>
          <Space size={4} align="center" style={{ marginLeft: 'auto' }}>
            <a
              href={appReadmeUrl}
              target="_blank"
              rel="noreferrer"
              aria-label="Hilfe und Benutzeranleitung öffnen"
              title="Hilfe öffnen"
            >
              <Button
                type="text"
                icon={<QuestionCircleOutlined />}
                style={{ color: '#fff' }}
              />
            </a>
            <Button
              type="text"
              icon={<SettingOutlined />}
              aria-label="Einstellungen öffnen"
              title="Einstellungen öffnen"
              onClick={() => setSettingsModalOpen(true)}
              style={{ color: '#fff' }}
            />
          </Space>
        </Header>
        <Content className="app-content" style={{ padding: 24, maxWidth: 1200, margin: '0 auto', width: '100%' }}>
          <Routes>
            <Route path="/" element={<CourseList />} />
            <Route path="/course/:id" element={<CourseDetail />} />
            <Route path="/course/:id/evaluation" element={<CourseEvaluation />} />
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

          <SettingsModal
            open={settingsModalOpen}
            initialValues={settings}
            onCancel={() => setSettingsModalOpen(false)}
            onSave={handleSaveSettings}
          />
          </Layout>
        </RelaySyncProvider>
      </FlightSchoolProvider>
    </Router>
  );
}

export default App;
