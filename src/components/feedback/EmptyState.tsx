import type { ReactNode } from 'react';

type Props = {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
};

export function EmptyState({ icon, title, children, action }: Props) {
  return (
    <div className="empty">
      {icon}
      <h2>{title}</h2>
      {children && <p className="small">{children}</p>}
      {action}
    </div>
  );
}
