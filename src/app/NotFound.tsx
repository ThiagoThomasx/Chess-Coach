import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { EmptyState } from '../components/feedback/EmptyState';

export function NotFound() {
  return (
    <div className="page">
      <EmptyState icon={<Compass size={36} />} title="Página não encontrada" action={<Link to="/">Voltar ao dashboard</Link>}>
        O endereço não corresponde a nenhuma área do ChessQuest.
      </EmptyState>
    </div>
  );
}
