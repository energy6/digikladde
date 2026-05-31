import { faFloppyDisk, faTowerBroadcast } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Button, Input, Modal, Space, Typography } from 'antd';
import { useEffect, useState } from 'react';

const { Text } = Typography;

export type SettingsValues = {
  username: string;
  relayBaseUrl: string;
};

type SettingsModalProps = {
  open: boolean;
  initialValues: SettingsValues;
  onCancel: () => void;
  onSave: (nextValues: SettingsValues) => void;
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

const toRelayWsUrl = (relayBaseUrl: string): string => {
  const wsBaseUrl = relayBaseUrl.startsWith('https://')
    ? relayBaseUrl.replace(/^https:\/\//, 'wss://')
    : relayBaseUrl.replace(/^http:\/\//, 'ws://');
  return `${wsBaseUrl}/relay`;
};

const SettingsModal = ({ open, initialValues, onCancel, onSave }: SettingsModalProps) => {
  const [username, setUsername] = useState(initialValues.username);
  const [relayBaseUrl, setRelayBaseUrl] = useState(initialValues.relayBaseUrl);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [relayUrlError, setRelayUrlError] = useState<string | null>(null);
  const [relayTestMessage, setRelayTestMessage] = useState<string | null>(null);
  const [relayTestOk, setRelayTestOk] = useState<boolean | null>(null);
  const [relayTestLoading, setRelayTestLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setUsername(initialValues.username);
    setRelayBaseUrl(initialValues.relayBaseUrl);
    setUsernameError(null);
    setRelayUrlError(null);
    setRelayTestMessage(null);
    setRelayTestOk(null);
    setRelayTestLoading(false);
  }, [initialValues, open]);

  const handleTestRelay = async () => {
    const normalizedRelayBaseUrl = normalizeRelayBaseUrl(relayBaseUrl);

    if (!normalizedRelayBaseUrl) {
      setRelayUrlError('Bitte eine gültige absolute URL angeben, z.B. https://digikladde.aircursion.de');
      setRelayTestMessage('Kein Test möglich: Relay-URL ist ungültig.');
      setRelayTestOk(false);
      return;
    }

    setRelayUrlError(null);
    setRelayTestMessage('Verbindung wird geprüft...');
    setRelayTestOk(null);
    setRelayTestLoading(true);

    try {
      await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(toRelayWsUrl(normalizedRelayBaseUrl));
        let opened = false;

        const timeoutHandle = window.setTimeout(() => {
          ws.close();
          reject(new Error('timeout'));
        }, 5000);

        ws.onopen = () => {
          opened = true;
          window.clearTimeout(timeoutHandle);
          ws.close(1000, 'relay-probe-ok');
          resolve();
        };

        ws.onerror = () => {
          window.clearTimeout(timeoutHandle);
          reject(new Error('connect_error'));
        };

        ws.onclose = () => {
          if (opened) return;
          window.clearTimeout(timeoutHandle);
          reject(new Error('closed_before_open'));
        };
      });

      setRelayTestMessage('Relay-Server erkannt. WebSocket-Verbindung ist verfügbar.');
      setRelayTestOk(true);
    } catch (error) {
      const message = error instanceof Error && error.message === 'timeout'
        ? 'Test fehlgeschlagen: Timeout nach 5 Sekunden.'
        : 'Test fehlgeschlagen: Relay-WebSocket nicht erreichbar.';
      setRelayTestMessage(message);
      setRelayTestOk(false);
    } finally {
      setRelayTestLoading(false);
    }
  };

  const handleSave = () => {
    const normalizedUsername = sanitizeUsername(username);
    const normalizedRelayBaseUrl = normalizeRelayBaseUrl(relayBaseUrl);

    const nextUsernameError = normalizedUsername ? null : 'Benutzername darf nicht leer sein.';
    const nextRelayUrlError = normalizedRelayBaseUrl
      ? null
      : 'Bitte eine gültige absolute URL angeben, z.B. https://digikladde.aircursion.de';

    setUsernameError(nextUsernameError);
    setRelayUrlError(nextRelayUrlError);

    if (nextUsernameError || nextRelayUrlError || !normalizedRelayBaseUrl) return;

    onSave({
      username: normalizedUsername,
      relayBaseUrl: normalizedRelayBaseUrl,
    });
  };

  return (
    <Modal
      title="Einstellungen"
      open={open}
      onCancel={onCancel}
      onOk={handleSave}
      okText={<FontAwesomeIcon icon={faFloppyDisk} />}
      cancelButtonProps={{ style: { display: 'none' } }}
    >
      <Space orientation="vertical" size="small" style={{ width: '100%' }}>
        <Text strong>Benutzername</Text>
        <Input
          value={username}
          placeholder="Benutzername"
          onChange={(event) => {
            setUsername(event.target.value);
            if (usernameError) setUsernameError(null);
          }}
        />
        {usernameError ? <Text type="danger">{usernameError}</Text> : null}

        <Text strong>Relay-URL</Text>
        <Space.Compact style={{ width: '100%' }}>
          <Input
            value={relayBaseUrl}
            placeholder="https://digikladde.aircursion.de"
            onChange={(event) => {
              setRelayBaseUrl(event.target.value);
              if (relayUrlError) setRelayUrlError(null);
              if (relayTestMessage) {
                setRelayTestMessage(null);
                setRelayTestOk(null);
              }
            }}
          />
          <Button
            onClick={() => void handleTestRelay()}
            loading={relayTestLoading}
            icon={<FontAwesomeIcon icon={faTowerBroadcast} />}
            aria-label="Relay-Verbindung testen"
            title="Relay-Verbindung testen"
          />
        </Space.Compact>
        {relayUrlError ? <Text type="danger">{relayUrlError}</Text> : null}
        {relayTestMessage ? (
          <Text type={relayTestOk === false ? 'danger' : 'success'}>{relayTestMessage}</Text>
        ) : null}
      </Space>
    </Modal>
  );
};

export default SettingsModal;
