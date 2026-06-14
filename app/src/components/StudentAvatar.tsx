import { Avatar } from 'antd';

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

const StudentAvatar = ({ name, photoDataUrl, size, className }: StudentAvatarProps) => (
  <Avatar size={size} src={photoDataUrl} className={className}>
    {getStudentInitials(name)}
  </Avatar>
);

export default StudentAvatar;
