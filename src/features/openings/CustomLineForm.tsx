import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { Color } from '../../types/domain';
import { addCustomOpening } from '../../db/openingsRepo';
import { parseMoveText, validateLine } from '../../services/openings/practice';
import { useToast } from '../../components/feedback/Toast';

type Props = { onCreated: (id: string) => void };

export function CustomLineForm({ onCreated }: Props) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [side, setSide] = useState<Color>('w');
  const [text, setText] = useState('');
  const [goals, setGoals] = useState('');
  const moves = parseMoveText(text);
  const v = validateLine(moves);

  const submit = async () => {
    try {
      const o = await addCustomOpening(
        name,
        side,
        moves,
        goals
          .split('\n')
          .map((g) => g.trim())
          .filter(Boolean),
      );
      toast('Linha adicionada ao seu repertório pessoal', 'good');
      setName('');
      setText('');
      setGoals('');
      onCreated(o.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Linha inválida', 'bad');
    }
  };

  return (
    <div className="stack">
      <label className="field">
        <span>Nome</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Minha linha contra a Siciliana" />
      </label>
      <label className="field">
        <span>Lado</span>
        <select className="select" value={side} onChange={(e) => setSide(e.target.value as Color)}>
          <option value="w">Brancas</option>
          <option value="b">Pretas</option>
        </select>
      </label>
      <label className="field">
        <span>Lances (SAN)</span>
        <textarea className="textarea" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="1. e4 c5 2. Nf3 d6" />
        <small>{text ? (v.ok ? `${moves.length} meias-jogadas válidas` : v.error) : 'Os lances são verificados com as regras do xadrez.'}</small>
      </label>
      <label className="field">
        <span>Objetivos (um por linha, opcional)</span>
        <textarea className="textarea" rows={2} value={goals} onChange={(e) => setGoals(e.target.value)} />
      </label>
      <button className="btn btn-primary" disabled={!v.ok || moves.length < 2} onClick={() => void submit()}>
        <Plus size={15} /> Adicionar linha
      </button>
      <p className="xs faint">Linhas personalizadas são suas anotações — o ChessQuest não as apresenta como teoria estabelecida.</p>
    </div>
  );
}
