import { Avatar, Modal } from 'antd';
import { useState } from 'react';

type StudentAvatarProps = {
  name: string;
  photoDataUrl?: string;
  size: number;
  className: string;
};

const getStudentInitials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';

  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase('de-DE') ?? '')
    .join('');
};

const StudentAvatar = ({ name, photoDataUrl, size, className }: StudentAvatarProps) => {
  const [previewOpen, setPreviewOpen] = useState(false);
  const avatar = (
    <Avatar size={size} src={photoDataUrl} className={className}>
      {getStudentInitials(name)}
    </Avatar>
  );

  if (!photoDataUrl) {
    return avatar;
  }

  return (
    <>
      <button
        type="button"
        className="student-avatar-preview-button"
        aria-label={`Foto von ${name || 'Schüler'} vergrößern`}
        onPointerUp={(event) => {
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.stopPropagation();
          setPreviewOpen(true);
        }}
      >
        {avatar}
      </button>
      <Modal
        title={name || 'Schülerfoto'}
        open={previewOpen}
        footer={null}
        centered
        destroyOnHidden
        onCancel={() => setPreviewOpen(false)}
      >
        <img src={photoDataUrl} alt={name || 'Schülerfoto'} className="student-photo-preview-image" />
      </Modal>
    </>
  );
};

export default StudentAvatar;
