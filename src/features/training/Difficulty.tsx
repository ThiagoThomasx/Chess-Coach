type Props = { value: number };

export function Difficulty({ value }: Props) {
  return (
    <span className="difficulty" role="img" aria-label={`Dificuldade ${value} de 5`} title={`Dificuldade ${value}/5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <i key={i} data-on={i <= value} />
      ))}
    </span>
  );
}
