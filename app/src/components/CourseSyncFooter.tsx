import { BellOutlined, LinkOutlined, ReloadOutlined } from '@ant-design/icons';
import { Button, Card, Input, Modal, Space, Tag, Tooltip, message } from 'antd';
import { QRCodeSVG } from 'qrcode.react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRelaySync } from '../context/RelaySyncContext';
import type { Course, ShareSession } from '../models/types';
import type { JoinInvitePayload } from '../utils/parseJoinInvite';

const formatLastSync = (isoTimestamp?: string): string => {
  if (!isoTimestamp) return 'Noch nicht synchronisiert';

  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) return 'Noch nicht synchronisiert';

  return `Letzte Sync: ${parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
};

const canUseWebShare = (): boolean => (
  typeof navigator !== 'undefined' && typeof navigator.share === 'function'
);



type Props = {
  course: Course;
};

const CourseSyncFooter = ({ course }: Props) => {
  const {
    startShareSession,
    getShareSession,
    connectCourseSession,
    disconnectCourseSession,
    sendPendingDeltas,
    enablePushNotifications,
  } = useRelaySync();

  const [shareSession, setShareSession] = useState<ShareSession | null>(null);
  const [busyAction, setBusyAction] = useState<'share' | 'resync' | 'push' | null>(null);
  const [qrShareModalOpen, setQrShareModalOpen] = useState(false);
  const [webShareAvailable, setWebShareAvailable] = useState(false);
  const isSharedCourse = useMemo(() => Boolean(shareSession?.courseSyncId), [shareSession?.courseSyncId]);

  const refreshShareSession = useCallback(async (courseSyncId?: string) => {
    const lookupSyncId = courseSyncId ?? course.syncId ?? shareSession?.courseSyncId;
    if (!lookupSyncId) {
      setShareSession(null);
      return;
    }

    const session = await getShareSession(lookupSyncId);
    setShareSession(session ?? null);
  }, [course.syncId, getShareSession, shareSession?.courseSyncId]);

  useEffect(() => {
    void refreshShareSession();
  }, [refreshShareSession]);

  useEffect(() => {
    setWebShareAvailable(canUseWebShare());
  }, []);

  useEffect(() => {
    if (!isSharedCourse) return;

    const SYNC_POLL_INTERVAL_MS = 2000;
    const intervalId = window.setInterval(() => {
      void refreshShareSession();
    }, SYNC_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isSharedCourse, refreshShareSession]);

  const handleShareCourse = async () => {
    if (!course.id) return;

    try {
      setBusyAction('share');
      const session = await startShareSession({ courseId: course.id });
      setShareSession(session);
      await connectCourseSession(course.id);
      await refreshShareSession(session.courseSyncId);
      setQrShareModalOpen(true);
      message.success('Kurs ist jetzt geteilt. QR-Code geöffnet.');
    } catch {
      message.error('Kurs konnte nicht geteilt werden.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleResync = async () => {
    if (!course.id) return;

    try {
      setBusyAction('resync');
      const sent = await sendPendingDeltas(course.id);
      if (sent > 0) {
        message.success(`${sent} Delta${sent === 1 ? '' : 's'} gesendet.`);
      }
      await disconnectCourseSession(course.id);
      await connectCourseSession(course.id);
      await refreshShareSession();
      message.success('Resync gestartet – neuer Snapshot wird angefordert.');
    } catch {
      message.error('Resync fehlgeschlagen.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleEnablePush = async () => {
    if (!course.id) return;

    try {
      setBusyAction('push');
      const result = await enablePushNotifications(course.id);

      if (result.status === 'subscribed') {
        await refreshShareSession();
        message.success('Benachrichtigungen für diesen Kurs sind aktiv.');
        return;
      }

      if (result.status === 'denied') {
        message.error('Benachrichtigungen wurden vom Browser blockiert.');
        return;
      }

      if (result.status === 'unsupported') {
        message.error('Dieses Gerät unterstützt keine Web-Push-Benachrichtigungen.');
        return;
      }

      message.error('Benachrichtigungen sind am Relay nicht konfiguriert.');
    } catch {
      message.error('Benachrichtigungen konnten nicht aktiviert werden.');
    } finally {
      setBusyAction(null);
    }
  };

  const shareQrPayload = shareSession
    ? JSON.stringify({
        type: 'digikladde_join',
        version: 1,
        roomId: shareSession.roomId,
        joinSecret: shareSession.joinSecret,
        courseSyncId: shareSession.courseSyncId,
      } satisfies JoinInvitePayload)
    : '';

  const shareLink = useMemo(() => {
    if (!shareQrPayload || typeof window === 'undefined') return '';

    const basePath = window.location.pathname.replace(/\/course\/[^/]+$/, '/');
    const url = new URL(basePath, window.location.origin);
    url.searchParams.set('joinInvite', shareQrPayload);
    return url.toString();
  }, [shareQrPayload]);

  const handleShareByLink = useCallback(async () => {
    if (!shareLink) {
      message.error('Es konnte kein Share-Link erstellt werden.');
      return;
    }

    try {
      if (!canUseWebShare()) {
        setWebShareAvailable(false);
        return;
      }

      await navigator.share({
        title: 'DigiKladde Kurs teilen',
        url: shareLink,
      });
    } catch (error) {
      if (error instanceof DOMException) {
        if (error.name === 'AbortError') {
          return;
        }
        if (error.name === 'NotSupportedError') {
          setWebShareAvailable(false);
        }
      }

      message.error('Share-Link konnte nicht geteilt werden.');
    }
  }, [shareLink]);

  const connectionState = shareSession?.state ?? 'idle';
  const connectionColor = connectionState === 'connected'
    ? 'green'
    : connectionState === 'connecting'
      ? 'processing'
      : connectionState === 'error'
        ? 'red'
        : 'default';

  return (
    <>
      <Card
        size="small"
        styles={{ body: { padding: 8 } }}
        variant="outlined"
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Space size={6}>
            <Tag color={connectionColor} style={{ marginRight: 0 }}>
              {isSharedCourse
                ? (connectionState === 'connected' ? 'Shared' : connectionState === 'connecting' ? 'Verbinde…' : connectionState === 'error' ? 'Fehler' : 'Shared')
                : 'Lokal'}
            </Tag>
            <span style={{ color: '#8c8c8c', fontSize: 12 }}>
              {isSharedCourse ? formatLastSync(shareSession?.lastSyncedAt) : 'Noch nicht synchronisiert'}
            </span>
          </Space>

          <Space size={6}>
            {isSharedCourse && (
              <>
                <Tooltip title="Benachrichtigung bei wartenden Updates aktivieren">
                  <Button
                    icon={<BellOutlined />}
                    onClick={() => void handleEnablePush()}
                    loading={busyAction === 'push'}
                  />
                </Tooltip>
                <Tooltip title="Ausstehende Updates senden und neuen Snapshot anfordern">
                  <Button
                    icon={<ReloadOutlined />}
                    type="primary"
                    onClick={() => void handleResync()}
                    loading={busyAction === 'resync'}
                  />
                </Tooltip>
              </>
            )}
            <Tooltip title="Kurs teilen und QR-Code anzeigen">
              <Button
                icon={<LinkOutlined />}
                type={ isSharedCourse ? 'default': 'primary' }
                onClick={() => void handleShareCourse()}
                loading={busyAction === 'share'}
              />
            </Tooltip>
          </Space>
        </div>
      </Card>

      <Modal
        title="Share-QR-Code"
        open={qrShareModalOpen}
        onCancel={() => setQrShareModalOpen(false)}
        footer={null}
      >
        {shareSession ? (
          <Space orientation="vertical" size="middle" style={{ width: '100%', alignItems: 'center' }}>
            <QRCodeSVG value={shareQrPayload} size={260} marginSize={4} />
            {webShareAvailable ? (
              <Button icon={<LinkOutlined />} onClick={() => void handleShareByLink()}>
                Per Link teilen
              </Button>
            ) : (
              <Input
                readOnly
                value={shareLink}
                onFocus={(event) => event.target.select()}
                style={{ width: '100%' }}
              />
            )}
            <span style={{ color: '#8c8c8c', fontSize: 12, textAlign: 'center' }}>
              Mit einer anderen DigiKladde per QR-Code beitreten. Dieses Gerät bleibt während des ersten Sync online.
            </span>
          </Space>
        ) : (
          <span>Keine Session verfügbar.</span>
        )}
      </Modal>
    </>
  );
};

export default CourseSyncFooter;
