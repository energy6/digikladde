import { CameraOutlined, DeleteOutlined, UploadOutlined } from '@ant-design/icons';
import { AutoComplete, Button, Form, Input, InputNumber, Modal, Space, Typography, Upload } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { sanitizeFlightSchoolName, UNKNOWN_FLIGHT_SCHOOL } from '../utils/flightSchool';
import { compressStudentPhotoSource, readFileAsDataUrl } from '../utils/studentPhoto';
import StudentAvatar from './StudentAvatar';

const { Text } = Typography;

export type StudentFields = {
  name: string;
  glider: string;
  color: string;
  totalFlights: number;
  totalAltitudeMeters: number;
  flightSchool: string;
  photoDataUrl?: string;
};

type Props = {
  value: StudentFields;
  flightSchoolOptions?: string[];
  onChange: (value: StudentFields) => void;
};

const StudentForm = ({ value, flightSchoolOptions = [], onChange }: Props) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraReady(false);
  }, []);

  const applyPhotoSource = useCallback(async (source: string) => {
    try {
      const photoDataUrl = await compressStudentPhotoSource(source);
      onChange({ ...value, photoDataUrl });
    } catch {
      Modal.warning({
        title: 'Foto konnte nicht verarbeitet werden',
        content: 'Bitte wähle eine andere Bilddatei oder nimm das Foto erneut auf.',
      });
    }
  }, [onChange, value]);

  const handlePhotoFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      Modal.warning({
        title: 'Datei nicht unterstützt',
        content: 'Bitte wähle eine Bilddatei aus.',
      });
      return;
    }

    try {
      const source = await readFileAsDataUrl(file);
      await applyPhotoSource(source);
    } catch {
      Modal.warning({
        title: 'Foto konnte nicht geladen werden',
        content: 'Bitte wähle eine andere Bilddatei aus.',
      });
    }
  }, [applyPhotoSource]);

  const openCamera = useCallback(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      Modal.warning({
        title: 'Kamera nicht verfügbar',
        content: 'Dieser Browser stellt keine Kameraaufnahme bereit.',
      });
      return;
    }

    setCameraOpen(true);
  }, []);

  const closeCamera = useCallback(() => {
    setCameraOpen(false);
    stopCamera();
  }, [stopCamera]);

  const capturePhoto = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) return;

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    await applyPhotoSource(canvas.toDataURL('image/png'));
    closeCamera();
  }, [applyPhotoSource, closeCamera]);

  useEffect(() => () => {
    stopCamera();
  }, [stopCamera]);

  useEffect(() => {
    if (!cameraOpen) return undefined;

    let cancelled = false;

    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user' },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        if (!cancelled) {
          setCameraReady(true);
        }
      } catch {
        if (!cancelled) {
          setCameraOpen(false);
          stopCamera();
          Modal.warning({
            title: 'Kamera nicht verfügbar',
            content: 'Die Kamera konnte nicht gestartet werden. Prüfe die Berechtigung oder nutze den Foto-Upload.',
          });
        }
      }
    };

    void startCamera();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [cameraOpen, stopCamera]);

  return (
    <>
      <Form layout="vertical" size="small" requiredMark={false} style={{ width: '100%' }}>
        <div className="student-form-header">
          <Form.Item label="Foto" className="student-photo-field">
            <div className="student-photo-frame">
              <StudentAvatar name={value.name} photoDataUrl={value.photoDataUrl} size={72} className="student-photo-avatar" />
              <div className="student-photo-actions">
                <Upload
                  accept="image/*"
                  showUploadList={false}
                  beforeUpload={(file) => {
                    void handlePhotoFile(file);
                    return Upload.LIST_IGNORE;
                  }}
                >
                  <Button size="small" icon={<UploadOutlined />} />
                </Upload>
                <Button size="small" icon={<CameraOutlined />} onClick={openCamera} />
                {value.photoDataUrl ? (
                  <Button size="small" icon={<DeleteOutlined />} onClick={() => onChange({ ...value, photoDataUrl: undefined })} />
                ) : null}
              </div>
            </div>
          </Form.Item>

          <div className="student-form-main-fields">
            <Form.Item label={<>Name <span className="student-required-marker">*</span></>} className="student-form-item">
              <Input
                value={value.name}
                onChange={(e) => onChange({ ...value, name: e.target.value })}
              />
            </Form.Item>
            <div className="student-form-row">
              <Form.Item label={<>Schirm <span className="student-required-marker">*</span></>} className="student-form-item">
                <Input
                  value={value.glider}
                  onChange={(e) => onChange({ ...value, glider: e.target.value })}
                />
              </Form.Item>
              <Form.Item label={<>Farbe <span className="student-required-marker">*</span></>} className="student-form-item">
                <Input
                  value={value.color}
                  onChange={(e) => onChange({ ...value, color: e.target.value })}
                />
              </Form.Item>
            </div>
          </div>
        </div>

        <div className="student-form-row">
          <Form.Item label="Flüge" className="student-form-item student-flight-count-field">
            <InputNumber
              min={0}
              value={value.totalFlights}
              onChange={(v) => onChange({ ...value, totalFlights: v ?? 0 })}
              style={{ width: '100%' }}
            />
          </Form.Item>
          <Form.Item label="Höhenmeter" className="student-form-item student-altitude-count-field">
            <InputNumber
              min={0}
              precision={0}
              value={value.totalAltitudeMeters ?? 0}
              onChange={(v) => onChange({ ...value, totalAltitudeMeters: v ?? 0 })}
              style={{ width: '100%' }}
            />
          </Form.Item>
          <Form.Item label={<>Flugschule <span className="student-required-marker">*</span></>} className="student-form-item student-flight-school-field">
            <AutoComplete
              options={flightSchoolOptions.map((school) => ({ value: school }))}
              showSearch={{
                filterOption: (input, option) => (option?.value ?? '').toLocaleLowerCase('de-DE').includes(input.toLocaleLowerCase('de-DE')),
              }}
              value={value.flightSchool}
              onChange={(nextValue) => onChange({
                ...value,
                flightSchool: String(nextValue),
              })}
            >
            <Input
              placeholder="Flugschule eingeben oder auswählen"
              onBlur={() => onChange({
                ...value,
                flightSchool: sanitizeFlightSchoolName(value.flightSchool || UNKNOWN_FLIGHT_SCHOOL),
              })}
            />
            </AutoComplete>
          </Form.Item>
        </div>
      </Form>

      <Modal
        title="Foto aufnehmen"
        open={cameraOpen}
        onCancel={closeCamera}
        onOk={() => {
          void capturePhoto();
        }}
        okText="Übernehmen"
        okButtonProps={{ disabled: !cameraReady }}
        destroyOnHidden
      >
        <Space orientation="vertical" size="small" style={{ width: '100%' }}>
          <div className="student-camera-preview">
            <video
              ref={videoRef}
              playsInline
              muted
              className="student-camera-video"
            />
          </div>
          {!cameraReady ? <Text type="secondary">Kamera wird gestartet…</Text> : null}
        </Space>
      </Modal>
    </>
  );
};

export default StudentForm;
